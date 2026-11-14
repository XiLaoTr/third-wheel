import { describe, expect, it } from 'vitest';
import { bodyDisplayNames } from './part-names.js';

const part = (name: string) => ({ name, path: [], assembly: -1 });

describe('bodyDisplayNames', () => {
  it('uses part names and numbers duplicates', () => {
    expect(
      bodyDisplayNames([part('Fan'), part('M3 screw'), part('Duct'), part('M3 screw')], 4, false),
    ).toEqual(['Fan', 'M3 screw [1]', 'Duct', 'M3 screw [2]']);
  });

  it('falls back to "Body N" for unnamed parts and when names are unknown', () => {
    expect(bodyDisplayNames([part(''), part('  '), part('Fan')], 3, false)).toEqual([
      'Body 1',
      'Body 2',
      'Fan',
    ]);
    expect(bodyDisplayNames(null, 2, false)).toEqual(['Body 1', 'Body 2']);
  });

  it('names the loose body', () => {
    expect(bodyDisplayNames([part('Fan')], 2, true)).toEqual(['Fan', 'Loose surfaces']);
    expect(bodyDisplayNames(null, 1, true)).toEqual(['Loose surfaces']);
  });
});
