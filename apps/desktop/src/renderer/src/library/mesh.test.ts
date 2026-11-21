import { describe, expect, it } from 'vitest';
import { decodeMesh } from './mesh.js';

/** A one-triangle block laid out like the generator does: int16 positions, padded to 4, then indices. */
function block(wide: boolean): {
  buffer: ArrayBuffer;
  mesh: { offset: number; vertices: number; triangles: number; wide: boolean };
} {
  const buffer = new ArrayBuffer(8 + 18 + 2 + 12);
  const view = new DataView(buffer);
  // 8 leading bytes belong to another class: the block starts at offset 8
  const positions = [32767, 0, 0, 0, 32767, 0, 0, 0, -32767];
  for (const [i, p] of positions.entries()) view.setInt16(8 + i * 2, p, true);
  // 18 bytes of positions + 2 padding → indices at 28
  for (const v of [0, 1, 2]) {
    if (wide) view.setUint32(28 + v * 4, v, true);
    else view.setUint16(28 + v * 2, v, true);
  }
  return { buffer, mesh: { offset: 8, vertices: 3, triangles: 1, wide } };
}

describe('decodeMesh', () => {
  it('turns quantised positions into −1 … 1', () => {
    const { buffer, mesh } = block(false);
    const m = decodeMesh(buffer, mesh);
    expect(Array.from(m.positions)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, -1]);
  });
  it('reads uint16 and uint32 indices', () => {
    const narrow = block(false);
    const wide = block(true);
    expect(decodeMesh(narrow.buffer, narrow.mesh).indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(decodeMesh(narrow.buffer, narrow.mesh).indices)).toEqual([0, 1, 2]);
    expect(decodeMesh(wide.buffer, wide.mesh).indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(decodeMesh(wide.buffer, wide.mesh).indices)).toEqual([0, 1, 2]);
  });
  it('refuses a block that lies outside the file', () => {
    const { buffer, mesh } = block(false);
    expect(() => decodeMesh(buffer, { ...mesh, triangles: 100 })).toThrow(RangeError);
    expect(() => decodeMesh(buffer, { ...mesh, offset: 6 })).toThrow(RangeError);
  });
  it('refuses an index past the last vertex', () => {
    const { buffer, mesh } = block(false);
    expect(() => decodeMesh(buffer, { ...mesh, vertices: 2 })).toThrow(/vertex/);
  });
});
