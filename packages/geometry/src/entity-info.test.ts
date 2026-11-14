import { OcctKernel } from 'occt-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { entityInfo, faceAreas, measure, type EntityRef } from './entity-info.js';
import type { StepModel } from './model.js';
import { importStep } from './step-import.js';

let m: StepModel;

beforeAll(async () => {
  const k = await OcctKernel.init();
  // Body 0: 40×40×10 plate with a Ø6 hole at (10, 10). Body 1: Ø10 shaft, 20 tall, at x = 60.
  const plate = k.cut(k.makeBox(40, 40, 10), k.translate(k.makeCylinder(3, 10), 10, 10, 0));
  const shaft = k.translate(k.makeCylinder(5, 20), 60, 0, 0);
  m = importStep(k, k.exportStep(k.makeCompound([plate, shaft])));
}, 30_000);

const face = (pred: (id: number) => boolean): EntityRef => {
  const id = m.faceTypes.findIndex((_, i) => pred(i));
  expect(id).toBeGreaterThanOrEqual(0);
  return { kind: 'face', id };
};
const normalZ = (id: number): number => m.faceGeometry[id * 8 + 2] ?? NaN;
const normalX = (id: number): number => m.faceGeometry[id * 8] ?? NaN;
const plateTop = (): EntityRef =>
  face((i) => m.faceBody[i] === 0 && m.faceTypes[i] === 'plane' && normalZ(i) > 0.5);
const plateBottom = (): EntityRef =>
  face((i) => m.faceBody[i] === 0 && m.faceTypes[i] === 'plane' && normalZ(i) < -0.5);
const plateRight = (): EntityRef =>
  face((i) => m.faceBody[i] === 0 && m.faceTypes[i] === 'plane' && normalX(i) > 0.5);
const hole = (): EntityRef => face((i) => m.faceBody[i] === 0 && m.faceTypes[i] === 'cylinder');
const shaft = (): EntityRef => face((i) => m.faceBody[i] === 1 && m.faceTypes[i] === 'cylinder');
const vertexAt = (x: number, y: number, z: number): EntityRef => {
  for (let id = 0; id < m.vertexPositions.length / 3; id++) {
    const p = m.vertexPositions.subarray(id * 3, id * 3 + 3);
    if (Math.hypot((p[0] ?? 0) - x, (p[1] ?? 0) - y, (p[2] ?? 0) - z) < 1e-4)
      return { kind: 'vertex', id };
  }
  throw new Error(`no vertex at ${String([x, y, z])}`);
};

describe('entityInfo', () => {
  it('vertex: position and body', () => {
    const v = vertexAt(40, 40, 10);
    const info = entityInfo(m, v);
    expect(info.position).toEqual([40, 40, 10]);
    expect(info.body).toBe(0);
  });

  it('edges: exact line length; circle radius, centre and full arc', () => {
    const line = m.edgeTypes.findIndex(
      (t, i) => t === 'line' && Math.abs((m.edgeGeometry[i * 9 + 6] ?? 0) - 40) < 1e-6,
    );
    const li = entityInfo(m, { kind: 'edge', id: line });
    expect(li.type).toBe('line');
    expect(li.length).toBeCloseTo(40, 6);
    expect(li.start).toBeDefined();
    const circle = m.edgeTypes.findIndex((t, i) => t === 'circle' && m.edgeBody[i] === 0);
    const ci = entityInfo(m, { kind: 'edge', id: circle });
    expect(ci.radius).toBeCloseTo(3, 5);
    expect(ci.arcAngle).toBeCloseTo(360, 3);
    expect(ci.centre?.[0]).toBeCloseTo(10, 4);
    expect(ci.length).toBeCloseTo(6 * Math.PI, 4);
  });

  it('faces: hole vs shaft, radius, axis, mesh area', () => {
    const h = entityInfo(m, hole());
    expect(h.type).toBe('cylinder');
    expect(h.form).toBe('hole');
    expect(h.radius).toBeCloseTo(3, 5);
    expect(h.area).toBeGreaterThan(2 * Math.PI * 3 * 10 * 0.98);
    expect(h.area).toBeLessThanOrEqual(2 * Math.PI * 3 * 10);
    expect(entityInfo(m, shaft()).form).toBe('shaft');
    const top = entityInfo(m, plateTop());
    expect(top.normal).toEqual([0, 0, 1]);
    // 40×40 minus the hole (mesh polygon: a little more than π·9).
    expect(top.area).toBeCloseTo(1600 - Math.PI * 9, 0);
  });

  it('faceAreas: one pass for several faces, same numbers', () => {
    const refs = [hole(), plateTop()];
    const areas = faceAreas(
      m,
      refs.map((r) => r.id),
    );
    for (const r of refs) expect(areas.get(r.id)).toBeCloseTo(entityInfo(m, r).area ?? NaN, 9);
  });

  it('body: name, counts, bounding box', () => {
    const b = entityInfo(m, { kind: 'body', id: 0 });
    expect(b.faceCount).toBe(7);
    expect(b.bboxMin).toEqual([0, 0, 0]);
    expect(b.bboxMax).toEqual([40, 40, 10]);
    expect(b.name).toBe(m.bodyNames[0]);
  });
});

describe('measure', () => {
  it('two vertices: exact distance and XYZ delta', () => {
    const r = measure(m, vertexAt(0, 0, 0), vertexAt(40, 40, 10));
    expect(r.distance?.exact).toBe(true);
    expect(r.distance?.value).toBeCloseTo(Math.hypot(40, 40, 10), 5);
    expect(r.centreDistance).toBeCloseTo(Math.hypot(40, 40, 10), 5);
    expect(r.delta).toEqual([40, 40, 10]);
    expect(r.angle).toBeUndefined();
  });

  it('parallel planes: gap and 0°; perpendicular planes: 90°, no gap', () => {
    const r = measure(m, plateTop(), plateBottom());
    expect(r.planeDistance).toBeCloseTo(10, 5);
    expect(r.angle).toBeCloseTo(0, 5);
    expect(r.distance?.exact).toBe(false);
    expect(r.distance?.value).toBeCloseTo(10, 4);
    const p = measure(m, plateTop(), plateRight());
    expect(p.angle).toBeCloseTo(90, 5);
    expect(p.planeDistance).toBeUndefined();
    expect(p.distance?.value).toBeCloseTo(0, 6);
  });

  it('hole and shaft: axis distance (hole spacing), 0°', () => {
    const r = measure(m, hole(), shaft());
    expect(r.axisDistance).toBeCloseTo(Math.hypot(50, 10), 4);
    expect(r.angle).toBeCloseTo(0, 5);
    expect(r.centreDistance).toBeUndefined();
  });

  it('axis vs plane: 90° to the top face; a vertex: height above a plane and distance to an axis', () => {
    const r = measure(m, hole(), plateTop());
    expect(r.angle).toBeCloseTo(90, 5);
    expect(r.angleBetween).toBe('axis-plane');
    expect(measure(m, plateTop(), plateBottom()).angleBetween).toBe('planes');
    expect(measure(m, hole(), shaft()).angleBetween).toBe('lines');
    expect(r.planeDistance).toBeUndefined();
    const v = measure(m, vertexAt(40, 40, 10), plateBottom());
    expect(v.planeDistance).toBeCloseTo(10, 5);
    const a = measure(m, vertexAt(0, 0, 0), hole());
    expect(a.axisDistance).toBeCloseTo(Math.hypot(10, 10), 4);
  });

  it('circle edge vs plane: height of its centre', () => {
    const circles = m.edgeTypes.flatMap((t, i) =>
      t === 'circle' && m.edgeBody[i] === 0 ? [i] : [],
    );
    const heights = circles.map(
      (id) => measure(m, { kind: 'edge', id }, plateBottom()).planeDistance ?? NaN,
    );
    expect(heights.sort()).toEqual([expect.closeTo(0, 5), expect.closeTo(10, 5)]);
  });

  it('mesh distance between the plate side and the shaft (≈ 15)', () => {
    const r = measure(m, plateRight(), shaft());
    expect(r.distance?.exact).toBe(false);
    expect(r.distance?.value).toBeGreaterThanOrEqual(15 - 1e-4);
    expect(r.distance?.value).toBeLessThan(15.2);
  });
});
