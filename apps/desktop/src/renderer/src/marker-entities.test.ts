import { describe, expect, it } from 'vitest';
import { faceTriangles, type HighlightModel } from './highlight-buffers.js';
import { faceOutline, markerEntityBuffers, TINT_ALPHA } from './marker-entities.js';
import type { ShownEntity } from './markers.js';

/**
 * Body 0: face 0 = unit square (triangles 0, 1 over vertices 0–3); body 1: face 1 = triangle 2.
 * Edge 0 (3 points) in body 0, edge 1 (2 points) in body 1; vertex 0 in body 0, vertex 1 in body 1.
 */
const model: HighlightModel = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]),
  triangleFace: new Uint32Array([0, 0, 1]),
  faceBody: new Uint32Array([0, 1]),
  edgePoints: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 5, 0, 0, 6, 0, 0]),
  edgeRanges: new Uint32Array([0, 3, 3, 2]),
  edgeBody: new Uint32Array([0, 1]),
  vertexPositions: new Float32Array([0, 0, 0, 5, 0, 0]),
  vertexBody: new Uint32Array([0, 1]),
};
const tris = faceTriangles(model.triangleFace, 2);
const RED = '#ff0000';
const BLUE = '#0000ff';
const e = (kind: ShownEntity['kind'], id: number, color = RED): ShownEntity => ({
  kind,
  id,
  color,
  markerId: color,
});

describe('faceOutline', () => {
  it('keeps triangle sides used once (the square, not its diagonal)', () => {
    const sides = faceOutline(0, model, tris);
    expect(sides).toHaveLength(8);
    const pairs = new Set<string>();
    for (let i = 0; i < sides.length; i += 2) {
      pairs.add([sides[i], sides[i + 1]].sort().join('-'));
    }
    expect(pairs).toEqual(new Set(['0-1', '1-2', '2-3', '0-3']));
  });
});

describe('markerEntityBuffers', () => {
  it('face → tint + outline in the marker colour', () => {
    const b = markerEntityBuffers([e('face', 0)], model, tris);
    expect(b.tintPositions.length).toBe(2 * 3 * 3);
    expect([...b.tintColors.slice(0, 4)]).toEqual([1, 0, 0, Math.fround(TINT_ALPHA.face)]);
    expect(b.lines.length).toBe(4 * 6);
    expect([...b.lineColors.slice(0, 3)]).toEqual([1, 0, 0]);
    expect(b.points.length + b.bodyLines.length).toBe(0);
  });

  it('edge → thick line segments, vertex → dot, body → faint tint + thin edges', () => {
    const b = markerEntityBuffers(
      [e('edge', 0), e('vertex', 1, BLUE), e('body', 1, BLUE)],
      model,
      tris,
    );
    expect(b.lines.length).toBe(2 * 6);
    expect([...b.points]).toEqual([5, 0, 0]);
    expect([...b.pointColors]).toEqual([0, 0, 1]);
    expect(b.tintPositions.length).toBe(9);
    expect(b.tintColors[3]).toBeCloseTo(TINT_ALPHA.body);
    expect(b.bodyLines.length).toBe(6);
  });

  it('leaves out entities of hidden bodies and unknown ids', () => {
    const b = markerEntityBuffers(
      [e('face', 0), e('edge', 0), e('vertex', 0), e('body', 0), e('face', 9), e('edge', 9)],
      model,
      tris,
      [false],
    );
    expect(b.tintPositions.length + b.lines.length + b.points.length + b.bodyLines.length).toBe(0);
  });
});
