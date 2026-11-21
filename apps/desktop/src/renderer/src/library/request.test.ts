import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  clampCopies,
  describePart,
  needsMode,
  newDraftItem,
  DEFAULT_REQUEST_TEXT,
} from './request.js';

const lib = { name: 'bd_warehouse', version: '0.4.0' };
const all = (): boolean => true;

describe('buildRequest', () => {
  it('has nothing to send without items', () => {
    expect(buildRequest([], 'x', lib, all)).toBeUndefined();
  });

  it('builds parts with ids, source, copies, targets and notes', () => {
    const r = buildRequest(
      [
        {
          ...newDraftItem('SocketHeadCapScrew'),
          params: { size: 'M5-0.8', length: 16 },
          copies: 2,
          markerIds: ['m1', 'm2'],
          note: ' M5, 16 mm ',
        },
        { ...newDraftItem('HexNut'), copies: 4, markerIds: ['m2'], mode: 'pattern' },
      ],
      '  Fasten here  ',
      lib,
      all,
    );
    expect(r?.text).toBe('Fasten here');
    expect(r?.markerIds).toEqual(['m1', 'm2']);
    expect(r?.parts[0]).toEqual({
      id: 'p1',
      source: {
        kind: 'library',
        library: 'bd_warehouse',
        version: '0.4.0',
        cls: 'SocketHeadCapScrew',
        params: { size: 'M5-0.8', length: 16 },
      },
      copies: 2,
      scope: 'whole',
      target: { markerIds: ['m1', 'm2'] },
      note: 'M5, 16 mm',
    });
    expect(r?.parts[1]?.id).toBe('p2');
    expect(r?.parts[1]?.target).toEqual({ markerIds: ['m2'], mode: 'pattern' });
  });

  it('uses sub-parts as the scope and leaves the target out without markers', () => {
    const r = buildRequest(
      [{ ...newDraftItem('SingleRowDeepGrooveBallBearing'), subparts: ['Roller'] }],
      '',
      lib,
      all,
    );
    expect(r?.text).toBe(DEFAULT_REQUEST_TEXT);
    expect(r?.parts[0]?.scope).toEqual({ subparts: ['Roller'] });
    expect(r?.parts[0]?.target).toBeUndefined();
  });

  it('leaves out markers that no longer exist', () => {
    const r = buildRequest(
      [{ ...newDraftItem('HexNut'), markerIds: ['m1', 'gone'] }],
      'x',
      lib,
      (id) => id !== 'gone',
    );
    expect(r?.markerIds).toEqual(['m1']);
    expect(r?.parts[0]?.target?.markerIds).toEqual(['m1']);
  });
});

describe('clampCopies', () => {
  it('keeps a whole number from 1 to 999', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(2.6)).toBe(3);
    expect(clampCopies(5000)).toBe(999);
    expect(clampCopies(Number.NaN)).toBe(1);
  });
});

describe('describePart', () => {
  it('writes the part, copies and markers', () => {
    const r = buildRequest(
      [{ ...newDraftItem('HexNut'), copies: 2, markerIds: ['m1'] }],
      'x',
      lib,
      all,
    );
    const p = r?.parts[0];
    if (!p) throw new Error('no part');
    expect(
      describePart(
        p,
        (c) => c.toUpperCase(),
        () => 'Hole 1',
      ),
    ).toBe('HEXNUT ×2 → Hole 1');
  });
});

describe('pattern mode', () => {
  it('only means something with several markers or several copies', () => {
    expect(needsMode(1, 1)).toBe(false);
    expect(needsMode(2, 1)).toBe(true);
    expect(needsMode(1, 2)).toBe(true);
  });

  it('is not saved for one part at one marker, even if it was chosen earlier', () => {
    const one = buildRequest(
      [{ ...newDraftItem('VSlotLinearRail'), markerIds: ['m1'], mode: 'pattern' }],
      'x',
      lib,
      all,
    );
    expect(one?.parts[0]?.target).toEqual({ markerIds: ['m1'] });
    const many = buildRequest(
      [{ ...newDraftItem('HexNut'), copies: 4, markerIds: ['m1'], mode: 'pattern' }],
      'x',
      lib,
      all,
    );
    expect(many?.parts[0]?.target).toEqual({ markerIds: ['m1'], mode: 'pattern' });
  });
});
