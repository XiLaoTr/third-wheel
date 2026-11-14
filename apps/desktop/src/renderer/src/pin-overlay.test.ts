import { describe, expect, it } from 'vitest';
import { stackIndices } from './pin-overlay.js';

describe('stackIndices', () => {
  it('counts earlier pins on the same anchor', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 4];
    expect(stackIndices([a, b, [...a], a])).toEqual([0, 0, 1, 2]);
  });
});
