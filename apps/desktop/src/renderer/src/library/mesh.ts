/**
 * Decodes a preview mesh out of `data/meshes.bin` (written by `scripts/library/generate_catalogue.py`).
 *
 * One block per class: `vertices × 3` int16 positions, padded to 4 bytes, then `triangles × 3` indices
 * (uint16, or uint32 when `wide`), padded to 4 bytes. A position is the real one, centred on the part's
 * bounding box and divided by half its largest side, times 32767: so the part fits in the unit cube and
 * `catalogue.preview.size` / `centre` give the way back to millimetres. Pure (Node-testable).
 */
import type { CatalogueMesh } from './catalogue.js';

export interface DecodedMesh {
  /** XYZ per vertex, the largest side of the part spanning −1 … 1. */
  readonly positions: Float32Array;
  /** Three vertex numbers per triangle. */
  readonly indices: Uint16Array | Uint32Array;
}

const roundUp4 = (n: number): number => n + ((4 - (n % 4)) % 4);

export function decodeMesh(buffer: ArrayBuffer, mesh: CatalogueMesh): DecodedMesh {
  const positionBytes = mesh.vertices * 3 * 2;
  const indexOffset = mesh.offset + roundUp4(positionBytes);
  const indexBytes = mesh.triangles * 3 * (mesh.wide ? 4 : 2);
  if (mesh.offset < 0 || mesh.offset % 4 !== 0 || indexOffset + indexBytes > buffer.byteLength) {
    throw new RangeError('A preview mesh lies outside the meshes file');
  }
  const quantised = new Int16Array(buffer, mesh.offset, mesh.vertices * 3);
  const positions = new Float32Array(quantised.length);
  for (let i = 0; i < quantised.length; i++) positions[i] = (quantised[i] ?? 0) / 32767;
  const indices = mesh.wide
    ? new Uint32Array(buffer, indexOffset, mesh.triangles * 3)
    : new Uint16Array(buffer, indexOffset, mesh.triangles * 3);
  const largest = mesh.vertices;
  for (const v of indices) {
    if (v >= largest) throw new RangeError('A preview mesh refers to a vertex that does not exist');
  }
  return { positions, indices };
}
