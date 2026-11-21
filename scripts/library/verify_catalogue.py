"""Check that every standard size the catalogue offers can really be built.

Developer tool (same Python setup as generate_catalogue.py). It reads the shipped catalogue, builds each
offered (type, size) of every class with the preview's other parameters, and exits 1 if any fails:

    python scripts/library/verify_catalogue.py [catalogue.json]

Run it after regenerating the catalogue or upgrading bd_warehouse. bd_warehouse 0.4.0 lists ASME #0, #1 and
#2 screws in its size table but raises KeyError when building them; the generator leaves such sizes out
(unbuildable.json), and this script makes sure none slipped through. `ONLY=Class1,Class2` limits it.
"""

import importlib
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "apps/desktop/src/renderer/src/library/data/catalogue.json"
only = set(filter(None, os.environ.get("ONLY", "").split(",")))
catalogue = json.loads(path.read_text(encoding="utf-8"))

checked = 0
failures = []
t0 = time.time()
for name, entry in catalogue["classes"].items():
    if only and name not in only:
        continue
    size_opt = next((o for o in entry.get("options", []) if o["kind"] == "size"), None)
    preview = entry.get("preview")
    if not size_opt or not preview:
        continue
    cls = getattr(importlib.import_module(f"bd_warehouse.{entry['module']}"), name)
    sizes = size_opt["sizes"]
    pairs = (
        [(size_opt.get("typeParam"), t, z) for t, zs in sizes.items() for z in zs]
        if isinstance(sizes, dict)
        else [(None, None, z) for z in sizes]
    )
    for type_param, type_value, size in pairs:
        kw = dict(preview["params"])
        kw["size"] = size
        if type_param:
            kw[type_param] = type_value
        checked += 1
        try:
            cls(**kw)
        except Exception as e:  # noqa: BLE001 - every failure is reported
            failures.append(f"{name} {type_value or ''} {size}: {type(e).__name__}: {str(e)[:80]}")

print(f"{checked} offered sizes checked in {time.time() - t0:.0f} s")
if failures:
    print(f"{len(failures)} cannot be built (they must be left out of the catalogue):")
    for f in failures:
        print("  " + f)
    sys.exit(1)
print("all can be built")
