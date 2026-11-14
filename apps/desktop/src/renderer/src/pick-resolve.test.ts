import { describe, expect, it } from 'vitest';
import { encodePick, resolvePick, type EntityKind } from './pick-resolve.js';

/** size×size block, all background, with given entities painted at (x, y). */
function block(size: number, paint: [number, number, EntityKind, number][]): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (const [x, y, kind, id] of paint) px.set(encodePick(kind, id), (y * size + x) * 4);
  return px;
}

/** Face `id` everywhere. */
function faceBlock(size: number, id: number): [number, number, EntityKind, number][] {
  const out: [number, number, EntityKind, number][] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push([x, y, 'face', id]);
  return out;
}

describe('resolvePick', () => {
  it('returns nothing over background', () => {
    expect(resolvePick(block(13, []), 13, 6)).toBeUndefined();
  });

  it('returns the face under the centre', () => {
    expect(resolvePick(block(13, faceBlock(13, 42)), 13, 6)).toEqual({ kind: 'face', id: 42 });
  });

  it('decodes all 24 bits of the id', () => {
    expect(resolvePick(block(3, [[1, 1, 'face', 0xabcdef]]), 3, 1)).toEqual({
      kind: 'face',
      id: 0xabcdef,
    });
  });

  it('prefers an edge within the radius over the face', () => {
    const px = block(13, [...faceBlock(13, 1), [6, 10, 'edge', 7]]);
    expect(resolvePick(px, 13, 6)).toEqual({ kind: 'edge', id: 7 });
  });

  it('ignores an edge outside the radius (corner of the square)', () => {
    const px = block(13, [...faceBlock(13, 1), [0, 0, 'edge', 7]]);
    expect(resolvePick(px, 13, 6)).toEqual({ kind: 'face', id: 1 });
  });

  it('prefers a vertex over a nearer edge', () => {
    const px = block(13, [
      [6, 6, 'edge', 3],
      [9, 6, 'vertex', 5],
    ]);
    expect(resolvePick(px, 13, 6)).toEqual({ kind: 'vertex', id: 5 });
  });

  it('takes the nearest of several edges', () => {
    const px = block(13, [
      [6, 1, 'edge', 3],
      [8, 6, 'edge', 4],
    ]);
    expect(resolvePick(px, 13, 6)).toEqual({ kind: 'edge', id: 4 });
  });

  it('finds an edge near the cursor even when the centre is background (silhouette)', () => {
    expect(resolvePick(block(13, [[6, 9, 'edge', 2]]), 13, 6)).toEqual({ kind: 'edge', id: 2 });
  });

  it('a smaller radius drops far edges', () => {
    const px = block(13, [...faceBlock(13, 1), [6, 10, 'edge', 7]]);
    expect(resolvePick(px, 13, 3)).toEqual({ kind: 'face', id: 1 });
  });
});
