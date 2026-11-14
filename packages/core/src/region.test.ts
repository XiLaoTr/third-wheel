import { describe, expect, it } from 'vitest';
import { analyzeRegion, analyzeRegions, faceAreas, type RegionMesh } from './region.js';
import type { FacePaint, MarkerData } from './schema.js';

/**
 * Unit squares in the z = 0 plane, 2 triangles each, own vertices per face (like our tessellation):
 * face 0 at x 0–1, face 1 at x 1–2 (touches face 0), face 2 at x 10–11 (apart).
 * Triangles: 0–1 face 0, 2–3 face 1, 4–5 face 2. Triangle 0 = (x0,0) (x0+1,0) (x0,1).
 */
function squares(): RegionMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const triangleFace: number[] = [];
  [0, 1, 10].forEach((x0, f) => {
    const base = positions.length / 3;
    positions.push(x0, 0, 0, x0 + 1, 0, 0, x0, 1, 0, x0 + 1, 1, 0);
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    triangleFace.push(f, f);
  });
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    triangleFace: Uint32Array.from(triangleFace),
  };
}

type Input = Pick<MarkerData, 'paint' | 'entities'>;
const marker = (faces: FacePaint[], entities: MarkerData['entities'] = []): Input => ({
  paint: { faces },
  entities,
});

describe('analyzeRegion', () => {
  it('summarises a whole painted face', () => {
    const r = analyzeRegion(squares(), marker([{ faceId: 0, triangles: [[0, 2]] }]));
    expect(r).not.toBeNull();
    expect(r?.area).toBeCloseTo(1);
    expect(r?.centroid[0]).toBeCloseTo(0.5);
    expect(r?.centroid[1]).toBeCloseTo(0.5);
    expect(r?.bbox).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(r?.avgNormal).toEqual([0, 0, 1]);
    expect(r?.flatness).toBeCloseTo(1);
    expect(r?.components).toHaveLength(1);
    expect(r?.stepFaces).toEqual([{ faceId: 0, coverage: 1 }]);
  });

  it('gives coverage per face, most painted first, and joins touching faces into one patch', () => {
    const r = analyzeRegion(
      squares(),
      marker([
        { faceId: 1, triangles: [[2, 1]] },
        { faceId: 0, triangles: [[0, 2]] },
      ]),
    );
    expect(r?.area).toBeCloseTo(1.5);
    expect(r?.stepFaces.map((f) => f.faceId)).toEqual([0, 1]);
    expect(r?.stepFaces[1]?.coverage).toBeCloseTo(0.5);
    expect(r?.components).toHaveLength(1);
  });

  it('splits patches that do not touch, largest first', () => {
    const r = analyzeRegion(
      squares(),
      marker([
        { faceId: 0, triangles: [[0, 1]] },
        { faceId: 2, triangles: [[4, 2]] },
      ]),
    );
    expect(r?.components).toHaveLength(2);
    expect(r?.components[0]?.area).toBeCloseTo(1);
    expect(r?.components[0]?.centroid[0]).toBeCloseTo(10.5);
    expect(r?.components[1]?.area).toBeCloseTo(0.5);
    expect(r?.bbox).toEqual({ min: [0, 0, 0], max: [11, 1, 0] });
  });

  it('leaves faces held as entities out of stepFaces but counts their paint', () => {
    const r = analyzeRegion(
      squares(),
      marker(
        [
          { faceId: 0, triangles: [[0, 2]] },
          { faceId: 1, triangles: [[2, 2]] },
        ],
        [
          { kind: 'face', id: 0, seq: 0 },
          { kind: 'edge', id: 1, seq: 1 },
        ],
      ),
    );
    expect(r?.area).toBeCloseTo(2);
    expect(r?.stepFaces).toEqual([{ faceId: 1, coverage: 1 }]);
  });

  it('counts only the painted pieces of a cut triangle', () => {
    // Triangle 0 = (0,0) (1,0) (0,1), area 0.5; child 0 = (a, ab, ca) = (0,0) (0.5,0) (0,0.5).
    const r = analyzeRegion(
      squares(),
      marker([{ faceId: 0, triangles: [], pieces: [{ triangle: 0, tree: [1, 0, 0, 0] }] }]),
    );
    expect(r?.area).toBeCloseTo(0.125);
    expect(r?.centroid[0]).toBeCloseTo(1 / 6);
    expect(r?.centroid[1]).toBeCloseTo(1 / 6);
    expect(r?.bbox).toEqual({ min: [0, 0, 0], max: [0.5, 0.5, 0] });
    expect(r?.stepFaces[0]?.coverage).toBeCloseTo(0.125);

    const nested = analyzeRegion(
      squares(),
      marker([
        { faceId: 0, triangles: [], pieces: [{ triangle: 0, tree: [[1, 1, 0, 1], 0, 0, 1] }] },
      ]),
    );
    expect(nested?.area).toBeCloseTo(0.125 * 0.75 + 0.125);
  });

  it('returns null without paint and skips triangles past the mesh', () => {
    expect(analyzeRegion(squares(), marker([]))).toBeNull();
    expect(analyzeRegion(squares(), marker([{ faceId: 0, triangles: [[99, 3]] }]))).toBeNull();
    expect(
      analyzeRegion(
        squares(),
        marker([{ faceId: 0, triangles: [], pieces: [{ triangle: 0, tree: [0, 0, 0, 0] }] }]),
      ),
    ).toBeNull();
  });

  it('skips zero-area triangles', () => {
    const m = squares();
    const indices = Uint32Array.from(m.indices);
    indices[5] = indices[4] ?? 0; // triangle 1: two corners on one point
    const r = analyzeRegion(
      { ...m, indices },
      marker([
        { faceId: 0, triangles: [[1, 1]] },
        { faceId: 1, triangles: [[2, 1]] },
      ]),
    );
    expect(r?.stepFaces.map((f) => f.faceId)).toEqual([1]);
    expect(r?.components).toHaveLength(1);
  });

  it('orients triangle normals by the vertex normals', () => {
    const m = squares();
    // Reverse the winding of triangle 0: its geometric normal points −z, vertex normals say +z.
    const indices = Uint32Array.from(m.indices);
    [indices[1], indices[2]] = [indices[2] ?? 0, indices[1] ?? 0];
    const r = analyzeRegion({ ...m, indices }, marker([{ faceId: 0, triangles: [[0, 2]] }]));
    expect(r?.avgNormal).toEqual([0, 0, 1]);
    expect(r?.flatness).toBeCloseTo(1);
  });

  it('reports low flatness for paint facing several ways', () => {
    // Face 0 in z = 0 (normal +z), face 1 in x = 0 (normal −x), sharing the edge x = 0, z = 0.
    const mesh: RegionMesh = {
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: Uint32Array.from([0, 1, 2, 3, 5, 4]),
      triangleFace: Uint32Array.from([0, 1]),
    };
    const r = analyzeRegion(
      mesh,
      marker([
        { faceId: 0, triangles: [[0, 1]] },
        { faceId: 1, triangles: [[1, 1]] },
      ]),
    );
    expect(r?.flatness).toBeCloseTo(Math.SQRT1_2);
    expect(r?.avgNormal[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(r?.avgNormal[2]).toBeCloseTo(Math.SQRT1_2);
    expect(r?.components).toHaveLength(1);
  });
});

describe('analyzeRegions', () => {
  it('summarises every marker with shared face areas', () => {
    const mesh = squares();
    const out = analyzeRegions(mesh, [
      { id: 'm1', ...marker([{ faceId: 1, triangles: [[3, 1]] }]) },
      { id: 'm2', ...marker([], [{ kind: 'face', id: 2, seq: 0 }]) },
    ]);
    expect(out.get('m1')?.stepFaces).toEqual([{ faceId: 1, coverage: 0.5 }]);
    expect(out.get('m2')).toBeNull();
  });

  it('faceAreas sums the mesh area of the asked faces only', () => {
    const areas = faceAreas(squares(), [0, 2]);
    expect([...areas.keys()]).toEqual([0, 2]);
    expect(areas.get(0)).toBeCloseTo(1);
  });
});
