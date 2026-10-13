"""Dump reference values from Py-ART for the decoder unit tests (the correctness oracle).

  python scripts/make_oracle.py test/fixtures/KTLX20130520_195527_V06.gz test/oracle/ktlx_195527.json
"""

import json
import sys
from pathlib import Path

import numpy as np
import pyart

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prototype"))
from radar_common import sweep_with_data  # noqa: E402

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
radar = pyart.io.read_nexrad_archive(str(src))
out = {
    "file": src.name,
    "lat": float(radar.latitude["data"][0]),
    "lon": float(radar.longitude["data"][0]),
    "time_units": radar.time["units"],
    "vcp": radar.metadata.get("vcp_pattern"),
}
rng = np.random.default_rng(7)
for field, key in (("reflectivity", "REF"), ("velocity", "VEL")):
    sweep = sweep_with_data(radar, field, 0)
    sl = radar.get_slice(sweep)
    data = radar.fields[field]["data"][sl]
    nrays = data.shape[0]
    valid = np.argwhere(~np.ma.getmaskarray(data))
    picks = valid[rng.choice(len(valid), size=40, replace=False)]
    samples = [
        {"ray": int(r), "gate": int(g), "value": float(data[r, g]), "az": float(radar.azimuth["data"][sl][r])}
        for r, g in picks
    ]
    out[key] = {
        "sweep": int(sweep),
        "rays": int(nrays),
        "valid_gates": int(len(valid)),
        "first_gate_m": float(radar.range["data"][0]),
        "gate_spacing_m": float(radar.range["data"][1] - radar.range["data"][0]),
        "elevation": float(radar.fixed_angle["data"][sweep]),
        "samples": samples,
    }
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, indent=1))
print(f"wrote {dst}: REF rays {out['REF']['rays']}, VEL rays {out['VEL']['rays']}")
