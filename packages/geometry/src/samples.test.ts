/**
 * Optional check against the large local samples in `test-models/`
 * (or the folder in `THIRD_WHEEL_SAMPLES_DIR`; not in CI):
 *   THIRD_WHEEL_SAMPLES=1 pnpm test packages/geometry
 * `THIRD_WHEEL_SAMPLES=<text>` runs only files whose name contains <text>. Files over 100 MB are
 * imported once (no reload check) and log their peak WASM heap; they take minutes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OcctKernel } from 'occt-wasm';
import { describe, expect, it } from 'vitest';
import { importStep } from './step-import.js';

const dir =
  process.env['THIRD_WHEEL_SAMPLES_DIR'] ??
  join(import.meta.dirname, '..', '..', '..', 'test-models');
const filter = process.env['THIRD_WHEEL_SAMPLES'];
const all =
  filter && existsSync(dir)
    ? readdirSync(dir).filter(
        (f) => /\.(step|stp)$/i.test(f) && (filter === '1' || f.includes(filter)),
      )
    : [];
const BIG = 100e6;
/** occt-wasm's Emscripten module (untyped; a variable so tsc does not look for types). */
const EMSCRIPTEN_FACTORY: string = 'occt-wasm/dist/occt-wasm.js';
const isBig = (f: string): boolean => statSync(join(dir, f)).size > BIG;
const files = all.filter((f) => !isBig(f));
const bigFiles = all.filter(isBig);

describe.skipIf(bigFiles.length === 0)('very large local STEP samples', () => {
  it.each(bigFiles)(
    '%s imports within the WASM heap',
    async (file) => {
      // Wrap the Emscripten factory to read the heap size (the kernel keeps its module private).
      const factory = (
        (await import(EMSCRIPTEN_FACTORY)) as {
          default: (o: object) => Promise<{ HEAP32: Int32Array }>;
        }
      ).default;
      let heap: { HEAP32: Int32Array } | undefined;
      const kernel = await OcctKernel.init({
        createModule: async (o: object) => (heap = await factory(o)),
      });
      const heapMB = (): number => Math.round((heap?.HEAP32.buffer.byteLength ?? 0) / 2 ** 20);
      const bytes = readFileSync(join(dir, file));
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const heapAtStage: Record<string, number> = {};
      let last = 'start';
      const t0 = performance.now();
      const m = importStep(kernel, data, {
        onStage: (stage) => {
          heapAtStage[`before-${stage}`] = heapMB();
          last = stage;
        },
      });
      heapAtStage[`after-${last}`] = heapMB();
      console.log(
        JSON.stringify({
          file,
          sizeMB: Math.round(bytes.byteLength / 1e6),
          ms: Math.round(performance.now() - t0),
          bodies: m.bodyCount,
          faces: m.faceBody.length,
          edges: m.edgeTypes.length,
          triangles: m.triangleFace.length,
          heapMB: heapAtStage,
          ...m.stats,
          unexplainedEdgesWithoutPolyline: m.stats.unexplainedEdgesWithoutPolyline.length,
        }),
      );
      expect(new Set(m.triangleFace).size).toBeGreaterThan(m.faceBody.length * 0.99);
    },
    900_000,
  );
});

describe.skipIf(files.length === 0)('local STEP samples', () => {
  it.each(files)(
    '%s imports consistently and reloads with the same ids',
    async (file) => {
      const kernel = await OcctKernel.init();
      const bytes = readFileSync(join(dir, file));
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const t0 = performance.now();
      const a = importStep(kernel, data);
      const ms = Math.round(performance.now() - t0);
      const b = importStep(kernel, data);
      console.log(
        JSON.stringify({
          file,
          ms,
          bodies: a.bodyCount,
          faces: a.faceBody.length,
          edges: a.edgeTypes.length,
          vertices: a.vertexPositions.length / 3,
          triangles: a.triangleFace.length,
          ...a.stats,
        }),
      );
      expect(Array.from(b.triangleFace)).toEqual(Array.from(a.triangleFace));
      expect(Array.from(b.faceBody)).toEqual(Array.from(a.faceBody));
      expect(Array.from(b.edgeBody)).toEqual(Array.from(a.edgeBody));
      expect(Array.from(b.vertexBody)).toEqual(Array.from(a.vertexBody));
      expect(Array.from(b.edgeRanges)).toEqual(Array.from(a.edgeRanges));
      // Part names: the assembly tree lines up with the bodies.
      expect(a.stats.partNamesMatched).toBe(true);
      console.log(JSON.stringify({ file, names: a.bodyNames.slice(0, 6), path: a.bodyPaths[0] }));
      // The XCAF read (which gives names) yields the same topology as the plain STEP read.
      const mark = kernel.checkpoint();
      const plain = kernel.importStep(data);
      const plainFaces = kernel.getSubShapes(plain, 'face');
      expect(plainFaces.length).toBe(a.faceBody.length);
      // Same order too: face ids from either reader must agree (markers/sidecar rely on them).
      const doc = kernel.importXCAFFromSTEP(new TextDecoder().decode(data));
      const root = doc.getRoots()[0];
      const xcafShape = root === undefined ? undefined : doc.getLabelInfo(root).shapeHandle;
      if (!xcafShape) throw new Error('no XCAF root shape');
      const xcafFaces = kernel.getSubShapes(xcafShape, 'face');
      const box = (f: (typeof plainFaces)[number]): string => {
        const b = kernel.getBoundingBox(f, { precise: false });
        return [b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
          .map((v) => Math.round(v * 1000))
          .join();
      };
      const misordered = plainFaces.filter((f, i) => {
        const g = xcafFaces[i];
        return g === undefined || box(f) !== box(g);
      }).length;
      doc.close();
      expect(misordered).toBe(0);
      expect(kernel.getSubShapes(plain, 'edge').length).toBe(a.edgeTypes.length);
      expect(kernel.getSubShapes(plain, 'solid').length).toBe(
        a.bodyCount - (a.hasLooseBody ? 1 : 0),
      );
      kernel.releaseSince(mark);
      // Every face has triangles unless OCCT couldn't mesh it.
      expect(new Set(a.triangleFace).size).toBeGreaterThan(a.faceBody.length * 0.99);
    },
    120_000,
  );
});
