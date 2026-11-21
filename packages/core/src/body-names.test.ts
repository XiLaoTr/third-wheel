import { describe, expect, it } from 'vitest';
import {
  baseBodyName,
  customBodyNames,
  lostBodyNames,
  lostBodyNamesWarning,
} from './body-names.js';

describe('body names', () => {
  it('strips the number the app adds to repeats', () => {
    expect(baseBodyName('Roller [12]')).toBe('Roller');
    expect(baseBodyName('Nut M5-0.8 (Hole 1)')).toBe('Nut M5-0.8 (Hole 1)');
  });

  it('keeps only names a person gave', () => {
    expect(
      customBodyNames([
        'SOLID [1]',
        'SOLID',
        'COMPOUND',
        '=>[0:1:1:2]',
        'Screw M5-0.8x16 (Hole 1)',
        'Screw M5-0.8x16 (Hole 1)',
        'Bracket',
      ]),
    ).toEqual(['Screw M5-0.8x16 (Hole 1)', 'Bracket']);
  });

  it('warns when the custom names of the previous version are gone', () => {
    const before = [
      'SOLID [1]',
      'SOLID [2]',
      'Screw M5 (Hole 1)',
      'Nut M5 (Hole 1)',
      'Revision_test',
    ];
    expect(lostBodyNames(before, ['=>[0:1:1:2]', '=>[0:1:1:3]', 'SOLID'])).toEqual([
      'Screw M5 (Hole 1)',
      'Nut M5 (Hole 1)',
      'Revision_test',
    ]);
  });

  it('stays quiet when names survive, when a minority changed, or when none were custom', () => {
    const before = ['Bracket', 'Pin', 'Lid'];
    expect(lostBodyNames(before, ['Bracket', 'Pin', 'Lid', 'Screw'])).toBeUndefined();
    expect(lostBodyNames(before, ['Bracket', 'Pin', 'Lid renamed'])).toBeUndefined();
    expect(lostBodyNames(['SOLID', 'SOLID'], ['SOLID'])).toBeUndefined();
    expect(lostBodyNames([], ['Anything'])).toBeUndefined();
  });

  it('says what to do', () => {
    const text = lostBodyNamesWarning(['A', 'B', 'C', 'D', 'E'], 6);
    expect(text).toContain('5 of the 6 named bodies');
    expect(text).toContain('"A", "B", "C", "D", …');
    expect(text).toContain('.label');
    expect(text).toContain('revisionOf');
  });
});
