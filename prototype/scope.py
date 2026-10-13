"""Scrub through multiple NEXRAD scans like RadarScope.

Controls:
  Slider / mouse drag  — scrub time
  Left / Right         — previous / next scan
  Space                — play / pause
  R / V                — reflectivity / velocity
  Up / Down            — higher / lower tilt
  Home / End           — first / last scan

Examples:
  python scope.py file1 file2 file3 ...
  python scope.py c:\\Users\\jscot\\Downloads\\KPBZ20260606_*
"""

from __future__ import annotations

import argparse
import glob
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib.widgets import Button, Slider
from pyart.graph import RadarDisplay

from radar_common import (
    FIELD_LIMITS,
    format_scan_time,
    load,
    resolve_field,
    sort_radar_files,
    sweep_with_data,
)


class RadarScope:
    def __init__(
        self,
        files: list[Path],
        *,
        field: str = "reflectivity",
        tilt: int = 0,
        interval_ms: int = 800,
    ) -> None:
        if not files:
            raise SystemExit("No radar files to display.")

        self.files = files
        self.field = field
        self.tilt = tilt
        self.interval_ms = interval_ms
        self.index = 0
        self.playing = False
        self.cache: dict[int, object] = {}

        self.fig, self.ax = plt.subplots(figsize=(10, 10))
        plt.subplots_adjust(bottom=0.16)
        self.display: RadarDisplay | None = None
        self.anim: FuncAnimation | None = None

        slider_ax = self.fig.add_axes([0.12, 0.07, 0.76, 0.03])
        self.slider = Slider(
            slider_ax,
            "Scan",
            0,
            len(self.files) - 1,
            valinit=0,
            valstep=1,
            color="#2f6fed",
        )
        self.slider.label.set_fontsize(10)

        play_ax = self.fig.add_axes([0.02, 0.02, 0.08, 0.04])
        self.play_btn = Button(play_ax, "Play")
        self.play_btn.on_clicked(self._toggle_play)

        self.fig.canvas.mpl_connect("key_press_event", self._on_key)
        self.slider.on_changed(self._on_slider)

        self._draw_frame(0, preload_neighbors=True)
        self._print_help()

    def _print_help(self) -> None:
        print(f"Loaded {len(self.files)} scans.")
        for i, path in enumerate(self.files):
            print(f"  [{i:02d}] {format_scan_time(path)}  {path.name}")
        print(
            "Controls: slider, Left/Right step, Space play/pause, R/V field, Up/Down tilt, Home/End"
        )

    def _get_radar(self, index: int):
        if index not in self.cache:
            self.cache[index] = load(self.files[index])
        return self.cache[index]

    def _preload(self, index: int) -> None:
        if 0 <= index < len(self.files) and index not in self.cache:
            self.cache[index] = load(self.files[index])

    def _field_limits(self) -> dict[str, float]:
        limits = FIELD_LIMITS.get(self.field)
        if limits:
            return {"vmin": limits[0], "vmax": limits[1]}
        return {}

    def _title(self, index: int, radar) -> str:
        station = radar.metadata.get("instrument_name", "?")
        sweep = sweep_with_data(radar, self.field, self.tilt)
        elev = float(radar.fixed_angle["data"][sweep])
        when = format_scan_time(self.files[index], radar)
        return (
            f"{station} {self.field}  {elev:.2f}°  |  {when}  "
            f"({index + 1}/{len(self.files)})"
        )

    def _draw_frame(self, index: int, *, preload_neighbors: bool = False) -> None:
        index = int(max(0, min(index, len(self.files) - 1)))
        self.index = index

        if preload_neighbors:
            self._preload(index - 1)
            self._preload(index + 1)

        radar = self._get_radar(index)
        sweep = sweep_with_data(radar, self.field, self.tilt)

        self.ax.clear()
        self.display = RadarDisplay(radar)
        self.display.plot_ppi(self.field, sweep=sweep, ax=self.ax, **self._field_limits())
        self.display.plot_range_rings(
            [25, 50, 75, 100, 125], ax=self.ax, col="0.45", ls="--", lw=0.5
        )
        self.ax.set_title(self._title(index, radar), fontsize=11)
        self.fig.canvas.draw_idle()

        if preload_neighbors:
            self._preload(index + 1)
            self._preload(index - 1)

    def _set_index(self, index: int) -> None:
        self.slider.set_val(index)

    def _on_slider(self, value: float) -> None:
        self._draw_frame(int(value), preload_neighbors=True)

    def _toggle_play(self, _event=None) -> None:
        self.playing = not self.playing
        self.play_btn.label.set_text("Pause" if self.playing else "Play")
        if self.anim is None:
            self.anim = FuncAnimation(
                self.fig,
                self._advance,
                interval=self.interval_ms,
                blit=False,
                cache_frame_data=False,
            )
        if self.playing:
            self.anim.event_source.start()
        elif self.anim.event_source:
            self.anim.event_source.stop()
        self.fig.canvas.draw_idle()

    def _advance(self, _frame: int) -> None:
        if not self.playing:
            return
        next_index = self.index + 1
        if next_index >= len(self.files):
            next_index = 0
        self._set_index(next_index)

    def _on_key(self, event) -> None:
        key = event.key
        if key == "right":
            self.playing = False
            self._set_index(self.index + 1)
        elif key == "left":
            self.playing = False
            self._set_index(self.index - 1)
        elif key == " ":
            self._toggle_play()
        elif key == "home":
            self.playing = False
            self._set_index(0)
        elif key == "end":
            self.playing = False
            self._set_index(len(self.files) - 1)
        elif key in ("r", "R"):
            self._set_field("reflectivity")
        elif key in ("v", "V"):
            self._set_field("velocity")
        elif key == "up":
            self.playing = False
            self.tilt = min(self.tilt + 1, 11)
            self._draw_frame(self.index, preload_neighbors=True)
        elif key == "down":
            self.playing = False
            self.tilt = max(self.tilt - 1, 0)
            self._draw_frame(self.index, preload_neighbors=True)

    def _set_field(self, field: str) -> None:
        radar = self._get_radar(self.index)
        self.field = resolve_field(field, list(radar.fields))
        self._draw_frame(self.index, preload_neighbors=True)

    def run(self) -> None:
        plt.show()


def expand_inputs(items: list[str]) -> list[Path]:
    paths: list[Path] = []
    for item in items:
        expanded = glob.glob(item)
        if expanded:
            paths.extend(Path(p) for p in expanded)
        else:
            paths.append(Path(item))
    return paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="Radar files or globs")
    parser.add_argument("-f", "--field", default="reflectivity")
    parser.add_argument("-t", "--tilt", type=int, default=0)
    parser.add_argument(
        "--speed",
        type=int,
        default=800,
        help="Milliseconds between frames when playing (default: 800)",
    )
    parser.add_argument(
        "--include-mdm",
        action="store_true",
        help="Include *_MDM sidecar files",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    paths = expand_inputs(args.files)
    files = sort_radar_files(paths, skip_mdm=not args.include_mdm)
    if not files:
        raise SystemExit("No matching radar files found.")

    first = load(files[0])
    field = resolve_field(args.field, list(first.fields))

    RadarScope(
        files,
        field=field,
        tilt=args.tilt,
        interval_ms=args.speed,
    ).run()


if __name__ == "__main__":
    main()
