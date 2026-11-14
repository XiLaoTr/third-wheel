import { describe, expect, it } from 'vitest';
import type { Vec3 } from './camera-views.js';
import {
  candidateDirs,
  chooseRegionDir,
  CLEAR_ENOUGH,
  MAX_RAYS,
  occlusion,
  type CastBodies,
} from './region-occlusion.js';

/** Axis-aligned boxes as bodies: a ray meets body b when it crosses its box (slab test). */
type Box = readonly [min: Vec3, max: Vec3];
const castBoxes =
  (boxes: Record<number, Box>): CastBodies =>
  (o, d) => {
    const out: number[] = [];
    for (const [id, [lo, hi]] of Object.entries(boxes)) {
      let t0 = 0;
      let t1 = Infinity;
      for (const k of [0, 1, 2] as const) {
        if (Math.abs(d[k]) < 1e-12) {
          if (o[k] < lo[k] || o[k] > hi[k]) t0 = Infinity;
          continue;
        }
        const a = (lo[k] - o[k]) / d[k];
        const b = (hi[k] - o[k]) / d[k];
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      if (t0 <= t1) out.push(Number(id));
    }
    return out;
  };

/** n×n grid of points on z = 0, x and y in [−1, 1]. */
function grid(n = 5): Float32Array {
  const p: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) p.push(-1 + (2 * i) / (n - 1), -1 + (2 * j) / (n - 1), 0);
  return Float32Array.from(p);
}

const own = new Set([0]);
const UP: Vec3 = [0, 0, 1];
/** Body 0: slab under the region (top face z = 0). */
const base: Box = [
  [-1, -1, -1],
  [1, 1, 0],
];
const lid: Box = [
  [-3, -3, 4],
  [3, 3, 5],
]; // body 1, right above the region

describe('occlusion', () => {
  it('nothing in front: all clear', () => {
    const o = occlusion(grid(), UP, own, castBoxes({ 0: base }), 1e-3);
    expect(o.clear).toBe(1);
    expect(o.blockers.size).toBe(0);
  });

  it('another body in front: ghostable, counted as blocker', () => {
    const o = occlusion(grid(), UP, own, castBoxes({ 0: base, 1: lid }), 1e-3);
    expect(o.clear).toBe(0);
    expect(o.ghostable).toBe(1);
    expect(o.blockers.get(1)).toBe(25);
  });

  it('own body in front (seen from behind): hidden for good, no blocker', () => {
    const o = occlusion(grid(), [0, 0, -1], own, castBoxes({ 0: base, 1: lid }), 1e-3);
    expect(o.clear).toBe(0);
    expect(o.ghostable).toBe(0);
    expect(o.blockers.size).toBe(0);
  });

  it('tests at most MAX_RAYS points', () => {
    const o = occlusion(grid(40), UP, own, () => [], 1e-3);
    expect(o.rays).toBeLessThanOrEqual(MAX_RAYS);
    expect(o.rays).toBeGreaterThan(MAX_RAYS * 0.9);
  });
});

describe('candidateDirs', () => {
  it('preferred first, then 6 axes + 8 corners, no near-duplicates', () => {
    const d = candidateDirs(UP);
    expect(d[0]).toEqual(UP);
    expect(d).toHaveLength(14); // +Z is already the preferred one
    expect(candidateDirs([1, 2, 3])).toHaveLength(15);
  });
});

describe('chooseRegionDir', () => {
  it('keeps the preferred direction when enough is clear', () => {
    const c = chooseRegionDir(grid(), UP, own, castBoxes({ 0: base }), 1e-3);
    expect(c.dir).toEqual(UP);
    expect(c.ghost).toEqual([]);
    expect(c.clear).toBeGreaterThanOrEqual(CLEAR_ENOUGH);
  });

  it('turns to a clear corner when a lid covers the top', () => {
    // A lid only over the region (not wide enough to block the corners).
    const small: Box = [
      [-1.2, -1.2, 4],
      [1.2, 1.2, 5],
    ];
    const c = chooseRegionDir(grid(), UP, own, castBoxes({ 0: base, 1: small }), 1e-3);
    expect(c.dir[2]).toBeGreaterThan(0); // still from above (not through the base)
    expect(c.dir).not.toEqual(UP);
    expect(c.clear).toBeGreaterThan(0.5);
  });

  it('ghosts what still blocks when no direction is clear', () => {
    // Lid over everything above z = 0 is impossible to avoid from the top half.
    const huge: Box = [
      [-100, -100, 4],
      [100, 100, 5],
    ];
    const c = chooseRegionDir(grid(), UP, own, castBoxes({ 0: base, 1: huge }), 1e-3);
    expect(c.dir).toEqual(UP); // best score: ghostable everywhere, nearest the normal
    expect(c.ghost).toEqual([1]);
    expect(c.ghostable).toBe(1);
  });

  it('never ghosts the region’s own body', () => {
    const c = chooseRegionDir(
      grid(),
      [0, 0, -1],
      new Set([0, 1]),
      castBoxes({ 0: base, 1: lid }),
      1e-3,
    );
    expect(c.ghost).not.toContain(0);
    expect(c.ghost).not.toContain(1);
  });

  it('no points: preferred, nothing ghosted', () => {
    const c = chooseRegionDir(new Float32Array(), [0, 2, 0], own, () => [1], 1e-3);
    expect(c.dir).toEqual([0, 1, 0]);
    expect(c.ghost).toEqual([]);
  });
});
