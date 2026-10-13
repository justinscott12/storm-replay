"""Shared helpers for reading NEXRAD Archive II volumes."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyart

FIELD_ALIASES = {
    "refl": "reflectivity",
    "dbz": "reflectivity",
    "vel": "velocity",
    "cc": "cross_correlation_ratio",
    "sw": "spectrum_width",
}

FIELD_LIMITS = {
    "reflectivity": (-10, 70),
    "velocity": (-30, 30),
    "cross_correlation_ratio": (0.3, 1.05),
    "spectrum_width": (0, 8),
    "differential_reflectivity": (-2, 6),
    "differential_phase": (0, 180),
}

FILENAME_TIME = re.compile(r"_(\d{8})_(\d{6})_")


def load(path: Path) -> pyart.core.Radar:
    return pyart.io.read_nexrad_archive(str(path))


def resolve_field(name: str, available: list[str]) -> str:
    field = FIELD_ALIASES.get(name.lower(), name.lower())
    if field not in available:
        raise ValueError(f"Unknown field '{name}'. Available: {', '.join(available)}")
    return field


def sweep_with_data(radar: pyart.core.Radar, field: str, tilt: int) -> int:
    """NEXRAD split-cut: reflectivity and velocity alternate on the same elevation."""
    target = float(radar.fixed_angle["data"][tilt])
    for sweep in range(radar.nsweeps):
        if float(radar.fixed_angle["data"][sweep]) != target:
            continue
        data = radar.fields[field]["data"][radar.get_slice(sweep=sweep)]
        if np.ma.count(data) > 0:
            return sweep
    for sweep in range(radar.nsweeps):
        data = radar.fields[field]["data"][radar.get_slice(sweep=sweep)]
        if np.ma.count(data) > 0:
            return sweep
    raise ValueError(f"No data for field '{field}' in volume.")


def scan_time_from_name(path: Path) -> datetime | None:
    match = FILENAME_TIME.search(path.name)
    if not match:
        return None
    return datetime.strptime(match.group(1) + match.group(2), "%Y%m%d%H%M%S").replace(
        tzinfo=timezone.utc
    )


def scan_time_from_radar(radar: pyart.core.Radar) -> datetime:
    units = radar.time.get("units", "")
    if units.startswith("seconds since "):
        stamp = units.removeprefix("seconds since ").strip()
        base = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        offset = float(radar.time["data"][0])
        return base.replace(tzinfo=timezone.utc) + timedelta(seconds=offset)
    return datetime.min.replace(tzinfo=timezone.utc)


def sort_radar_files(paths: list[Path], *, skip_mdm: bool = True) -> list[Path]:
    filtered: list[Path] = []
    for path in paths:
        if not path.is_file():
            continue
        if skip_mdm and path.name.endswith("_MDM"):
            continue
        filtered.append(path)

    def sort_key(path: Path) -> tuple[datetime, str]:
        return (scan_time_from_name(path) or datetime.min.replace(tzinfo=timezone.utc), path.name)

    return sorted(filtered, key=sort_key)


def format_scan_time(path: Path, radar: pyart.core.Radar | None = None) -> str:
    when = scan_time_from_name(path)
    if when is None and radar is not None:
        when = scan_time_from_radar(radar)
    if when is None:
        return path.name
    return when.strftime("%Y-%m-%d %H:%M:%S UTC")
