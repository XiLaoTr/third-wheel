"""Generate the parts-library catalogue that ships with the desktop app.

Developer tool, not part of the app's runtime: it needs Python with build123d, bd_warehouse and numpy
(for example `uv venv --python 3.12 .venv && uv pip install --python .venv/Scripts/python.exe build123d bd_warehouse numpy`).

    python scripts/library/generate_catalogue.py [output_dir]

Default output: apps/desktop/src/renderer/src/library/data/
    catalogue.json   what the panel lists: modules, groups, classes, search keywords, and for every class what
                     its preview was built with, its size in mm, its sub-part counts and where its mesh is
    meshes.bin       the preview meshes: per class int16 positions (centred, scaled to +-32767 of half the
                     largest side) then uint16 / uint32 triangle indices, each block padded to 4 bytes
    report.json      every class that was tried: ok or the error (not read by the app)
    unbuildable.json sizes the library lists in its tables but cannot build (left out of the size choices)

The catalogue is data: it is regenerated when bd_warehouse changes (and the changes reviewed), never at run time.
The defaults in DEFAULTS are chosen by a person; "the middle entry of a table" gave a 189 mm O-ring that previews
as a flat oval.
"""

import ast
import datetime
import importlib
import importlib.metadata
import inspect
import itertools
import json
import os
import re
import sys
import time
import traceback
import typing
from pathlib import Path

import numpy as np
from build123d import Shape

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "apps/desktop/src/renderer/src/library/data"
OUT.mkdir(parents=True, exist_ok=True)
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))  # debug: ONLY=IsoThread,Thread
TRIS_CAP = 5000

# (module id, label, [(group, [classes], is_operation)])
MODULES = [
    ("fastener", "Fasteners", [
        ("Screws", ["SocketHeadCapScrew", "ButtonHeadScrew", "ButtonHeadWithCollarScrew", "CheeseHeadScrew", "CounterSunkScrew", "HexHeadScrew", "HexHeadWithFlangeScrew", "LowProfileScrew", "PanHeadScrew", "PanHeadWithCollarScrew", "RaisedCheeseHeadScrew", "RaisedCounterSunkOvalHeadScrew", "SetScrew", "ShoulderScrew"], False),
        ("Nuts", ["HexNut", "HexNutWithFlange", "DomedCapNut", "SquareNut", "UnchamferedHexagonNut", "HeatSetNut"], False),
        ("Washers", ["PlainWasher", "ChamferedWasher", "CheeseHeadWasher", "InternalToothLockWasher"], False),
        ("Hole tools", ["ClearanceHole", "TapHole", "ThreadedHole", "InsertHole"], True),
    ]),
    ("bearing", "Bearings", [
        ("Bearings", ["SingleRowDeepGrooveBallBearing", "SingleRowCappedDeepGrooveBallBearing", "SingleRowAngularContactBallBearing", "SingleRowCylindricalRollerBearing", "SingleRowTaperedRollerBearing"], False),
        ("Hole tools", ["PressFitHole"], True),
    ]),
    ("o_rings", "O-rings", [("O-rings", ["ORing"], False)]),
    ("gear", "Gears", [("Gears", ["SpurGear", "HelicalGear", "RackGear", "WormGear", "Worm", "WormWheel"], False)]),
    ("sprocket", "Sprockets", [("Sprockets", ["Sprocket"], False)]),
    ("shaft_key", "Shaft keys", [("Keys", ["ShaftKey"], False), ("Slot tools", ["Keyway"], True)]),
    ("retaining_ring", "Retaining rings", [("Rings", ["ExternalSnapRing", "InternalSnapRing"], False), ("Groove tools", ["RetainingRingGroove"], True)]),
    ("flange", "Flanges", [("Flanges", ["SlipOnFlange", "BlindFlange", "LappedFlange", "LappedFlangeStub", "SocketWeldFlange", "WeldNeckFlange"], False)]),
    ("pipe", "Pipes", [("Pipes", ["Pipe", "PipeSection"], False)]),
    ("bushing", "Bushings", [("Bushings", ["HexFlangedEccentricBushing"], False)]),
    ("thread", "Threads", [("Threads", ["IsoThread", "AcmeThread", "BSPPThread", "WhitworthThread", "MetricTrapezoidalThread", "TrapezoidalThread", "PlasticBottleThread", "PlasticBottleThreadMatch", "Thread"], False)]),
    ("open_builds", "OpenBuilds", [
        ("Parts", ["VSlotLinearRail", "CBeamLinearRail", "TNut", "StepperMotor", "XtremeSolidVWheel", "LockCollar", "FlexibleCoupler", "MetricLeadScrew", "LBracket", "AluminumSpacer", "EccentricSpacer", "ShimWasher", "SpacerBlock", "RouterSpindleMount", "CBeamCapped", "CBeamEndMount", "CBeamGantryPlate", "CBeamGantryPlateXLarge", "CBeamRiserPlate", "AcmeAntiBacklashNutBlock8mm"], False),
        ("Assemblies and profiles", ["CBeamAssembly", "CBeamEndAssembly", "XLargeCBeamGantry", "XtremeSolidVWheelAssembly", "AcmeAntiBacklashNutBlock8mmAssembly", "VSlotLinearRailProfile", "CBeamLinearRailProfile"], False),
    ]),
]

# Search keywords, English and Chinese, so that "螺絲" or "seal" find the right classes.
KEYWORDS = {
    "SocketHeadCapScrew": "screw bolt socket cap hex 螺絲 內六角 螺栓", "ButtonHeadScrew": "screw bolt button 螺絲 圓頭", "HexHeadScrew": "screw bolt hex 螺絲 外六角 螺栓", "CounterSunkScrew": "screw flat countersunk 螺絲 平頭 沉頭", "PanHeadScrew": "screw pan 螺絲 盤頭", "SetScrew": "set grub screw 止付螺絲 固定螺絲", "LowProfileScrew": "screw low profile openbuilds 螺絲 低頭",
    "HexNut": "nut 螺帽 螺母", "HeatSetNut": "heat set insert nut brass 熱熔 銅嵌件 螺帽", "SquareNut": "nut square 方螺帽", "DomedCapNut": "nut cap dome 蓋型螺帽",
    "PlainWasher": "washer 墊圈 華司 平墊圈", "InternalToothLockWasher": "washer lock tooth 彈簧墊圈 鎖緊",
    "ClearanceHole": "hole clearance drill 孔 穿孔 鑽孔 螺絲孔", "TapHole": "hole tap thread 攻牙 螺紋孔", "ThreadedHole": "hole thread 螺紋孔", "InsertHole": "hole heat set insert 熱熔 嵌件孔", "PressFitHole": "hole bearing press fit 軸承 壓入孔",
    "SingleRowDeepGrooveBallBearing": "bearing ball rotate shaft 軸承 滾珠 旋轉 軸", "SingleRowCappedDeepGrooveBallBearing": "bearing sealed capped dust 軸承 密封 防塵", "SingleRowTaperedRollerBearing": "bearing tapered roller 軸承 圓錐滾子", "SingleRowCylindricalRollerBearing": "bearing cylindrical roller 軸承 圓柱滾子", "SingleRowAngularContactBallBearing": "bearing angular contact 軸承 角接觸",
    "ORing": "o-ring oring seal gasket waterproof 密封 防水 o型環 墊片", "SpurGear": "gear spur teeth 齒輪 正齒輪 傳動", "HelicalGear": "gear helical 斜齒輪", "RackGear": "gear rack 齒條", "WormGear": "gear worm 蝸桿 蝸輪 減速", "Sprocket": "sprocket chain 鏈輪 鏈條",
    "ShaftKey": "key shaft keyway 軸鍵 鍵", "Keyway": "keyway slot key 鍵槽", "ExternalSnapRing": "circlip snap ring retaining 扣環 卡環 外扣環", "InternalSnapRing": "circlip snap ring retaining 扣環 卡環 內扣環", "RetainingRingGroove": "groove snap ring 扣環溝槽",
    "SlipOnFlange": "flange pipe 法蘭 管 管法蘭", "Pipe": "pipe tube 管 水管", "HexFlangedEccentricBushing": "bushing eccentric 襯套 偏心", "IsoThread": "thread iso metric 螺紋 公制", "AcmeThread": "thread acme lead screw 螺紋 梯形 導螺桿", "PlasticBottleThread": "thread bottle cap 瓶口 螺紋 瓶蓋", "WhitworthThread": "thread whitworth 惠氏螺紋 螺紋",
    "VSlotLinearRail": "v-slot extrusion aluminum rail profile 鋁擠型 導軌", "TNut": "v-slot t-nut extrusion 鋁擠型 t型螺帽", "StepperMotor": "motor stepper nema 馬達 步進", "FlexibleCoupler": "coupler shaft motor 聯軸器", "LockCollar": "collar shaft 鎖環 軸環", "MetricLeadScrew": "lead screw 導螺桿", "LBracket": "bracket angle 角碼 支架",
}

# Parameters used for free numeric arguments, by name, when a class has no table to take a default from.
NUM = {
    "module": 2, "tooth_count": 20, "num_teeth": 20, "pressure_angle": 20, "helix_angle": 15, "thickness": 8,
    "starts": 1, "diametral_quotient": 10, "length": 20, "worm_length": 30, "major_diameter": 10, "pitch": 1.5,
    "diameter": 10, "apex_radius": 5, "apex_width": 0.5, "root_radius": 4, "root_width": 0.8, "thread_angle": 30,
    "shaft_diameter": 8, "bore_diameter": 8, "body_diameter": 24, "body_length": 12, "flange_height": 3,
    "rail_length": 100, "screw_length": 20, "depth": 10, "eccentricity": 2, "hex_size": 28,
}
# Reviewed defaults: the value a person would expect to see first (checked class by class, not "middle of the table").
DEFAULTS = {
    "SocketHeadCapScrew": {"size": "M6-1", "length": 20, "fastener_type": "iso4762"},
    "HexNut": {"size": "M6-1", "fastener_type": "iso4032"},
    "ORing": {"size": "209"},  # 24.1 mm x 3.53 mm; the middle of the table is a 189 mm ring
}
CLASS_STR = {"BSPPThread": {"size": "G1/2"}, "PlasticBottleThread": {"size": "M38SP444"}}
SKIP = {"self", "rotation", "align", "mode", "args", "kwargs"}


def first_literal(ann, ns):
    if isinstance(ann, str):
        try:
            ann = eval(ann, ns)  # noqa: S307 - annotations of the installed library itself
        except Exception:
            return None
    origin = typing.get_origin(ann)
    if origin is typing.Literal:
        return typing.get_args(ann)[0]
    if origin is typing.Union:
        for a in typing.get_args(ann):
            v = first_literal(a, ns)
            if v is not None:
                return v
    return None


def table_choice(cls):
    try:
        t = sorted(cls.types())[0]
        s = cls.sizes(t)
        return t, s[len(s) // 3]
    except Exception:
        pass
    try:  # one size table without standards, e.g. AcmeThread
        s = cls.sizes()
        return None, s[len(s) // 3]
    except Exception:
        return None, None


def synth(cls):
    ns = dict(importlib.import_module(cls.__module__).__dict__)
    sig = inspect.signature(cls.__init__)
    t, s = table_choice(cls)
    kw = {}
    for name, p in sig.parameters.items():
        if name in SKIP or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name == "simple":
            # fasteners: simple=True skips the thread geometry (light). In the thread module the same flag means
            # "build no thread at all" and leaves an empty object, so keep the real thread there.
            kw[name] = cls.__module__ != "bd_warehouse.thread"
            continue
        if name.endswith("_type") and t is not None and p.default is inspect._empty:
            kw[name] = t
            continue
        if name == "size" and s is not None:
            kw[name] = s
            continue
        if p.default is not inspect._empty:
            continue
        if name in CLASS_STR.get(cls.__name__, {}):
            kw[name] = CLASS_STR[cls.__name__][name]
            continue
        if name == "nps":
            kw[name] = "2"
            continue
        lit = first_literal(p.annotation, ns)
        if lit is not None:
            kw[name] = lit
        elif name in NUM:
            kw[name] = NUM[name]
        elif p.annotation in (str, "str"):
            kw[name] = "x"  # placeholder: the library's error message lists the valid values
        elif p.annotation in (bool, "bool"):
            kw[name] = False
        elif p.annotation in (int, float, "int", "float"):
            kw[name] = 10
        else:
            kw[name] = None
    return kw


def simple_params(kw):
    return {k: v for k, v in kw.items() if isinstance(v, (int, float, str, bool))}


def with_retry(cls, extra=None):
    kw = synth(cls)
    kw.update(extra or {})
    pipe = importlib.import_module("bd_warehouse.pipe")
    for _ in range(4):
        try:
            return cls(**kw), simple_params(kw)
        except ValueError as e:
            msg = str(e)
            m = re.search(r"must be one of (\[.*?\])", msg)
            if m:
                choices = ast.literal_eval(m.group(1))
                bad = [k for k, v in kw.items() if k == "size" or (isinstance(v, str) and v not in choices)]
                if bad:
                    kw[bad[0]] = choices[0]
                    continue
            if "No pipe data" in msg:  # find a material / identifier that exists for this size
                for mat, ident in itertools.product(typing.get_args(pipe.Material), typing.get_args(pipe.Identifier)):
                    kw2 = dict(kw)
                    if "material" in kw2:
                        kw2["material"] = mat
                    if "identifier" in kw2:
                        kw2["identifier"] = ident
                    try:
                        return cls(**kw2), simple_params(kw2)
                    except ValueError:
                        continue
            raise
    return cls(**kw), simple_params(kw)


UNITS = {"angle": "°", "count": "", "teeth": "", "starts": "", "quotient": ""}


def unit_of(name):
    for k, u in UNITS.items():
        if k in name:
            return u
    return "mm"


def literal_choices(ann, ns):
    if isinstance(ann, str):
        try:
            ann = eval(ann, ns)  # noqa: S307 - annotations of the installed library itself
        except Exception:
            return None
    origin = typing.get_origin(ann)
    if origin is typing.Literal:
        return list(typing.get_args(ann))
    if origin is typing.Union:
        for a in typing.get_args(ann):
            c = literal_choices(a, ns)
            if c:
                return c
    return None


UNBUILDABLE = []  # (class, type, size, error): sizes the library lists but cannot build; written to report.json


def buildable(cls, params, type_param, type_value, size):
    """Whether the library can build this size (its tables disagree: bd_warehouse 0.4.0 lists ASME #0, #1 and
    #2 screws but raises KeyError '#1' when building them). Built with the preview's other parameters."""
    kw = dict(params)
    kw["size"] = size
    if type_param:
        kw[type_param] = type_value
    try:
        cls(**kw)
        return True
    except Exception as e:  # noqa: BLE001 - recorded, not hidden
        UNBUILDABLE.append({"class": cls.__name__, "type": type_value, "size": size, "error": f"{type(e).__name__}: {str(e)[:80]}"})
        return False


def option_specs(cls, params):
    """What a user may choose for a class: standard types and sizes (from the library's own tables),
    other fixed choices, and free numbers with the default the preview used. Missing = nothing to choose."""
    ns = dict(importlib.import_module(cls.__module__).__dict__)
    sig = inspect.signature(cls.__init__)
    try:
        types = sorted(cls.types())
    except Exception:
        types = None
    type_param = next((n for n in sig.parameters if n.endswith("_type")), None) if types else None
    out = []
    if type_param and types:
        out.append({"name": type_param, "kind": "choice", "choices": types})
    if "size" in sig.parameters:
        try:
            if types and type_param:
                sizes = {
                    t: [z for z in cls.sizes(t) if buildable(cls, params, type_param, t, z)] for t in types
                }
                sizes = {t: v for t, v in sizes.items() if v}
            else:
                sizes = [z for z in cls.sizes() if buildable(cls, params, None, None, z)]
            if isinstance(sizes, dict) and out and out[0]["name"] == type_param:
                out[0]["choices"] = [t for t in types if t in sizes]  # a standard with nothing buildable is not offered
            same = isinstance(sizes, dict) and len({tuple(v) for v in sizes.values()}) == 1
            if same:
                sizes = next(iter(sizes.values()))
            if sizes:
                spec = {"name": "size", "kind": "size", "sizes": sizes}
                if isinstance(sizes, dict):
                    spec["typeParam"] = type_param
                out.append(spec)
        except Exception:
            pass
    # Screws and nuts: `simple=True` (the library default) leaves the thread out. Elsewhere (thread module,
    # OpenBuilds) the same flag means something else, so it is not offered there.
    if "simple" in sig.parameters and cls.__module__ == "bd_warehouse.fastener":
        out.append({"name": "simple", "kind": "flag", "on": "No thread (simple)", "off": "With thread"})
    for name, p in sig.parameters.items():
        if name in SKIP or name in ("simple", "size", type_param) or p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name not in params:
            continue
        choices = literal_choices(p.annotation, ns)
        if choices and all(isinstance(c, (str, int)) for c in choices):
            out.append({"name": name, "kind": "choice", "choices": choices})
        elif isinstance(params[name], (int, float)) and not isinstance(params[name], bool):
            out.append({"name": name, "kind": "number", "default": params[name], "unit": unit_of(name)})
    return out


def build(cls_name, mod_name):
    mod = importlib.import_module(f"bd_warehouse.{mod_name}")
    cls = getattr(mod, cls_name)
    F = importlib.import_module("bd_warehouse.fastener")
    B = importlib.import_module("bd_warehouse.bearing")
    screw = lambda: F.SocketHeadCapScrew(size="M6-1", length=20, fastener_type="iso4762", simple=True)  # noqa: E731
    if cls_name in ("ClearanceHole", "TapHole", "ThreadedHole"):
        return cls(screw(), depth=10), {"fastener": "SocketHeadCapScrew M6-1 x 20", "depth": 10}
    if cls_name == "InsertHole":
        t = sorted(F.HeatSetNut.types())[0]
        size = next(s for s in F.HeatSetNut.sizes(t) if s.startswith("M6-"))
        return cls(F.HeatSetNut(size=size, fastener_type=t), depth=10), {"fastener": f"HeatSetNut {size}", "depth": 10}
    if cls_name == "PressFitHole":
        return cls(B.SingleRowDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")), {"bearing": "M8-22-7"}
    if cls_name == "Keyway":
        key = importlib.import_module("bd_warehouse.shaft_key").ShaftKey(shaft_diameter=8, length=20)
        return cls(key), {"key": "ShaftKey d8 x 20"}
    if cls_name == "RetainingRingGroove":
        ring, _ = with_retry(importlib.import_module("bd_warehouse.retaining_ring").ExternalSnapRing)
        return cls(ring), {"ring": "ExternalSnapRing"}
    if cls_name == "PlasticBottleThreadMatch":
        raise RuntimeError("needs an existing PlasticBottleThread to match: not previewable on its own")
    if cls_name == "Pipe":
        from build123d import Line
        obj, params = with_retry(cls, {"path": Line((0, 0, 0), (0, 0, 100))})
        return obj, {**params, "path": "line of 100 mm"}
    return with_retry(cls, DEFAULTS.get(cls_name))


def child_labels(obj, depth=2):
    """Counts of the labels of an object's children (and theirs, `depth` levels down): its sub-part names."""
    out = {}

    def walk(o, d):
        for k in getattr(o, "children", None) or []:
            name = getattr(k, "label", "") or ""
            if name:
                out[name] = out.get(name, 0) + 1
            if d > 1:
                walk(k, d - 1)

    walk(obj, depth)
    return out


def to_mesh(shape):
    """(int16 positions array (n,3), index array (m,3), bbox size, bbox centre, decimated)"""
    assert isinstance(shape, Shape), type(shape)
    bb = shape.bounding_box()
    size = max(bb.size.X, bb.size.Y, bb.size.Z) or 1.0
    verts, tris = shape.tessellate(size / 100, 0.5)
    if not tris:
        raise RuntimeError("empty tessellation (no faces)")
    V = np.array([[v.X, v.Y, v.Z] for v in verts], dtype=np.float64)
    T = np.array(tris, dtype=np.int64)
    decimated = False
    if len(T) > TRIS_CAP:  # vertex clustering: merge vertices on a grid until under the cap
        lo, span = V.min(0), (V.max(0) - V.min(0)).max() or 1.0
        for res in (200, 160, 128, 100, 80, 64, 48, 40, 32, 24):
            q = np.floor((V - lo) / span * res).astype(np.int64)
            key = (q[:, 0] * res + q[:, 1]) * res + q[:, 2]
            _, inv = np.unique(key, return_inverse=True)
            cnt = np.bincount(inv).astype(np.float64)
            newV = np.stack([np.bincount(inv, weights=V[:, a]) / cnt for a in range(3)], axis=1)
            newT = inv[T]
            keep = (newT[:, 0] != newT[:, 1]) & (newT[:, 1] != newT[:, 2]) & (newT[:, 0] != newT[:, 2])
            newT = newT[keep]
            if len(newT) <= TRIS_CAP:
                break
        V, T, decimated = newV, newT, True
    c = np.array([bb.center().X, bb.center().Y, bb.center().Z])
    q16 = np.clip(np.round((V - c) / (size / 2) * 32767), -32767, 32767).astype("<i2")
    return q16, T, [round(bb.size.X, 2), round(bb.size.Y, 2), round(bb.size.Z, 2)], [round(float(x), 3) for x in c], decimated


def pad4(buf: bytearray) -> None:
    buf.extend(b"\0" * (-len(buf) % 4))


classes = {}
report = []
blob = bytearray()
t_all = time.time()
for mod_id, label, groups in MODULES:
    for group, names, is_op in groups:
        for cls_name in names:
            if ONLY and cls_name not in ONLY:
                continue
            entry = {"module": mod_id, "group": group, "operation": is_op, "keywords": KEYWORDS.get(cls_name, "")}
            rec = {"class": cls_name, "module": mod_id}
            t0 = time.time()
            try:
                obj, params = build(cls_name, mod_id)
                q16, T, size, centre, dec = to_mesh(obj)
                wide = len(q16) > 65535
                offset = len(blob)
                blob.extend(q16.tobytes())
                pad4(blob)
                blob.extend(T.astype("<u4" if wide else "<u2").tobytes())
                pad4(blob)
                if not is_op:
                    opts = option_specs(getattr(importlib.import_module(f"bd_warehouse.{mod_id}"), cls_name), params)
                    if opts:
                        entry["options"] = opts
                entry["preview"] = {
                    "params": params, "size": size, "centre": centre, "solids": len(obj.solids()),
                    "parts": child_labels(obj),
                    "mesh": {"offset": offset, "vertices": int(len(q16)), "triangles": int(len(T)), "wide": wide},
                }
                rec.update(ok=True, triangles=int(len(T)), decimated=dec)
            except Exception as e:  # noqa: BLE001 - every failure is recorded, not hidden
                if ONLY:
                    traceback.print_exc()
                tb = traceback.extract_tb(e.__traceback__)[-1]
                rec.update(ok=False, error=f"{type(e).__name__}: {str(e)[:110]}", where=f"{Path(tb.filename).name}:{tb.lineno}")
            rec["sec"] = round(time.time() - t0, 2)
            classes[cls_name] = entry
            report.append(rec)
            print(("OK   " if rec["ok"] else "FAIL ") + f"{cls_name:42s} " + (f"{rec['triangles']:6d} tris" if rec["ok"] else rec["error"]))

catalogue = {
    "format": 1,
    "library": "bd_warehouse",
    "libraryVersion": importlib.metadata.version("bd_warehouse"),
    "generated": datetime.date.today().isoformat(),
    "modules": [
        {"id": mod_id, "label": label, "groups": [{"name": g, "operation": op, "classes": [n for n in names if n in classes]} for g, names, op in groups]}
        for mod_id, label, groups in MODULES
    ],
    "classes": classes,
}
(OUT / "catalogue.json").write_text(json.dumps(catalogue, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
(OUT / "meshes.bin").write_bytes(bytes(blob))
(OUT / "unbuildable.json").write_text(json.dumps(UNBUILDABLE, indent=1) + chr(10), encoding="utf-8")
(OUT / "report.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
ok = sum(1 for r in report if r["ok"])
print(f"\n{ok} of {len(report)} classes built; catalogue.json {(OUT / 'catalogue.json').stat().st_size / 1024:.0f} KB, meshes.bin {len(blob) / 1024:.0f} KB; {time.time() - t_all:.0f} s")
