import { OcctKernel } from 'occt-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { isEmptyExactRequest, pairKey, type KeptShapes } from './exact.js';
import { importStep } from './step-import.js';

let kernel: OcctKernel;
/** A 10×20×30 box and a cylinder r5 h15 at x=30 (the step-import fixture). */
let fixtureStep: string;
/** A box plus a free face (no solid) → the model gets a "loose" body. */
let looseStep: string;

beforeAll(async () => {
  kernel = await OcctKernel.init();
  const mark = kernel.checkpoint();
  const box = kernel.makeBox(10, 20, 30);
  const cylinder = kernel.translate(kernel.makeCylinder(5, 15), 30, 0, 0);
  fixtureStep = kernel.exportStep(kernel.makeCompound([box, cylinder]));
  const [freeFace] = kernel.getSubShapes(
    kernel.translate(kernel.makeBox(4, 4, 4), 0, 50, 0),
    'face',
  );
  if (!freeFace) throw new Error('no face');
  looseStep = kernel.exportStep(kernel.makeCompound([kernel.makeBox(10, 20, 30), freeFace]));
  kernel.releaseSince(mark);
}, 30_000);

function importKept(step: string): { kept: KeptShapes; faceBody: Uint32Array; bodyCount: number } {
  let kept: KeptShapes | undefined;
  const m = importStep(kernel, step, {
    keep: (k) => {
      kept = k;
    },
  });
  if (!kept) throw new Error('keep not called');
  return { kept, faceBody: m.faceBody, bodyCount: m.bodyCount };
}

describe('KeptShapes.measure', () => {
  it('gives exact areas, boxes and distances after the import finished', () => {
    const { kept, faceBody } = importKept(fixtureStep);
    const faces = Array.from(faceBody.keys());
    const r = kept.measure({
      faceAreas: faces,
      bodyAreas: [0, 1],
      bodyBoxes: [0, 1],
      distances: [
        [
          { kind: 'body', id: 0 },
          { kind: 'body', id: 1 },
        ],
        [
          { kind: 'vertex', id: 0 },
          { kind: 'vertex', id: 0 },
        ],
      ],
    });
    const boxAreas = r.faceAreas.filter((_, i) => faceBody[faces[i] ?? 0] === 0);
    expect(boxAreas.map((a) => Math.round(a)).sort((a, b) => a - b)).toEqual([
      200, 200, 300, 300, 600, 600,
    ]);
    expect(r.bodyAreas[0]).toBeCloseTo(2200, 6);
    expect(r.bodyAreas[1]).toBeCloseTo(200 * Math.PI, 6); // 2·π·5² + 2·π·5·15
    expect(r.bodyBoxes[0]?.max.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([10, 20, 30]);
    expect(r.bodyBoxes[1]?.min[0]).toBeCloseTo(25, 6);
    expect(r.bodyBoxes[1]?.max[2]).toBeCloseTo(15, 6);
    expect(r.distances[0]).toBeCloseTo(15, 9);
    expect(r.distances[1]).toBe(0);
    kept.release();
    expect(() => kept.shape({ kind: 'face', id: 0 })).toThrow('released');
  });

  it('measures the loose body (faces in no solid)', () => {
    const { kept, bodyCount } = importKept(looseStep);
    expect(bodyCount).toBe(2);
    const r = kept.measure({ faceAreas: [], bodyAreas: [1], bodyBoxes: [], distances: [] });
    expect(r.bodyAreas[0]).toBeCloseTo(16, 6);
    kept.release();
  });

  it('frees the kept shapes on release (a later import still works)', () => {
    importKept(fixtureStep).kept.release();
    const { kept } = importKept(fixtureStep);
    expect(
      kept.measure({ faceAreas: [], bodyAreas: [0], bodyBoxes: [], distances: [] }).bodyAreas[0],
    ).toBeCloseTo(2200, 6);
    kept.release();
  });
});

describe('helpers', () => {
  it('pairKey ignores order; isEmptyExactRequest', () => {
    expect(pairKey({ kind: 'face', id: 3 }, { kind: 'edge', id: 1 })).toBe(
      pairKey({ kind: 'edge', id: 1 }, { kind: 'face', id: 3 }),
    );
    expect(
      isEmptyExactRequest({ faceAreas: [], bodyAreas: [], bodyBoxes: [], distances: [] }),
    ).toBe(true);
  });
});
