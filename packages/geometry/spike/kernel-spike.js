// T1.1 spike: measure STEP kernels against our requirements.
// Usage (from packages/geometry): node spike/kernel-spike.js <occt-import-js|occt-wasm> <file.step>...
// Prints one JSON summary per file. Run twice and compare `fingerprint` to check id stability across processes.
// Throwaway code — the real importer is src/step-import.ts (T1.2). Not part of the build or tests.
// occt-import-js was removed in T1.2; reinstall it temporarily to rerun that branch.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';

const [lib, ...files] = process.argv.slice(2);
const ms = (t0) => Math.round(performance.now() - t0);
const sha = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const r3 = (n) => Math.round(n * 1000) / 1000;
const histogram = (items) => {
  const out = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
};

async function occtImportJs() {
  const require = createRequire(import.meta.url);
  const t0 = performance.now();
  const occt = await require('occt-import-js')();
  const initMs = ms(t0);

  const load = (bytes) => {
    const t = performance.now();
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'absolute_value',
      linearDeflection: 0.1,
      angularDeflection: 0.5,
    };
    const res = occt.ReadStepFile(bytes, params);
    const loadMs = ms(t);
    if (!res.success) throw new Error('ReadStepFile failed');
    let faces = 0;
    let triangles = 0;
    const perFace = [];
    for (const [bodyId, mesh] of res.meshes.entries()) {
      triangles += mesh.index.array.length / 3;
      for (const f of mesh.brep_faces) {
        perFace.push([bodyId, f.first, f.last]);
        faces++;
      }
    }
    const positions = res.meshes.map((m) => sha(m.attributes.position.array.map(r3)));
    return {
      loadMs,
      bodies: res.meshes.length,
      faces,
      edges: 'not exposed',
      vertices: 'not exposed',
      faceTypes: 'not exposed',
      triangles,
      fingerprint: sha({ perFace, positions }),
    };
  };
  return { initMs, load };
}

async function occtWasm() {
  const { OcctKernel } = await import('occt-wasm');
  const t0 = performance.now();
  const k = await OcctKernel.init();
  const initMs = ms(t0);
  const HASH_BOUND = 2 ** 31 - 1;

  const load = (bytes) => {
    const mark = k.mark?.();
    let t = performance.now();
    const shape = k.importStep(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const importMs = ms(t);

    // Our ids = position in OCCT's deterministic topology traversal (TopExp order).
    const solids = k.getSubShapes(shape, 'solid');
    const faces = k.getSubShapes(shape, 'face');
    const edges = k.getSubShapes(shape, 'edge');
    const vertices = k.getSubShapes(shape, 'vertex');

    // face -> body: walk each solid's faces.
    const faceHashToId = new Map();
    faces.forEach((f, i) => faceHashToId.set(k.hashCode(f, HASH_BOUND), i));
    const hashCollisions = faces.length - faceHashToId.size;
    const faceToBody = new Array(faces.length).fill(-1);
    solids.forEach((s, bodyId) => {
      for (const f of k.getSubShapes(s, 'face')) {
        const id = faceHashToId.get(k.hashCode(f, HASH_BOUND));
        if (id !== undefined) faceToBody[id] = bodyId;
      }
    });

    t = performance.now();
    const mesh = k.meshShape(shape, { linearDeflection: 0.1, angularDeflection: 0.5 });
    const meshMs = ms(t);
    // faceGroups: [triStart, triCount, faceHash] — check every triangle maps to exactly one known face.
    const g = mesh.faceGroups ?? new Int32Array();
    const triToFace = new Int32Array(mesh.triangleCount).fill(-1);
    let unmappedGroups = 0;
    for (let i = 0; i < g.length; i += 3) {
      const id = faceHashToId.get(g[i + 2]);
      if (id === undefined) unmappedGroups++;
      for (let tri = g[i]; tri < g[i] + g[i + 1]; tri++) triToFace[tri] = id ?? -2;
    }
    const unmappedTriangles = triToFace.filter((v) => v < 0).length;

    t = performance.now();
    const wire = k.wireframe(shape, { source: 'triangulation' });
    const wireMs = ms(t);
    const edgeHashToId = new Map();
    edges.forEach((e, i) => edgeHashToId.set(k.hashCode(e, HASH_BOUND), i));
    let polylinesWithoutEdge = 0;
    for (let i = 0; i < wire.edgeGroups.length; i += 3) {
      if (!edgeHashToId.has(wire.edgeGroups[i + 2])) polylinesWithoutEdge++;
    }

    t = performance.now();
    const faceTypes = faces.map((f) => k.surfaceType(f));
    const edgeInfo = edges.map((e) => [k.curveType(e), r3(k.getLength(e))]);
    const vertexPos = vertices.map((v) => {
      const p = k.vertexPosition(v);
      return [r3(p.x ?? p[0]), r3(p.y ?? p[1]), r3(p.z ?? p[2])];
    });
    const queryMs = ms(t);

    const result = {
      loadMs: importMs + meshMs + wireMs,
      importMs,
      meshMs,
      wireMs,
      queryMs,
      bodies: solids.length,
      faces: faces.length,
      edges: edges.length,
      vertices: vertices.length,
      triangles: mesh.triangleCount,
      edgePolylines: wire.edgeCount,
      hashCollisions,
      facesWithoutBody: faceToBody.filter((b) => b < 0).length,
      unmappedGroups,
      unmappedTriangles,
      polylinesWithoutEdge,
      faceTypes: histogram(faceTypes),
      edgeTypes: histogram(edgeInfo.map((e) => e[0])),
      // Stable-id check: content keyed by our index, not by OCCT's hash.
      fingerprint: sha({
        faceToBody,
        faceTypes,
        edgeInfo,
        vertexPos,
        triToFace: sha(Array.from(triToFace)),
      }),
      rawHashFingerprint: sha(Array.from(g).filter((_, i) => i % 3 === 2)),
    };
    if (mark !== undefined) k.releaseSince(mark);
    else k.releaseAll();
    return result;
  };
  return { initMs, load };
}

const kernel =
  lib === 'occt-wasm' ? await occtWasm() : lib === 'occt-import-js' ? await occtImportJs() : null;
if (!kernel) throw new Error(`unknown library: ${lib}`);
console.log(
  JSON.stringify({
    lib,
    initMs: kernel.initMs,
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
  }),
);
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const first = kernel.load(bytes);
  const second = kernel.load(bytes); // reload in the same process
  console.log(
    JSON.stringify({
      file: basename(file),
      sizeMB: r3(bytes.byteLength / 1e6),
      ...first,
      reloadMs: second.loadMs,
      sameIdsOnReload: first.fingerprint === second.fingerprint,
      sameRawHashesOnReload:
        first.rawHashFingerprint === undefined
          ? undefined
          : first.rawHashFingerprint === second.rawHashFingerprint,
      rssMB: Math.round(process.memoryUsage().rss / 1e6),
    }),
  );
}
