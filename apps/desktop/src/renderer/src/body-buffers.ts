/**
 * Draw buffers grouped by body, so one mesh + one line object can show any subset of bodies by
 * changing which index/vertex ranges are drawn — no rebuild, few draw calls (pure, no three.js).
 */
import type { StepModel } from '@third-wheel/geometry';

export interface BodyBuffers {
  /** Mesh index buffer with triangles reordered so each body's triangles are contiguous. */
  readonly indices: Uint32Array;
  /** Draw-order triangle → original triangle id (`model.triangleFace` index), for picking later. */
  readonly triangleOrder: Uint32Array;
  /** Per body b: index entries [triStart[b], triStart[b+1]) of `indices`. Length bodyCount+1. */
  readonly triStart: Uint32Array;
  /** XYZ pairs for `LineSegments`: every edge polyline split into segments, grouped by body. */
  readonly edgeSegments: Float32Array;
  /** Per body b: vertices [edgeStart[b], edgeStart[b+1]) of `edgeSegments`. Length bodyCount+1. */
  readonly edgeStart: Uint32Array;
  /** Edge id per vertex of `edgeSegments` (float32 for the GPU pick pass; exact up to 2^24). */
  readonly edgeSegmentIds: Float32Array;
}

/** Contiguous draw range, in the units of the `starts` array it came from. */
export interface DrawRun {
  readonly start: number;
  readonly count: number;
}

export function buildBodyBuffers(
  model: Pick<
    StepModel,
    'indices' | 'triangleFace' | 'faceBody' | 'edgePoints' | 'edgeRanges' | 'edgeBody' | 'bodyCount'
  >,
): BodyBuffers {
  const { bodyCount } = model;
  const triangleCount = model.triangleFace.length;

  // --- Triangles: counting sort by body (stable, so draw order within a body stays as imported) ---
  const triBody = new Uint32Array(triangleCount);
  const triCount = new Uint32Array(bodyCount + 1);
  for (let t = 0; t < triangleCount; t++) {
    const body = model.faceBody[model.triangleFace[t] ?? 0] ?? 0;
    triBody[t] = body;
    triCount[body + 1] = (triCount[body + 1] ?? 0) + 1;
  }
  const triStart = new Uint32Array(bodyCount + 1); // in triangles for now
  for (let b = 0; b < bodyCount; b++) triStart[b + 1] = (triStart[b] ?? 0) + (triCount[b + 1] ?? 0);
  const cursor = triStart.slice(0, bodyCount);
  const triangleOrder = new Uint32Array(triangleCount);
  const indices = new Uint32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const body = triBody[t] ?? 0;
    const slot = cursor[body] ?? 0;
    cursor[body] = slot + 1;
    triangleOrder[slot] = t;
    indices[slot * 3] = model.indices[t * 3] ?? 0;
    indices[slot * 3 + 1] = model.indices[t * 3 + 1] ?? 0;
    indices[slot * 3 + 2] = model.indices[t * 3 + 2] ?? 0;
  }
  for (let b = 0; b <= bodyCount; b++) triStart[b] = (triStart[b] ?? 0) * 3; // → index entries

  // --- Edges: polyline of n points → n-1 segments → 2(n-1) vertices, grouped by body ---
  const edgeCount = model.edgeBody.length;
  const segVerts = new Uint32Array(bodyCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    const n = model.edgeRanges[e * 2 + 1] ?? 0;
    if (n < 2) continue;
    const body = model.edgeBody[e] ?? 0;
    segVerts[body + 1] = (segVerts[body + 1] ?? 0) + 2 * (n - 1);
  }
  const edgeStart = new Uint32Array(bodyCount + 1);
  for (let b = 0; b < bodyCount; b++)
    edgeStart[b + 1] = (edgeStart[b] ?? 0) + (segVerts[b + 1] ?? 0);
  const edgeCursor = edgeStart.slice(0, bodyCount);
  const edgeSegments = new Float32Array((edgeStart[bodyCount] ?? 0) * 3);
  const edgeSegmentIds = new Float32Array(edgeStart[bodyCount] ?? 0);
  const pts = model.edgePoints;
  for (let e = 0; e < edgeCount; e++) {
    const first = model.edgeRanges[e * 2] ?? 0;
    const n = model.edgeRanges[e * 2 + 1] ?? 0;
    if (n < 2) continue;
    const body = model.edgeBody[e] ?? 0;
    let v = edgeCursor[body] ?? 0;
    edgeSegmentIds.fill(e, v, v + 2 * (n - 1));
    for (let i = 0; i < n - 1; i++) {
      edgeSegments.set(pts.subarray((first + i) * 3, (first + i + 2) * 3), v * 3);
      v += 2;
    }
    edgeCursor[body] = v;
  }

  return { indices, triangleOrder, triStart, edgeSegments, edgeStart, edgeSegmentIds };
}

/**
 * Ranges to draw for the visible bodies. `starts` has bodyCount+1 entries (body b spans
 * [starts[b], starts[b+1])); neighbouring visible bodies merge into one run, empty bodies are
 * skipped. All visible → one run; none → no runs.
 */
export function visibleRuns(starts: Uint32Array, visible: readonly boolean[]): DrawRun[] {
  const runs: DrawRun[] = [];
  let runStart = -1;
  let runEnd = -1;
  for (let b = 0; b + 1 < starts.length; b++) {
    const s = starts[b] ?? 0;
    const e = starts[b + 1] ?? 0;
    if (!(visible[b] ?? true) || e === s) continue;
    if (s === runEnd) {
      runEnd = e;
    } else {
      if (runEnd > runStart) runs.push({ start: runStart, count: runEnd - runStart });
      runStart = s;
      runEnd = e;
    }
  }
  if (runEnd > runStart) runs.push({ start: runStart, count: runEnd - runStart });
  return runs;
}
