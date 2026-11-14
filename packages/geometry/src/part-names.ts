/**
 * Part names from the STEP assembly tree (XCAF), linked to our bodies.
 *
 * In STEP the name lives on the assembly tree (product / instance), which points at the geometry.
 * OCCT builds the model shape from that tree in tree order, so the k-th solid met in a depth-first
 * walk of the tree is body k. That is construction, not a guess — but we still verify every pair
 * by bounding box (an exact `isSame` check fails because OCCT represents composed placements
 * differently), and fall back to "Body N" for all bodies if anything disagrees.
 */
import type { LabelTag, OcctKernel, ShapeHandle, XCAFDocument } from 'occt-wasm';

export interface PartInfo {
  /** Instance name (e.g. "M3 screw"), or "" if the file has none. */
  readonly name: string;
  /** Names of the enclosing assemblies, outermost first. */
  readonly path: readonly string[];
  /** Innermost enclosing named assembly (index into {@link PartTree.assemblies}), or -1. */
  readonly assembly: number;
}

/** A named assembly instance in the STEP tree (two copies of a sub-assembly are two entries). */
export interface AssemblyInfo {
  readonly name: string;
  /** Enclosing assembly (always a lower index), or -1 at the top. */
  readonly parent: number;
}

export interface PartTree {
  /** One entry per body (solid), in body-id order. */
  readonly parts: readonly PartInfo[];
  /** Named assembly instances, parents before children. */
  readonly assemblies: readonly AssemblyInfo[];
}

const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** Product of two 3×4 row-major affine matrices (a · b). */
function compose(a: readonly number[], b: readonly number[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++) {
      let s = j === 3 ? (a[i * 4 + 3] ?? 0) : 0;
      for (let k = 0; k < 3; k++) s += (a[i * 4 + k] ?? 0) * (b[k * 4 + j] ?? 0);
      r.push(s);
    }
  return r;
}

/** Loose (non-precise) boxes: the precise ones cost ~2 s on a 130-body assembly; both sides use the same mode. */
function sameBox(kernel: OcctKernel, a: ShapeHandle, b: ShapeHandle): boolean {
  const p = kernel.getBoundingBox(a, { precise: false });
  const q = kernel.getBoundingBox(b, { precise: false });
  const pv = [p.xmin, p.ymin, p.zmin, p.xmax, p.ymax, p.zmax];
  const qv = [q.xmin, q.ymin, q.zmin, q.xmax, q.ymax, q.zmax];
  const size = Math.max(p.xmax - p.xmin, p.ymax - p.ymin, p.zmax - p.zmin, 1);
  const tol = size * 1e-6 + 1e-6;
  return pv.every((v, i) => Math.abs(v - (qv[i] ?? NaN)) <= tol);
}

/**
 * One {@link PartInfo} per solid in `solids` (the model's bodies, in id order) plus the named
 * assemblies, or `null` if the tree doesn't line up with the bodies (then callers use placeholder
 * names and no folders).
 */
export function readPartInfo(
  kernel: OcctKernel,
  doc: XCAFDocument,
  solids: readonly ShapeHandle[],
): PartTree | null {
  const parts: PartInfo[] = [];
  const assemblies: AssemblyInfo[] = [];
  let ok = true as boolean; // set inside `walk`; widen so TS doesn't narrow it to `true`
  const walk = (
    label: LabelTag,
    placement: readonly number[],
    path: readonly string[],
    assembly: number,
  ): void => {
    if (!ok) return;
    const info = doc.getLabelInfo(label);
    const proto = doc.getReferredLabel(label) ?? label;
    const name = info.name || doc.getLabelInfo(proto).name;
    const children = doc.getChildren(proto);
    if (children.length === 0) {
      // A leaf's own shape already carries its own placement; add the enclosing assemblies'.
      if (!info.shapeHandle) return;
      for (const local of kernel.getSubShapes(info.shapeHandle, 'solid')) {
        const body = solids[parts.length];
        if (body === undefined || !sameBox(kernel, kernel.located(local, [...placement]), body)) {
          ok = false;
          return;
        }
        parts.push({ name, path, assembly });
      }
      return;
    }
    const inner = info.isComponent ? compose(placement, doc.getLocation(label)) : placement;
    let innerPath = path;
    let innerAssembly = assembly;
    if (name) {
      innerPath = [...path, name];
      innerAssembly = assemblies.length;
      assemblies.push({ name, parent: assembly });
    }
    for (const child of children) walk(child, inner, innerPath, innerAssembly);
  };
  for (const root of doc.getRoots()) walk(root, IDENTITY, [], -1);
  return ok && parts.length === solids.length ? { parts, assemblies } : null;
}

/**
 * Display names for all bodies: the part name, " [k]" appended when several bodies share a name,
 * "Body N" when unnamed, "Loose surfaces" for the extra loose body.
 */
export function bodyDisplayNames(
  parts: readonly PartInfo[] | null,
  bodyCount: number,
  hasLooseBody: boolean,
): string[] {
  const raw = Array.from({ length: bodyCount }, (_, id) =>
    hasLooseBody && id === bodyCount - 1 ? '' : (parts?.[id]?.name.trim() ?? ''),
  );
  const total = new Map<string, number>();
  for (const n of raw) if (n) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return raw.map((n, id) => {
    if (hasLooseBody && id === bodyCount - 1) return 'Loose surfaces';
    if (!n) return `Body ${String(id + 1)}`;
    if ((total.get(n) ?? 0) < 2) return n;
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return `${n} [${String(k)}]`;
  });
}
