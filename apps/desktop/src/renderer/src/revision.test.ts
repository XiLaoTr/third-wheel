import { SCHEMA_VERSION, type Annotations } from '@third-wheel/core';
import { describe, expect, it } from 'vitest';
import {
  annotationCounts,
  carriedText,
  hasNotes,
  keptOwnText,
  ownNotesQuestion,
  movedText,
  revisionResult,
  transferSummary,
  sameGeometry,
  versionQuestionText,
  meshMovedText,
  meshQuestion,
  waitingText,
  type PreviousAnnotations,
} from './revision.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const MESH = `sha256:${'b'.repeat(64)}`;
const OTHER = `sha256:${'c'.repeat(64)}`;
const TESS = { linearDeflection: 0.1, angularDeflection: 0.5 };

function doc(meshHash?: string, markers = 2, comments = 3): Annotations {
  return {
    schemaVersion: SCHEMA_VERSION,
    model: {
      fileName: 'part.step',
      format: 'step',
      contentHash: HASH,
      ...(meshHash ? { meshHash } : {}),
    },
    tessellation: TESS,
    markers: Array.from({ length: markers }, (_, i) => ({
      id: `m${String(i + 1)}`,
      name: `Marker ${String(i + 1)}`,
      color: '#ff0000',
      visible: true,
      entities: [],
      paint: { faces: [] },
    })),
    comments: Array.from({ length: comments }, (_, i) => ({
      id: `c${String(i + 1)}`,
      text: 'x',
      markerIds: [],
      status: 'open' as const,
      author: 'human' as const,
      createdAt: '2026-11-09T10:00:00.000Z',
      updatedAt: '2026-11-09T10:00:00.000Z',
    })),
  };
}

const prev = (d: Annotations, own: boolean): PreviousAnnotations => ({
  doc: d,
  droppedFields: [],
  path: own ? '/a/part.step' : '/a/part-v1.step',
  name: own ? 'part.step' : 'part-v1.step',
  own,
});

describe('revision (T8.1)', () => {
  it('same geometry = same mesh hash and mesh settings', () => {
    expect(sameGeometry(doc(MESH), MESH, TESS)).toBe(true);
    expect(sameGeometry(doc(MESH), OTHER, TESS)).toBe(false);
    expect(sameGeometry(doc(MESH), MESH, { ...TESS, linearDeflection: 0.05 })).toBe(false);
  });

  it('a sidecar without a mesh hash fits only by the previous model in memory', () => {
    expect(sameGeometry(doc(), MESH, TESS)).toBe(false);
    expect(sameGeometry(doc(), MESH, TESS, MESH)).toBe(true);
    expect(sameGeometry(doc(), MESH, TESS, OTHER)).toBe(false);
    // The saved hash wins over the one in memory.
    expect(sameGeometry(doc(OTHER), MESH, TESS, MESH)).toBe(false);
  });

  it('counts what the previous version had', () => {
    expect(annotationCounts(doc(MESH))).toBe('2 markers and 3 comments');
    expect(annotationCounts(doc(MESH, 1, 0))).toBe('1 marker');
    expect(annotationCounts(doc(MESH, 0, 1))).toBe('1 comment');
    expect(annotationCounts(doc(MESH, 0, 0))).toBe('no annotations');
  });

  it('words the "new version?" question (T8.4)', () => {
    expect(versionQuestionText('part-v2.step', prev(doc(MESH), false))).toBe(
      'part-v1.step has 2 markers and 3 comments. Bring them over to part-v2.step? They are moved onto the new geometry; part-v1.step and its notes stay as they are.',
    );
  });

  it('words the carried-over notice for the same file and for another one', () => {
    expect(carriedText(prev(doc(MESH), true), 'part.step')).toBe(
      'part.step changed on disk, but its geometry is the same: 2 markers and 3 comments carried over.',
    );
    expect(carriedText(prev(doc(MESH), false), 'part-v2.step')).toMatch(
      /^part-v2\.step has the same geometry as part-v1\.step: 2 markers/,
    );
    expect(carriedText(prev(doc(MESH), false), 'part-v2.step', 'o.bak.json')).toMatch(
      /carried over\. Its own older annotations were moved to o\.bak\.json\.$/,
    );
  });

  it('says where the annotations stay when the geometry changed', () => {
    const own = waitingText(prev(doc(MESH), true), 'part.step', 'the model file changed', 'b.json');
    expect(own).toMatch(/new version \(the model file changed\).*were moved to b\.json/);
    expect(own).toMatch(/could not be moved/);
    expect(waitingText(prev(doc(MESH), true), 'part.step', 'x', null)).toMatch(/left as they are/);
    expect(waitingText(prev(doc(MESH), false), 'part-v2.step', '', null)).toMatch(
      /^part-v2\.step is a new version of part-v1\.step\. Its 2 markers and 3 comments stay saved with part-v1\.step/,
    );
  });

  it('tells the AI the previous file and its counts', () => {
    expect(revisionResult(prev(doc(MESH), false), 'waiting', doc(MESH))).toEqual({
      of: 'part-v1.step',
      path: '/a/part-v1.step',
      annotations: 'waiting',
      markers: 2,
      comments: 3,
    });
    expect(revisionResult({ name: 'a.step', path: '/a.step' }, 'none')).toMatchObject({
      markers: 0,
      comments: 0,
    });
  });

  it('counts the transfer per status and lists the flagged markers (T8.2)', () => {
    const d = doc(MESH, 3);
    const sum = transferSummary(d, { m1: 'found', m2: 'changed' });
    expect(sum).toEqual({
      found: 1,
      changed: 1,
      lost: 1, // no status = lost
      check: 0,
      flagged: [
        { id: 'm2', name: 'Marker 2', status: 'changed' },
        { id: 'm3', name: 'Marker 3', status: 'lost' },
      ],
    });
    expect(revisionResult(prev(d, false), 'moved', d, sum).transfer).toBe(sum);
  });

  it('words the notice after moving annotations (T8.2)', () => {
    const d = doc(MESH, 3);
    const sum = transferSummary(d, { m1: 'found', m2: 'changed' });
    expect(movedText(prev(d, false), 'part-v2.step', sum, null)).toBe(
      'part-v2.step is a new version of part-v1.step: 3 markers moved over — 1 found, 1 changed, 1 lost. Look for ⚠ in Markers.',
    );
    const all = transferSummary(d, { m1: 'found', m2: 'found', m3: 'found' });
    expect(movedText(prev(d, true), 'part.step', all, 'p.bak.json')).toBe(
      'part.step changed on disk: 3 markers moved onto the new geometry, all found. The old file was kept as p.bak.json.',
    );
  });
});

describe('mesh → STEP (T9.2)', () => {
  const stl: PreviousAnnotations = {
    ...prev(doc(), false),
    path: '/a/cover.stl',
    name: 'cover.stl',
  };
  const sum = { found: 2, changed: 0, lost: 0, check: 0, flagged: [] };
  const cov = {
    points: 1000,
    matched: 996,
    surface: 1,
    toleranceMm: 0.986,
    mirrored: false,
    meshRead: true,
  };

  it('asks whether the STEP is the same part', () => {
    expect(meshQuestion('cover.step', stl)).toEqual({
      title: 'Is cover.step the same part as cover.stl?',
      text: 'cover.stl has 2 markers and 3 comments. Bring them onto cover.step? The two files are lined up and the paint goes onto the nearest STEP faces; cover.stl and its notes stay as they are.',
    });
  });

  it('reports the share of paint matched and the tolerance', () => {
    expect(meshMovedText(stl, 'cover.step', sum, cov, null)).toBe(
      'Notes from cover.stl moved onto cover.step: 2 markers, 99 % of the paint matched a STEP face within 0.99 mm.',
    );
  });

  it('flags lost markers, a poor fit and a mirror', () => {
    const bad = { ...sum, found: 1, lost: 1 };
    expect(
      meshMovedText(stl, 'cover.step', bad, { ...cov, matched: 400, surface: 0.42 }, null),
    ).toBe(
      'Notes from cover.stl moved onto cover.step: 2 markers, 40 % of the paint matched a STEP face within 0.99 mm (1 lost). Look for ⚠ in Markers. Only 42 % of the mesh lies on the STEP surface: the files may be different parts or versions.',
    );
    expect(
      meshMovedText(
        stl,
        'cover.step',
        { ...sum, found: 0, check: 2 },
        { ...cov, mirrored: true },
        null,
      ),
    ).toContain('only fits the STEP as a mirror image');
  });
});

describe('import onto a file with its own notes (T15.2)', () => {
  const prev: PreviousAnnotations = {
    doc: doc(MESH, 2, 3),
    droppedFields: [],
    path: '/p/bracket.step',
    name: 'bracket.step',
    own: false,
  };
  it('an empty notes file counts as no notes', () => {
    expect(hasNotes(doc(MESH, 0, 0))).toBe(false);
    // doc()'s markers are empty (no paint, no entities): like an unused "Marker 1".
    expect(hasNotes(doc(MESH, 1, 0))).toBe(false);
    const held = doc(MESH, 1, 0);
    expect(
      hasNotes({
        ...held,
        markers: held.markers.map((m) => ({
          ...m,
          entities: [{ kind: 'face' as const, id: 3, seq: 0 }],
        })),
      }),
    ).toBe(true);
    const painted = doc(MESH, 1, 0);
    expect(
      hasNotes({
        ...painted,
        markers: painted.markers.map((m) => ({
          ...m,
          paint: { faces: [{ faceId: 0, triangles: [[0, 1]] }] },
        })),
      }),
    ).toBe(true);
    expect(hasNotes(doc(MESH, 0, 1))).toBe(true);
  });
  it('words the Keep / Replace question and the notice after Keep', () => {
    const q = ownNotesQuestion('bracket_v2.step', doc(MESH, 1, 1), prev);
    expect(q.title).toBe('bracket_v2.step already has its own notes');
    expect(q.text).toContain('bracket_v2.step has 1 marker and 1 comment');
    expect(q.text).toContain('bracket.step has 2 markers and 3 comments');
    expect(q.keep).toBe('Keep its notes');
    expect(q.replace).toBe('Replace with notes from bracket.step');
    expect(keptOwnText('bracket_v2.step', 'bracket.step')).toBe(
      'bracket_v2.step kept its own notes; nothing was moved from bracket.step.',
    );
  });
});
