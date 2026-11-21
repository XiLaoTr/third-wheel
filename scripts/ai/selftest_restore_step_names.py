"""Self-test of restore_step_names.py (needs build123d): python scripts/ai/selftest_restore_step_names.py"""

import re
import sys
import tempfile
from pathlib import Path

from build123d import Box, Compound, Cylinder, Pos, export_step

sys.path.insert(0, str(Path(__file__).parent))
from restore_step_names import main  # noqa: E402


def products(path):
    return sorted(re.findall(r"PRODUCT\('([^']*)'", Path(path).read_text(encoding="utf8", errors="replace")))


with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    plate = Box(40, 20, 6)
    pin = Pos(30, 0, 5) * Cylinder(3, 10)
    plate.label, pin.label = "Base plate (v1)", "Pin"
    export_step(Compound(label="Assembly", children=[Compound(label="Frame", children=[plate]), pin]), d / "v1.step")

    # What an AI's edit leaves: the plate has a hole (same bounding box), names are gone, a screw is new.
    hole = Pos(0, 0, 0) * Cylinder(2, 6)
    plate2 = plate - hole
    screw = Pos(0, 0, 8) * Cylinder(1.5, 8)
    screw.label = "Screw M3 (Hole 1)"
    export_step(Compound(children=[plate2, Pos(30, 0, 5) * Cylinder(3, 10), screw]), d / "v2.step")

    main(str(d / "v1.step"), str(d / "v2.step"), str(d / "v3.step"))
    got = products(d / "v3.step")
    want = ["Assembly", "Base plate (v1)", "Frame", "Pin", "Screw M3 (Hole 1)"]
    assert all(w in got for w in want), f"names missing: wanted {want}, got {got}"
    assert "SOLID" not in got, f"generic names left: {got}"
    print("selftest ok:", got)
