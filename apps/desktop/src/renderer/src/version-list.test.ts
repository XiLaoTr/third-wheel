import type { VersionLink } from '@third-wheel/core';
import { describe, expect, it } from 'vitest';
import { versionDetail, versionLabel, versionRows } from './version-list.js';

const hash = (c: string): string => `sha256:${c.repeat(64)}`;
const link = (name: string, c: string, more: Partial<VersionLink> = {}): VersionLink => ({
  path: `/m/${name}`,
  name,
  contentHash: hash(c),
  date: '2026-11-09T14:02:00.000Z',
  ...more,
});

describe('versionRows', () => {
  const shown = { path: '/m/widget8.step', name: 'widget8.step' };

  it('lists newer versions, the shown file, then earlier ones — by link, not by name', () => {
    const chain = {
      newer: [link('toy_demo.step', 'c')],
      earlier: [link('part v10.step', 'b'), link('first.step', 'a')],
    };
    const states = new Map([
      ['/m/toy_demo.step', hash('c')],
      ['/m/part v10.step', hash('b')],
      ['/m/first.step', hash('a')],
    ]);
    const rows = versionRows(shown, chain, states, [link('final.step', 'd')]);
    expect(rows.map((r) => [r.name, r.state, r.own])).toEqual([
      ['final.step', 'missing', false],
      ['toy_demo.step', 'found', true],
      ['widget8.step', 'shown', true],
      ['part v10.step', 'found', true],
      ['first.step', 'found', true],
    ]);
  });

  it('tells missing, changed and overwritten files apart', () => {
    const chain = {
      earlier: [
        link('widget8.step', 'b', { overwritten: true }),
        link('moved.step', 'c'),
        link('replaced.step', 'd'),
      ],
    };
    const states = new Map<string, string | null>([
      ['/m/widget8.step', hash('e')],
      ['/m/moved.step', null],
      ['/m/replaced.step', hash('f')],
    ]);
    const rows = versionRows(shown, chain, states);
    expect(rows.map((r) => r.state)).toEqual(['shown', 'overwritten', 'missing', 'changed']);
    expect(rows.map((r) => versionDetail(r))).toEqual([
      'shown',
      'overwritten',
      'not found',
      'file changed since',
    ]);
    expect(rows[1] && versionLabel(rows[1])).toBe('earlier contents of widget8.step');
  });

  it('lists a file and its contents once', () => {
    const l = link('a.step', 'a');
    const rows = versionRows(shown, { newer: [l], earlier: [l] }, new Map(), [l]);
    expect(rows.map((r) => r.state)).toEqual(['missing', 'shown']);
  });

  it('shows the link date for a found version', () => {
    const [, row] = versionRows(
      shown,
      { earlier: [link('a.step', 'a')] },
      new Map([['/m/a.step', hash('a')]]),
    );
    expect(row && versionDetail(row, 'en-GB')).toMatch(/9 Nov/);
  });
});
