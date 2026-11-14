import { describe, expect, it } from 'vitest';
import { facePickIds, vertexPickBuffers } from './pick-buffers.js';

describe('facePickIds', () => {
  it('gives each mesh vertex the face of its triangles', () => {
    // Draw order: triangle 1 (face 5) then triangle 0 (face 2); vertex 6 unused.
    const r = facePickIds(
      new Uint32Array([3, 4, 5, 0, 1, 2]),
      new Uint32Array([1, 0]),
      new Uint32Array([2, 5]),
      7,
    );
    expect(Array.from(r.faceIds)).toEqual([2, 2, 2, 5, 5, 5, 0]);
    expect(r.split).toBeUndefined();
  });

  it('duplicates a vertex shared by two faces', () => {
    // Two triangles sharing vertices 1 and 2, on faces 0 and 1.
    const r = facePickIds(
      new Uint32Array([0, 1, 2, 1, 3, 2]),
      new Uint32Array([0, 1]),
      new Uint32Array([0, 1]),
      4,
    );
    expect(r.split).toBeDefined();
    const { indices, sourceVertex } = r.split ?? { indices: [], sourceVertex: [] };
    expect(Array.from(indices)).toEqual([0, 1, 2, 4, 3, 5]);
    expect(Array.from(sourceVertex)).toEqual([0, 1, 2, 3, 1, 2]);
    expect(Array.from(r.faceIds)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});

describe('vertexPickBuffers', () => {
  it('groups vertices by body, keeping their ids', () => {
    const r = vertexPickBuffers({
      bodyCount: 3,
      vertexBody: new Uint32Array([1, 0, 1]),
      vertexPositions: new Float32Array([10, 0, 0, 20, 0, 0, 30, 0, 0]),
    });
    expect(Array.from(r.start)).toEqual([0, 1, 3, 3]);
    expect(Array.from(r.ids)).toEqual([1, 0, 2]);
    expect(Array.from(r.points)).toEqual([20, 0, 0, 10, 0, 0, 30, 0, 0]);
  });
});
