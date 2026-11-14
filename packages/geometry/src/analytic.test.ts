import { OcctKernel } from 'occt-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { EDGE_GEOMETRY_STRIDE, FACE_GEOMETRY_STRIDE, type StepModel } from './model.js';
import { importStep } from './step-import.js';

let m: StepModel;

beforeAll(async () => {
  const k = await OcctKernel.init();
  // A 40×40×10 plate with a Ø6 hole at (10, 10); a Ø10 shaft standing at x=60; a cone, a ball
  // and a ring further out — everything moved so centres are not at the origin.
  const plate = k.cut(k.makeBox(40, 40, 10), k.translate(k.makeCylinder(3, 10), 10, 10, 0));
  const shaft = k.translate(k.makeCylinder(5, 20), 60, 0, 0);
  const cone = k.translate(k.makeCone(4, 2, 10), 100, 0, 0);
  const ball = k.translate(k.makeSphere(7), 0, 100, 0);
  const ring = k.translate(k.makeTorus(10, 2), 50, 100, 5);
  m = importStep(k, k.exportStep(k.makeCompound([plate, shaft, cone, ball, ring])));
}, 30_000);

const faceRecord = (id: number): number[] =>
  Array.from(m.faceGeometry.subarray(id * FACE_GEOMETRY_STRIDE, (id + 1) * FACE_GEOMETRY_STRIDE));
const edgeRecord = (id: number): number[] =>
  Array.from(m.edgeGeometry.subarray(id * EDGE_GEOMETRY_STRIDE, (id + 1) * EDGE_GEOMETRY_STRIDE));
const facesOf = (type: string, body: number): number[] =>
  m.faceTypes.flatMap((t, id) => (t === type && m.faceBody[id] === body ? [id] : []));
const near = (a: readonly number[], b: readonly number[], tol = 1e-4): void => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => {
    expect(Math.abs(x - (b[i] ?? NaN))).toBeLessThan(tol);
  });
};
/** Axis directions may point either way. */
const sameAxis = (a: readonly number[], b: readonly number[]): void => {
  const flip =
    (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0) < 0;
  near(flip ? a.map((x) => -x) : a, b);
};

describe('face geometry', () => {
  it('plane: outward normal and a point on the face', () => {
    const tops = facesOf('plane', 0).filter((id) => (faceRecord(id)[2] ?? 0) > 0.5);
    expect(tops.length).toBe(1);
    const r = faceRecord(tops[0] ?? -1);
    near(r.slice(0, 3), [0, 0, 1]);
    expect(r[5]).toBeCloseTo(10, 5);
  });

  it('cylinder: radius, axis through the centre, hole vs shaft', () => {
    const [hole] = facesOf('cylinder', 0);
    const h = faceRecord(hole ?? -1);
    sameAxis(h.slice(0, 3), [0, 0, 1]);
    near(h.slice(3, 5), [10, 10]);
    expect(h[6]).toBeCloseTo(3, 5);
    expect(h[7]).toBe(-1);
    const [shaft] = facesOf('cylinder', 1);
    const s = faceRecord(shaft ?? -1);
    near(s.slice(3, 5), [60, 0]);
    expect(s[6]).toBeCloseTo(5, 5);
    expect(s[7]).toBe(1);
  });

  it('cone: apex, axis towards the wide end, half-angle', () => {
    const [cone] = facesOf('cone', 2);
    const c = faceRecord(cone ?? -1);
    // r 4 → 2 over 10: apex at z = 20, axis pointing down.
    near(c.slice(0, 3), [0, 0, -1]);
    near(c.slice(3, 6), [100, 0, 20], 1e-3);
    expect(c[6]).toBeCloseTo(Math.atan(0.2), 5);
    expect(c[7]).toBe(1);
  });

  it('sphere: centre and radius', () => {
    const [ball] = facesOf('sphere', 3);
    const s = faceRecord(ball ?? -1);
    near(s.slice(3, 6), [0, 100, 0]);
    expect(s[6]).toBeCloseTo(7, 5);
    expect(s[7]).toBe(1);
  });

  it('torus: centre, axis, both radii', () => {
    const [ring] = facesOf('torus', 4);
    const t = faceRecord(ring ?? -1);
    sameAxis(t.slice(0, 3), [0, 0, 1]);
    near(t.slice(3, 6), [50, 100, 5]);
    expect(t[6]).toBeCloseTo(10, 5);
    expect(t[7]).toBeCloseTo(2, 5);
  });
});

describe('edge geometry', () => {
  it('line: direction, start, exact length', () => {
    const lines = m.edgeTypes.flatMap((t, id) =>
      t === 'line' && m.edgeBody[id] === 0 ? [id] : [],
    );
    const lengths = lines.map((id) => edgeRecord(id)[6] ?? NaN);
    expect(lengths.some((l) => Math.abs(l - 40) < 1e-6)).toBe(true);
    for (const id of lines) {
      const r = edgeRecord(id);
      expect(Math.hypot(r[0] ?? NaN, r[1] ?? NaN, r[2] ?? NaN)).toBeCloseTo(1, 5);
      expect(r[7]).toBeNaN();
    }
  });

  it('circle: centre, axis, radius, full-circle arc angle', () => {
    const circles = m.edgeTypes.flatMap((t, id) =>
      t === 'circle' && m.edgeBody[id] === 0 ? [id] : [],
    );
    expect(circles.length).toBe(2);
    for (const id of circles) {
      const r = edgeRecord(id);
      sameAxis(r.slice(0, 3), [0, 0, 1]);
      near(r.slice(3, 5), [10, 10]);
      expect(r[7]).toBeCloseTo(3, 5);
      expect(r[8]).toBeCloseTo(2 * Math.PI, 5);
      expect(r[6]).toBeCloseTo(6 * Math.PI, 4);
    }
  });
});
