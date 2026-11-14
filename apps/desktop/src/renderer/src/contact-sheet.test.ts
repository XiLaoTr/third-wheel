import { describe, expect, it } from 'vitest';
import {
  composeSheet,
  DIVIDER,
  MAX_SHEET_REGIONS,
  SHEET_WIDTH,
  sheetLayout,
} from './contact-sheet.js';

describe('sheetLayout', () => {
  it('one region fills the whole sheet', () => {
    expect(sheetLayout(1)).toEqual({ width: 768, height: 768, tile: 768, tiles: [{ x: 0, y: 0 }] });
  });
  it('two regions side by side, half height', () => {
    const l = sheetLayout(2);
    expect([l.width, l.height, l.tile]).toEqual([768, 384, 384]);
    expect(l.tiles).toEqual([
      { x: 0, y: 0 },
      { x: 384, y: 0 },
    ]);
  });
  it('three and four regions in a 2 × 2 grid, row by row', () => {
    expect(sheetLayout(3).height).toBe(SHEET_WIDTH);
    expect(sheetLayout(3).tiles).toHaveLength(3);
    expect(sheetLayout(4).tiles).toEqual([
      { x: 0, y: 0 },
      { x: 384, y: 0 },
      { x: 0, y: 384 },
      { x: 384, y: 384 },
    ]);
  });
  it('refuses 0, more than 4 and fractions', () => {
    for (const n of [0, MAX_SHEET_REGIONS + 1, 1.5]) expect(() => sheetLayout(n)).toThrow();
  });
});

describe('composeSheet', () => {
  const tile = (size: number, rgb: [number, number, number]): Uint8Array => {
    const out = new Uint8Array(size * size * 4);
    for (let i = 0; i < out.length; i += 4) out.set([...rgb, 255], i);
    return out;
  };
  const at = (img: Uint8Array, width: number, x: number, y: number): number[] => [
    ...img.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
  ];

  it('copies tiles to their place and draws dividers between them', () => {
    const l = sheetLayout(3);
    const img = composeSheet(l, [
      tile(384, [255, 0, 0]),
      tile(384, [0, 255, 0]),
      tile(384, [0, 0, 255]),
    ]);
    expect(img.length).toBe(768 * 768 * 4);
    expect(at(img, 768, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(at(img, 768, 700, 10)).toEqual([0, 255, 0, 255]);
    expect(at(img, 768, 10, 700)).toEqual([0, 0, 255, 255]);
    expect(at(img, 768, 700, 700)).toEqual([255, 255, 255, 255]); // empty 4th slot: white
    expect(at(img, 768, 384, 100)).toEqual([...DIVIDER.rgb, 255]);
    expect(at(img, 768, 383, 100)).toEqual([...DIVIDER.rgb, 255]);
    expect(at(img, 768, 100, 384)).toEqual([...DIVIDER.rgb, 255]);
    expect(at(img, 768, 382, 100)).toEqual([255, 0, 0, 255]);
  });

  it('keeps row order (top row of a tile stays on top)', () => {
    const l = sheetLayout(1);
    const pic = tile(768, [0, 0, 0]);
    pic.set([9, 9, 9, 255], 0); // top-left pixel
    const img = composeSheet(l, [pic]);
    expect(at(img, 768, 0, 0)).toEqual([9, 9, 9, 255]);
    expect(at(img, 768, 384, 100)).toEqual([0, 0, 0, 255]); // no divider with one tile
  });

  it('refuses a tile of the wrong size', () => {
    expect(() => composeSheet(sheetLayout(2), [tile(100, [0, 0, 0])])).toThrow(/Tile 1/);
  });
});
