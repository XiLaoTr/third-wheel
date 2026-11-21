import { describe, expect, it } from 'vitest';
import { nextPartId } from './parts.js';
import { parseAnnotations } from './schema.js';

const screw = {
  id: 'p1',
  source: {
    kind: 'library',
    library: 'bd_warehouse',
    version: '0.4.0',
    cls: 'SocketHeadCapScrew',
    params: { size: 'M5-0.8', length: 16, simple: true },
  },
  copies: 2,
  scope: 'whole',
  target: { markerIds: ['m1'] },
  note: 'flush with the surface',
};

function doc(parts: unknown, markerIds: string[] = ['m1']): unknown {
  const at = '2026-11-21T10:00:00.000Z';
  return {
    schemaVersion: 1,
    model: { fileName: 'bracket.step', format: 'step', contentHash: `sha256:${'a'.repeat(64)}` },
    tessellation: { linearDeflection: 0.1, angularDeflection: 0.5 },
    markers: [
      {
        id: 'm1',
        name: 'Hole 1',
        color: '#2fbf71',
        visible: true,
        entities: [],
        paint: { faces: [] },
      },
      {
        id: 'm2',
        name: 'Hole 2',
        color: '#a855f7',
        visible: true,
        entities: [],
        paint: { faces: [] },
      },
    ],
    comments: [
      {
        id: 'c1',
        text: 'Fasten the parts here.',
        markerIds,
        status: 'open',
        author: 'human',
        createdAt: at,
        updatedAt: at,
        ...(parts === undefined ? {} : { parts }),
      },
    ],
  };
}

describe('part requests in the sidecar schema', () => {
  it('reads a comment with parts and keeps them whole', () => {
    const r = parseAnnotations(doc([screw]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.comments[0]?.parts).toEqual([screw]);
    expect(r.droppedFields).toEqual([]);
  });

  it('reads parts with sub-parts, a pattern and a result', () => {
    const richer = {
      ...screw,
      id: 'p2',
      scope: { subparts: ['OuterRace', 'InnerRace'] },
      target: { markerIds: ['m1', 'm2'], mode: 'pattern', spacing: 12.5 },
      result: {
        status: 'placed',
        bodies: ['Screw M5 (Hole 1)'],
        note: 'two screws',
        updatedAt: '2026-11-21T10:05:00.000Z',
      },
    };
    const r = parseAnnotations(doc([screw, richer], ['m1', 'm2']));
    expect(r.ok).toBe(true);
  });

  it('accepts a comment without parts', () => {
    expect(parseAnnotations(doc(undefined)).ok).toBe(true);
  });

  it('refuses two parts with the same id', () => {
    const r = parseAnnotations(doc([screw, { ...screw }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/duplicate part id "p1"/);
  });

  it('refuses a part aimed at a marker the comment does not name', () => {
    const r = parseAnnotations(doc([{ ...screw, target: { markerIds: ['m2'] } }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/does not name/);
  });

  it('drops a malformed parts list but keeps the comment and the file', () => {
    const r = parseAnnotations(doc([{ ...screw, copies: 0 }]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.comments[0]?.parts).toBeUndefined();
      expect(r.data.comments[0]?.text).toBe('Fasten the parts here.');
    }
  });

  it('drops unknown keys of a newer writer and says so', () => {
    const r = parseAnnotations(doc([{ ...screw, future: 1 }]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.droppedFields.join(' ')).toContain('parts.0.future');
      expect(r.data.comments[0]?.parts?.[0]).toEqual(screw);
    }
  });

  it('limits the parameters of one part', () => {
    const params = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${String(i)}`, i]));
    const r = parseAnnotations(doc([{ ...screw, source: { ...screw.source, params } }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.comments[0]?.parts).toBeUndefined(); // dropped as malformed
  });
});

describe('nextPartId', () => {
  it('counts above the highest id', () => {
    expect(nextPartId([])).toBe('p1');
    expect(nextPartId([{ id: 'p1' }, { id: 'p7' }, { id: 'x' }])).toBe('p8');
  });
});
