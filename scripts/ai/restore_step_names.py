"""Give a new STEP export the body names and assembly nesting of the version it came from.

For an AI that edits a model with build123d: `import_step`, boolean results and `export_step` drop the names the
user sees in Third Wheel's Bodies list (it shows SOLID / COMPOUND / codes like =>[0:1:1:2], flat). Run this after
exporting the new version:

    python restore_step_names.py previous.step new.step restored.step

then `load_model` restored.step with `revisionOf` = the previous version's modelId.

How: every solid of the previous file is matched to a solid of the new one by its bounding box (a hole, fillet or
pocket does not change it), and the new solid takes the old name; the old nesting (Compound > Compound > solid) is
rebuilt around them. Parts that exist only in the new file (screws you added) keep the label you gave them and go at
the top level; parts that exist only in the old file (removed ones) are left out. Prints what it did and exits 1 if
nothing could be matched. Needs build123d (the same one you edit with).
"""

import re
import sys

from build123d import Compound, export_step, import_step


def leaves(shape):
    kids = getattr(shape, "children", None)
    return [shape] if not kids else [leaf for k in kids for leaf in leaves(k)]


def box(shape):
    bb = shape.bounding_box()
    return (bb.center().X, bb.center().Y, bb.center().Z), (bb.size.X, bb.size.Y, bb.size.Z)


def same_box(a, b):
    tol = max(0.05, 1e-3 * max(max(a[1]), max(b[1])))
    return all(abs(x - y) <= tol for x, y in zip(a[0] + a[1], b[0] + b[1]))


def main(previous_path, new_path, out_path):
    # build123d turns "Screw M5-0.8x16 (Hole 1)" into "Screw_M5-0_8x16__Hole_1_": read the real names from the file.
    real = {}
    for path in (previous_path, new_path):  # the new file's names too: "Extra block" must not become "Extra_block"
        text = open(path, encoding="utf8", errors="replace").read()
        real.update({re.sub(r"[^A-Za-z0-9\-]", "_", n): n for n in re.findall(r"PRODUCT\('([^']*)'", text)})
    previous = import_step(previous_path)
    new = import_step(new_path)

    free = list(leaves(new))  # new solids not yet given an old name
    matched = []

    def take(old):
        for i, n in enumerate(free):
            if same_box(box(old), box(n)):
                matched.append((old, n))
                return free.pop(i)
        return None

    def rebuild(old):
        label = real.get(old.label, old.label)
        if not getattr(old, "children", None):
            n = take(old)
            if n is None:
                print(f"  left out (not in the new file): {label}")
                return None
            n.label = label
            print(f"  {label}")
            return n
        kids = [k for k in (rebuild(c) for c in old.children) if k is not None]
        return Compound(label=label, children=kids) if kids else None

    root = rebuild(previous)
    if not matched or root is None:
        print("nothing of the previous version could be matched: is it the same part?")
        sys.exit(1)
    for n in free:
        n.label = real.get(n.label, n.label)
        print(f"  new part kept as it is: {n.label or '(no label)'}")
    result = Compound(label=root.label, children=[*root.children, *free])
    export_step(result, out_path)
    print(f"written {out_path}: {len(matched)} named, {len(free)} new")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:4])
