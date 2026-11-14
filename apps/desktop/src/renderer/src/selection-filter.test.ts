import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTER,
  applyFilter,
  parseFilter,
  pickPassKinds,
  serializeFilter,
  toggleFilter,
  type SelectionFilter,
} from './selection-filter.js';

const only = (...kinds: string[]): SelectionFilter => ({
  vertex: kinds.includes('vertex'),
  edge: kinds.includes('edge'),
  face: kinds.includes('face'),
  body: kinds.includes('body'),
});

describe('selection filter', () => {
  it('defaults to vertex, edge and face', () => {
    expect(serializeFilter(DEFAULT_FILTER)).toBe('vertex,edge,face');
  });

  it('toggles a kind but never switches off the last one', () => {
    expect(toggleFilter(DEFAULT_FILTER, 'body')).toEqual(only('vertex', 'edge', 'face', 'body'));
    expect(toggleFilter(DEFAULT_FILTER, 'edge')).toEqual(only('vertex', 'face'));
    const last = only('face');
    expect(toggleFilter(last, 'face')).toBe(last);
  });

  it('round-trips through storage and rejects bad text', () => {
    for (const f of [DEFAULT_FILTER, only('body'), only('edge', 'body')]) {
      expect(parseFilter(serializeFilter(f))).toEqual(f);
    }
    for (const bad of [null, '', 'face,face', 'face,solid', 'vertex,', 42]) {
      expect(parseFilter(bad)).toBeUndefined();
    }
  });

  it('draws only allowed vertices/edges in the pick pass', () => {
    expect(pickPassKinds(DEFAULT_FILTER)).toEqual({ vertex: true, edge: true });
    expect(pickPassKinds(only('body'))).toEqual({ vertex: false, edge: false });
    expect(pickPassKinds(only('edge'))).toEqual({ vertex: false, edge: true });
  });

  it('maps a raw pick to what the filter allows', () => {
    const face = { kind: 'face' as const, id: 4 };
    const edge = { kind: 'edge' as const, id: 2 };
    expect(applyFilter(face, 7, DEFAULT_FILTER)).toEqual(face);
    expect(applyFilter(edge, 7, DEFAULT_FILTER)).toEqual(edge);
    // Face off, body on: anywhere on the part picks the whole body.
    expect(applyFilter(face, 7, only('body'))).toEqual({ kind: 'body', id: 7 });
    expect(applyFilter(face, 7, only('edge', 'body'))).toEqual({ kind: 'body', id: 7 });
    // Faces and bodies both off: a face is only an occluder.
    expect(applyFilter(face, 7, only('edge'))).toBeUndefined();
    // Faces win over bodies when both are on.
    expect(applyFilter(face, 7, only('face', 'body'))).toEqual(face);
    expect(applyFilter(undefined, 0, DEFAULT_FILTER)).toBeUndefined();
  });
});
