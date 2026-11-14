import { describe, expect, it } from 'vitest';
import { versionDiff, type DiffMesh } from './version-diff';

/** Two triangles side by side (a square 0..1 at x offset `dx`), one edge along its bottom. */
function square(dx: number, top = 1): DiffMesh {
  return {
    positions: [dx, 0, 0, dx + 1, 0, 0, dx + 1, top, 0, dx, top, 0],
    indices: [0, 1, 2, 0, 2, 3],
    edgePoints: [dx, 0, 0, dx + 1, 0, 0, dx + 1, top, 0],
    edgeRanges: [0, 3],
  };
}

describe('versionDiff', () => {
  it('finds nothing between identical meshes', () => {
    const d = versionDiff(square(0), square(0));
    expect(d.oldTriangles.length).toBe(0);
    expect(d.oldEdges.length).toBe(0);
    expect(d.newTriangles.length).toBe(0);
  });

  it('ignores differences below the tolerance', () => {
    const d = versionDiff(square(0), square(0.0001));
    expect(d.newTriangles.length).toBe(0);
  });

  it('reports only the triangles and edge pieces touching a moved corner', () => {
    // The top grows: both triangles use a top corner, the bottom edge piece stays.
    const d = versionDiff(square(0), square(0, 2));
    expect(d.newTriangles.length).toBe(18);
    expect(d.oldTriangles.length).toBe(18);
    expect(Array.from(d.oldTriangles.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    // Only the second piece (bottom-right → top-right) changed.
    expect(Array.from(d.oldEdges)).toEqual([1, 0, 0, 1, 1, 0]);
  });

  it('reports everything of a moved part', () => {
    const d = versionDiff(square(0), square(5));
    expect(d.newTriangles.length).toBe(18);
    expect(d.oldTriangles.length).toBe(18);
    expect(d.oldEdges.length).toBe(12);
  });

  it('with a surface test, keeps only the parts off the other surface', () => {
    // Same plane z = 0, other corners: only the grown part (y > 1) is off the old surface.
    const onOld = (_x: number, y: number, z: number): boolean => z === 0 && y <= 1;
    const onNew = (_x: number, y: number, z: number): boolean => z === 0 && y <= 2;
    const d = versionDiff(square(0), square(0, 2), { old: onOld, new: onNew });
    expect(d.oldTriangles.length).toBe(0);
    expect(d.oldEdges.length).toBe(0);
    // The new square's two triangles reach from y = 0 to 2: split, about the top half kept.
    expect(area(d.newTriangles)).toBeGreaterThan(0.9);
    expect(area(d.newTriangles)).toBeLessThan(1.3);
    const flat = versionDiff(square(0), square(0, 2), { old: () => true, new: () => true });
    expect(flat.newTriangles.length).toBe(0);
  });

  it('splits an edge piece partly on the other surface', () => {
    const old = square(0);
    const now = { ...square(0), edgePoints: [9, 9, 9], edgeRanges: [0, 1] };
    // The old right edge (x = 1, y 0 → 1) is on the new surface only below y = 0.5.
    const d = versionDiff(old, now, { old: () => true, new: (_x, y) => y <= 0.5 });
    const ys = Array.from(d.oldEdges).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(0.4);
    expect(Math.max(...ys)).toBe(1);
  });
});

/** Total area of flat XYZ triangles. */
function area(t: Float32Array): number {
  let sum = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const u = [0, 1, 2].map((a) => (t[i + 3 + a] ?? 0) - (t[i + a] ?? 0));
    const v = [0, 1, 2].map((a) => (t[i + 6 + a] ?? 0) - (t[i + a] ?? 0));
    const [ux = 0, uy = 0, uz = 0] = u;
    const [vx = 0, vy = 0, vz = 0] = v;
    sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return sum;
}
