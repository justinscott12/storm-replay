"""View a single NEXRAD Archive II radar file.

Examples:
  python view.py KPBZ20260606_030522_V06
  python view.py KPBZ20260606_030522_V06 --field velocity
  python view.py KPBZ20260606_030522_V06 --info
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
from pyart.graph import RadarDisplay

from radar_common import (
    FIELD_LIMITS,
    format_scan_time,
    load,
    resolve_field,
    sweep_with_data,
)


def print_info(radar) -> None:
    elev = [round(float(v), 2) for v in radar.fixed_angle["data"]]
    print(f"Station:    {radar.metadata.get('instrument_name', '?')}")
    print(f"Time:       {radar.time.get('units', '?')}")
    print(f"Sweeps:     {radar.nsweeps}  elevations: {elev}")
    print(f"Fields:     {', '.join(radar.fields)}")


def view(
    radar,
    field: str,
    tilt: int,
    *,
    save: Path | None = None,
    source: Path | None = None,
) -> None:
    sweep = sweep_with_data(radar, field, tilt)
    elev = float(radar.fixed_angle["data"][sweep])
    station = radar.metadata.get("instrument_name", "?")
    limits = FIELD_LIMITS.get(field)
    when = format_scan_time(source, radar) if source else ""

    fig, ax = plt.subplots(figsize=(9, 9))
    display = RadarDisplay(radar)
    kwargs = {"vmin": limits[0], "vmax": limits[1]} if limits else {}
    display.plot_ppi(field, sweep=sweep, ax=ax, **kwargs)
    display.plot_range_rings([25, 50, 75, 100, 125], ax=ax, col="0.5", ls="--", lw=0.5)
    title = f"{station} {field} — {elev:.2f}° (sweep {sweep})"
    if when:
        title += f"\n{when}"
    ax.set_title(title)

    if save:
        save.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(save, dpi=150, bbox_inches="tight")
        print(f"Saved {save.resolve()}")
    else:
        plt.show()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="NEXRAD Archive II file")
    parser.add_argument(
        "-f",
        "--field",
        default="reflectivity",
        help="Field to show (reflectivity, velocity, cc, sw, ...)",
    )
    parser.add_argument(
        "-t",
        "--tilt",
        type=int,
        default=0,
        help="Tilt index 0=lowest (default: 0)",
    )
    parser.add_argument("--info", action="store_true", help="Print metadata and exit")
    parser.add_argument("--save", type=Path, help="Save PNG instead of opening a window")
    args = parser.parse_args()

    radar = load(args.file)
    print_info(radar)

    if args.info:
        return

    field = resolve_field(args.field, list(radar.fields))
    view(radar, field, args.tilt, save=args.save, source=args.file)


if __name__ == "__main__":
    main()
