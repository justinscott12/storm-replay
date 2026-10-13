"""Py-ART reference image with equal aspect, zoomed on the radar, for side-by-side checks.

  python scripts/oracle_plot.py test/fixtures/KTLX20130520_195527_V06.gz output/oracle.png [reflectivity|velocity] [km]
"""

import sys
from pathlib import Path

import matplotlib.pyplot as plt
import pyart

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prototype"))
from radar_common import FIELD_LIMITS, sweep_with_data  # noqa: E402

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
field = sys.argv[3] if len(sys.argv) > 3 else "reflectivity"
km = float(sys.argv[4]) if len(sys.argv) > 4 else 80
radar = pyart.io.read_nexrad_archive(str(src))
sweep = sweep_with_data(radar, field, 0)
fig, ax = plt.subplots(figsize=(8, 8))
display = pyart.graph.RadarDisplay(radar)
lo, hi = FIELD_LIMITS[field]
display.plot_ppi(field, sweep=sweep, ax=ax, vmin=lo, vmax=hi, colorbar_flag=False, title_flag=False)
display.plot_range_rings([25, 50, 75], ax=ax, col="0.5", ls="--", lw=0.5)
ax.set_xlim(-km, km)
ax.set_ylim(-km, km)
ax.set_aspect("equal")
ax.set_title(f"Py-ART {field} sweep {sweep}, {src.name}")
fig.savefig(dst, dpi=100, bbox_inches="tight")
print(f"saved {dst}")
