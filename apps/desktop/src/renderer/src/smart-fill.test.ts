import { describe, expect, it } from 'vitest';
import {
  TriangleAdjacency,
  brushPatch,
  faceRegion,
  smartFill,
  stepFillAngle,
  DEFAULT_FILL_ANGLE_DEG,
} from './smart-fill.js';

/**
 * A strip of quads bending by `bendDeg` at each joint (around the Y axis), each quad with its own
 * 4 vertices (like separate CAD faces). Quad q = triangles 2q, 2q+1, wound to face +Z first.
 */
function strip(quads: number, bendDeg: number): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  // Joint points along the bent profile in XZ.
  const joints: [number, number][] = [[0, 0]];
  let angle = 0;
  for (let q = 0; q < quads; q++) {
    const [x, z] = joints[q] ?? [0, 0];
    joints.push([x + Math.cos(angle), z - Math.sin(angle)]);
    angle += (bendDeg * Math.PI) / 180;
  }
  for (let q = 0; q < quads; q++) {
    const [x0, z0] = joints[q] ?? [0, 0];
    const [x1, z1] = joints[q + 1] ?? [0, 0];
    const base = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z1, x1, 1, z1, x0, 1, z0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

const sorted = (a: Uint32Array): number[] => [...a].sort((x, y) => x - y);

describe('TriangleAdjacency', () => {
  it('joins triangles of separately meshed faces by position', () => {
    const { positions, indices } = strip(3, 0);
    const adj = TriangleAdjacency.build(positions, indices);
    const n: number[] = [];
    adj.forEachNeighbour(2, (u) => n.push(u));
    expect(n.sort()).toEqual([3, 5]); // its quad partner and quad 2 (the shared right edge)
    // Open edges: outline of a 3×1 strip = 8 unit edges.
    expect(adj.openEdges()).toBe(8);
  });

  it('treats -0 and 0 as the same position', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -0, 0, 0, 0, 1, 0, -1, 0, 0]);
    const adj = TriangleAdjacency.build(positions, new Uint32Array([0, 1, 2, 3, 5, 4]));
    expect(adj.openEdges()).toBe(4);
  });

  it('turns facet normals to the vertex normals when given', () => {
    // Two coplanar triangles, the second wound backwards; vertex normals all +Z.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    const indices = new Uint32Array([0, 1, 2, 1, 2, 3]);
    const raw = TriangleAdjacency.build(positions, indices);
    expect(raw.normals[5]).toBeCloseTo(-1);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const fixed = TriangleAdjacency.build(positions, indices, normals);
    expect(fixed.normals[5]).toBeCloseTo(1);
    expect(smartFill(fixed, 0, 1).triangles.length).toBe(2);
    expect(smartFill(raw, 0, 1).triangles.length).toBe(1);
  });
});

describe('smartFill', () => {
  it('fills across joints bent less than the angle (neighbour to neighbour)', () => {
    const { positions, indices } = strip(6, 20); // 100° total, 20° per joint
    const adj = TriangleAdjacency.build(positions, indices);
    expect(smartFill(adj, 0, DEFAULT_FILL_ANGLE_DEG).triangles.length).toBe(12);
    expect(sorted(smartFill(adj, 4, 10).triangles)).toEqual([4, 5]);
  });

  it('stops at a sharp edge and fills the same region from any of its triangles', () => {
    const { positions, indices } = strip(4, 0);
    // Bend the strip 90° after quad 1 by rebuilding: two flat quads + two flat quads at 90°.
    const bent = strip(2, 0);
    const up = strip(2, 0);
    // Rotate `up` 90° around the Y axis and move it to the end of `bent` (x = 2).
    for (let i = 0; i < up.positions.length; i += 3) {
      const x = up.positions[i] ?? 0;
      up.positions[i] = 2;
      up.positions[i + 2] = x;
    }
    const pos = new Float32Array([...bent.positions, ...up.positions]);
    const idx = new Uint32Array([...bent.indices, ...[...up.indices].map((v) => v + 8)]);
    const adj = TriangleAdjacency.build(pos, idx);
    expect(sorted(smartFill(adj, 0, 30).triangles)).toEqual([0, 1, 2, 3]);
    expect(sorted(smartFill(adj, 3, 30).triangles)).toEqual([0, 1, 2, 3]);
    expect(sorted(smartFill(adj, 5, 30).triangles)).toEqual([4, 5, 6, 7]);
    expect(smartFill(adj, 0, 90).triangles.length).toBe(8);
    // Flat strip: the same mesh shape, all coplanar.
    expect(smartFill(TriangleAdjacency.build(positions, indices), 0, 0).triangles.length).toBe(8);
  });

  it('keeps to triangles `accept` allows', () => {
    const { positions, indices } = strip(4, 0);
    const adj = TriangleAdjacency.build(positions, indices);
    const r = smartFill(adj, 0, 30, (t) => t < 4);
    expect(sorted(r.triangles)).toEqual([0, 1, 2, 3]);
    expect(r.contains[3]).toBe(1);
    expect(r.contains[4]).toBe(0);
  });

  it('passes through degenerate triangles without losing the angle check', () => {
    // Flat quad 0, a zero-area sliver on its right edge, then quad 1 bent by 60°.
    const pos = new Float32Array([
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      1,
      0,
      0,
      1,
      0, // quad 0
      1,
      0,
      0,
      1,
      0.5,
      0,
      1,
      1,
      0, // sliver (collinear)
      1,
      0,
      0,
      1.5,
      0,
      -0.866,
      1.5,
      1,
      -0.866,
      1,
      1,
      0, // quad 1, 60° down
    ]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 7, 8, 9, 7, 9, 10]);
    const adj = TriangleAdjacency.build(pos, idx);
    expect(adj.normals[6]).toBe(0);
    expect(sorted(smartFill(adj, 0, 30).triangles)).toEqual([0, 1, 2]);
    expect(smartFill(adj, 0, 70).triangles.length).toBe(5);
  });

  it('returns nothing for a seed outside the mesh', () => {
    const { positions, indices } = strip(1, 0);
    expect(smartFill(TriangleAdjacency.build(positions, indices), 9, 30).triangles.length).toBe(0);
  });
});

describe('brushPatch', () => {
  // A thin wall folded as a U: quad 0 = front (+Z), quad 1 = rim, quad 2 = back (−Z).
  const { positions, indices } = strip(3, 90);
  const adj = TriangleAdjacency.build(positions, indices);
  const facing = (t: number): boolean => (adj.normals[t * 3 + 2] ?? 0) > -0.5; // camera on +Z
  const all = new Set([0, 1, 2, 3, 4, 5]);

  it('leaves the back of a thin wall unpainted though the ball reaches it', () => {
    expect(brushPatch(adj, 0, all, facing).sort()).toEqual([0, 1, 2, 3]);
  });

  it('does not jump to ball triangles it cannot reach through the ball', () => {
    const noRim = new Set([0, 1, 4, 5]);
    expect(brushPatch(adj, 0, noRim, () => true).sort()).toEqual([0, 1]);
  });

  it('keeps the seed and returns nothing when the seed is outside the ball', () => {
    expect(brushPatch(adj, 4, new Set([4]), facing)).toEqual([4]);
    expect(brushPatch(adj, 0, new Set([1]), facing)).toEqual([]);
  });
});

describe('faceRegion', () => {
  it('takes every triangle of the face', () => {
    const r = faceRegion(new Uint32Array([0, 1, 1, 2, 1]), 1);
    expect([...r.triangles]).toEqual([1, 2, 4]);
    expect(r.contains[0]).toBe(0);
  });
});

describe('stepFillAngle', () => {
  it('steps by 5° within 0–90°', () => {
    expect(stepFillAngle(30, 1)).toBe(35);
    expect(stepFillAngle(30, -2)).toBe(20);
    expect(stepFillAngle(0, -1)).toBe(0);
    expect(stepFillAngle(88, 1)).toBe(90);
    expect(stepFillAngle(12, 0)).toBe(10);
  });
});
