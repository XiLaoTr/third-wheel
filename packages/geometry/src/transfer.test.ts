import { readFileSync } from 'node:fs';
import { annotationsSchema, type Annotations, type BodyFingerprint } from '@third-wheel/core';
import { OcctKernel } from 'occt-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StepModel } from './model.js';
import { paintSamples } from './paint-samples.js';
import { baseAnnotations, parseRevisionSet, type RevisionSet } from './revision-set.js';
import { importStep } from './step-import.js';
import { matchBodies, placeGhost, transferAnnotations } from './transfer.js';

const dir = new URL('../test-data/revisions/', import.meta.url);
const set: RevisionSet = parseRevisionSet(
  JSON.parse(readFileSync(new URL('revisions.json', dir), 'utf8')),
);
let base: StepModel;
let before: Annotations;
const models = new Map<string, StepModel>();
const model = (id: string): StepModel => {
  const m = models.get(id);
  if (!m) throw new Error(id);
  return m;
};

beforeAll(async () => {
  const k = await OcctKernel.init();
  base = importStep(k, readFileSync(new URL(set.base, dir), 'utf8'));
  before = baseAnnotations(base, set, set.base);
  for (const id of ['05-rib', '06-hole-removed', '09-mirrored', '10-renamed-reordered'])
    models.set(id, importStep(k, readFileSync(new URL(`${id}.step`, dir), 'utf8')));
}, 60_000);

describe('transferAnnotations', () => {
  it('writes a valid sidecar: comments kept, lost markers with their old place, new bodies', () => {
    const r = transferAnnotations(before, model('06-hole-removed'));
    const doc = annotationsSchema.parse(r.annotations);
    expect(doc.comments).toEqual(before.comments);
    expect(doc.bodies?.map((b) => b.name)).toEqual(['Bracket', 'Pin']);
    const hole = doc.markers.find((m) => m.id === 'm_hole');
    expect(r.status.m_hole).toBe('lost');
    expect(hole?.entities).toEqual([]);
    expect(hole?.transfer).toMatchObject({ status: 'lost', from: 'base.step' });
    expect(hole?.transfer?.ghost?.entities?.[0]?.type).toBe('cylinder');
    // Found markers carry no transfer note.
    expect(doc.markers.find((m) => m.id === 'm_top')?.transfer).toBeUndefined();
  });

  it('keeps a mirrored body’s paint as a ghost, at its mirrored place ("check")', () => {
    const r = transferAnnotations(before, model('09-mirrored'));
    const top = r.annotations.markers.find((m) => m.id === 'm_top');
    expect(top?.transfer?.status).toBe('check');
    expect(top?.paint.faces).toEqual([]);
    const ghost = top?.transfer?.ghost?.faces?.flatMap((f) => f.samples) ?? [];
    expect(ghost.length).toBeGreaterThan(0);
    // The mirrored plate's top (z = 6).
    for (let i = 0; i < ghost.length; i += 3) expect(ghost[i + 2]).toBeCloseTo(6, 3);
  });

  it('places a "check" ghost where it is drawn ("✓ Place here")', () => {
    const m = model('09-mirrored');
    const r = transferAnnotations(before, m);
    const top = r.annotations.markers.find((mk) => mk.id === 'm_top');
    const ghost = top?.transfer?.ghost;
    if (!ghost) throw new Error('no ghost');
    const placed = placeGhost(ghost, m);
    expect(placed.ghost).toBeUndefined();
    expect(placed.paint.length).toBeGreaterThan(0);
    // Painted triangles lie on the mirrored plate's top (z = 6), where the dots were.
    for (const f of placed.paint)
      for (const [first, count] of f.triangles)
        for (let t = first; t < first + count; t++)
          for (let c = 0; c < 3; c++) {
            const v = m.indices[t * 3 + c] ?? 0;
            expect(m.positions[v * 3 + 2]).toBeCloseTo(6, 2);
          }
    // Held entities of "check" markers come along too.
    const held = r.annotations.markers.filter((mk) => mk.transfer?.ghost?.entities?.length);
    for (const mk of held) {
      const g = mk.transfer?.ghost;
      if (!g) continue;
      const p = placeGhost(g, m);
      expect(p.entities.length + (p.ghost?.entities?.length ?? 0)).toBe(g.entities?.length);
    }
  });

  it('keeps an earlier unconfirmed status when the marker is found again', () => {
    const flagged: Annotations = {
      ...before,
      markers: before.markers.map((m) =>
        m.id === 'm_top' ? { ...m, transfer: { status: 'changed', from: 'v0.step' } } : m,
      ),
    };
    const r = transferAnnotations(flagged, model('05-rib'));
    expect(r.status.m_top).toBe('changed');
    expect(r.annotations.markers.find((m) => m.id === 'm_top')?.transfer?.from).toBe('v0.step');
  });

  it('moves paint from an older sidecar (one sample list per marker, no faces)', () => {
    const legacy: Annotations = {
      ...before,
      markers: before.markers.map((m) => ({
        ...m,
        paint: {
          faces: m.paint.faces.map((f) => ({ faceId: f.faceId, triangles: f.triangles })),
          ...(m.paint.faces.length
            ? { samples: m.paint.faces.flatMap((f) => f.samples ?? []) }
            : {}),
        },
      })),
    };
    const r = transferAnnotations(legacy, model('05-rib'));
    expect(r.status.m_top).toBe('found');
    expect(r.annotations.markers.find((m) => m.id === 'm_top')?.paint.faces.length).toBeGreaterThan(
      0,
    );
  });

  it('calls paint saved without sample points lost, never found', () => {
    const bare: Annotations = {
      ...before,
      markers: before.markers.map((m) => ({
        ...m,
        paint: { faces: m.paint.faces.map((f) => ({ faceId: f.faceId, triangles: f.triangles })) },
      })),
    };
    const r = transferAnnotations(bare, model('05-rib'));
    expect(r.status.m_top).toBe('lost');
    expect(r.status.m_hole).toBe('found'); // held entities still move
  });

  it('remaps the body list (folders kept, rows follow their body)', () => {
    const doc: Annotations = {
      ...before,
      bodyTree: {
        folders: [{ id: 'f1', name: 'Mine', parent: 'top' }],
        bodies: [{ body: 1, parent: { folder: 'f1' } }],
        assemblies: [{ assembly: 0, parent: { folder: 'f1' } }],
      },
    };
    const r = transferAnnotations(doc, model('10-renamed-reordered'));
    // The Pin moved to index 0; the bodies' order changed, so assembly rows are dropped.
    expect(r.annotations.bodyTree?.bodies).toEqual([{ body: 0, parent: { folder: 'f1' } }]);
    expect(r.annotations.bodyTree?.assemblies).toEqual([]);
    expect(r.annotations.bodyTree?.folders).toHaveLength(1);
  });
});

describe('matchBodies', () => {
  const body = (
    name: string,
    centre: number[],
    size = [10, 20, 30],
    area = 100,
  ): BodyFingerprint => ({
    name,
    size: size as [number, number, number],
    centre: centre as [number, number, number],
    area,
  });

  it('matches by name, then by size, then the nearest', () => {
    const old = [
      body('A', [0, 0, 0]),
      body('B', [50, 0, 0]),
      body('Body', [0, 0, 0], [1, 1, 1], 6),
    ];
    const now = [
      body('Body', [100, 0, 0], [1, 1, 1], 6),
      body('B', [0, 0, 0]),
      body('A renamed', [1, 0, 0], [30, 10, 20]),
      body('Body', [0, 1, 0], [1, 1, 1], 6),
    ];
    const map = matchBodies(old, now);
    expect(map.get(1)).toBe(1); // by name
    expect(map.get(0)).toBe(2); // by size (sides in any order)
    expect(map.get(2)).toBe(3); // same name twice: the nearest
  });

  it('leaves a body with no match out', () => {
    expect(matchBodies([body('A', [0, 0, 0])], [body('B', [0, 0, 0], [5, 5, 5], 9)]).size).toBe(0);
  });

  it('keeps indices for sidecars without body fingerprints', () => {
    expect([...matchBodies(undefined, [body('A', [0, 0, 0]), body('B', [0, 0, 0])])]).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('paintSamples', () => {
  it('spreads points over the paint, at most `max`, at least one per face', () => {
    const tris = Array.from({ length: base.triangleFace.length }, (_, t) => ({
      t,
      tree: 1 as const,
    }));
    const out = paintSamples(base, tris, 500);
    const total = [...out.values()].reduce((s, p) => s + p.samples.length / 3, 0);
    expect(total).toBeLessThanOrEqual(500);
    expect(total).toBeGreaterThan(200);
    expect(out.size).toBe(new Set(base.triangleFace).size);
    for (const pts of out.values()) {
      expect(pts.samples.length).toBeGreaterThanOrEqual(3);
      expect(pts.clear).toEqual([]); // every face wholly painted: no edge to mark
    }
  });

  it('samples only the painted pieces of a cut triangle', () => {
    const f0 = base.triangleFace[0] ?? 0;
    const whole = paintSamples(base, [{ t: 0, tree: 1 }], 100).get(f0);
    const quarter = paintSamples(base, [{ t: 0, tree: [1, 0, 0, 0] }], 100).get(f0);
    expect(quarter?.samples.length).toBeGreaterThan(0);
    expect(quarter?.samples.length).toBeLessThanOrEqual(whole?.samples.length ?? 0);
    // Where the paint ends: clear points on the unpainted pieces and the triangles around.
    expect(quarter?.clear.length).toBeGreaterThan(0);
  });
});
