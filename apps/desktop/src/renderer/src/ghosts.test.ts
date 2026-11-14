import { describe, expect, it } from 'vitest';
import { ghostShapes, MAX_GHOST_POINTS_PER_FACE } from './ghosts';
import type { Marker } from './markers';

function marker(over: Partial<Marker> = {}): Marker {
  return {
    id: 'm1',
    name: 'Marker 1',
    color: '#ff8a1f',
    visible: true,
    entities: [],
    transfer: {
      status: 'lost',
      from: 'base.step',
      ghost: {
        faces: [
          {
            samples: [0, 0, 0, 1, 0, 0],
            fingerprint: { body: 0, type: 'plane' },
          },
        ],
        entities: [
          { kind: 'edge', body: 0, type: 'line', point: [5, 0, 0], dir: [0, 0, 2], length: 10 },
          { kind: 'edge', body: 1, type: 'circle', point: [0, 3, 0], radius: 3 },
          { kind: 'vertex', body: 1, point: [9, 9, 9] },
          { kind: 'body', body: 1, point: [1, 1, 1] },
        ],
      },
    },
    ...over,
  };
}

describe('ghostShapes', () => {
  it('turns painted points, vertices and curved edges into dots, straight edges into lines', () => {
    const [g] = ghostShapes([marker()]);
    expect(g?.markerId).toBe('m1');
    expect(g?.color).toBe(0xff8a1f);
    expect(g?.points).toEqual([0, 0, 0, 1, 0, 0, 0, 3, 0, 9, 9, 9]);
    // 10 mm along +Z (the direction is normalised) around the midpoint.
    expect(g?.segments).toEqual([5, 0, -5, 5, 0, 5]);
  });

  it('skips hidden markers, markers without a ghost and parts on hidden bodies', () => {
    expect(ghostShapes([marker({ visible: false })])).toEqual([]);
    const plain: Marker = { id: 'm2', name: 'M', color: '#000000', visible: true, entities: [] };
    expect(ghostShapes([plain])).toEqual([]);
    expect(ghostShapes([marker({ transfer: { status: 'lost', from: 'a.step' } })])).toEqual([]);
    const [g] = ghostShapes([marker()], [true, false]);
    expect(g?.points).toEqual([0, 0, 0, 1, 0, 0]);
    expect(ghostShapes([marker()], [false, false])).toEqual([]);
  });

  it('thins out a dense painted face', () => {
    const samples = Array.from({ length: MAX_GHOST_POINTS_PER_FACE * 3 }, (_, i) => [
      i,
      0,
      0,
    ]).flat();
    const [g] = ghostShapes([
      marker({ transfer: { status: 'check', from: 'a.step', ghost: { faces: [{ samples }] } } }),
    ]);
    expect(g?.points.length).toBe(MAX_GHOST_POINTS_PER_FACE * 3);
  });
});
