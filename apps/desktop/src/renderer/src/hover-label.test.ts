import type { InfoModel } from '@third-wheel/geometry';
import { describe, expect, it } from 'vitest';
import { hoverLabel } from './hover-label.js';

const N = NaN;
const model: InfoModel = {
  positions: new Float32Array(),
  indices: new Uint32Array(),
  triangleFace: new Uint32Array(),
  faceBody: new Uint32Array([0, 0, 0]),
  faceTypes: ['plane', 'cylinder', 'bspline'],
  // plane; Ø6 hole along Z at (10, 10); free-form
  faceGeometry: new Float32Array([
    0,
    0,
    1,
    0,
    0,
    0,
    N,
    N,
    0,
    0,
    1,
    10,
    10,
    0,
    3,
    -1,
    N,
    N,
    N,
    N,
    N,
    N,
    N,
    N,
  ]),
  edgePoints: new Float32Array(),
  edgeRanges: new Uint32Array(4),
  edgeBody: new Uint32Array([0, 0]),
  edgeTypes: ['circle', 'line'],
  edgeGeometry: new Float32Array([
    0,
    0,
    1,
    10,
    10,
    0,
    6 * Math.PI,
    3,
    2 * Math.PI,
    1,
    0,
    0,
    0,
    0,
    0,
    40,
    N,
    N,
  ]),
  vertexPositions: new Float32Array(3),
  vertexBody: new Uint32Array(1),
  bodyNames: ['Bracket'],
  bodyPaths: [''],
};

describe('hoverLabel', () => {
  it('names entity, type, size and body', () => {
    expect(hoverLabel({ kind: 'face', id: 1, body: 0 }, model)).toBe(
      'Face 1 (cylinder Ø6 hole) · Bracket',
    );
    expect(hoverLabel({ kind: 'face', id: 0, body: 0 }, model)).toBe('Face 0 (plane) · Bracket');
    expect(hoverLabel({ kind: 'face', id: 2, body: 0 }, model)).toBe('Face 2 (bspline) · Bracket');
    expect(hoverLabel({ kind: 'edge', id: 0, body: 0 }, model)).toBe(
      'Edge 0 (circle Ø6) · Bracket',
    );
    expect(hoverLabel({ kind: 'edge', id: 1, body: 0 }, model)).toBe(
      'Edge 1 (line 40 mm) · Bracket',
    );
    expect(hoverLabel({ kind: 'vertex', id: 7, body: 0 }, model)).toBe('Vertex 7 · Bracket');
    expect(hoverLabel({ kind: 'body', id: 0, body: 0 }, model)).toBe('Body · Bracket');
  });
});
