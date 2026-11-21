import { describe, expect, it } from 'vitest';
import {
  allClassNames,
  formatParams,
  formatParts,
  formatSize,
  humanizeClassName,
  parseCatalogue,
  searchClasses,
  type Catalogue,
} from './catalogue.js';

const mesh = { offset: 0, vertices: 3, triangles: 1, wide: false } as const;
const preview = {
  params: { size: 'M6-1' },
  size: [10, 10, 26],
  centre: [0, 0, 8],
  solids: 1,
  parts: {},
  mesh,
} as const;

const catalogue: Catalogue = {
  format: 1,
  library: 'bd_warehouse',
  libraryVersion: '0.4.0',
  generated: '2026-11-21',
  modules: [
    {
      id: 'fastener',
      label: 'Fasteners',
      groups: [
        { name: 'Screws', operation: false, classes: ['SocketHeadCapScrew'] },
        { name: 'Hole tools', operation: true, classes: ['ClearanceHole'] },
      ],
    },
    {
      id: 'o_rings',
      label: 'O-rings',
      groups: [{ name: 'O-rings', operation: false, classes: ['ORing'] }],
    },
  ],
  classes: {
    SocketHeadCapScrew: {
      module: 'fastener',
      group: 'Screws',
      operation: false,
      keywords: 'screw bolt 螺絲 內六角',
      preview,
    },
    ClearanceHole: {
      module: 'fastener',
      group: 'Hole tools',
      operation: true,
      keywords: 'hole clearance 孔',
    },
    ORing: { module: 'o_rings', group: 'O-rings', operation: false, keywords: 'seal 密封 防水' },
  },
};

describe('humanizeClassName', () => {
  it('splits camel case into words', () => {
    expect(humanizeClassName('SocketHeadCapScrew')).toBe('Socket Head Cap Screw');
    expect(humanizeClassName('SingleRowDeepGrooveBallBearing')).toBe(
      'Single Row Deep Groove Ball Bearing',
    );
  });
  it('keeps leading capitals together as a word', () => {
    expect(humanizeClassName('ORing')).toBe('O Ring');
    expect(humanizeClassName('TNut')).toBe('T Nut');
    expect(humanizeClassName('VSlotLinearRail')).toBe('V Slot Linear Rail');
    expect(humanizeClassName('BSPPThread')).toBe('BSPP Thread');
    expect(humanizeClassName('CBeamAssembly')).toBe('C Beam Assembly');
  });
});

describe('allClassNames', () => {
  it('lists classes in module, group, class order', () => {
    expect(allClassNames(catalogue)).toEqual(['SocketHeadCapScrew', 'ClearanceHole', 'ORing']);
  });
});

describe('searchClasses', () => {
  it('matches everything for an empty search', () => {
    expect(searchClasses(catalogue, '  ')).toHaveLength(3);
  });
  it('finds by class name, ignoring case and word breaks', () => {
    expect(searchClasses(catalogue, 'socket head')).toEqual(['SocketHeadCapScrew']);
    expect(searchClasses(catalogue, 'o ring')).toEqual(['ORing']);
  });
  it('finds by keyword, English or Chinese', () => {
    expect(searchClasses(catalogue, 'seal')).toEqual(['ORing']);
    expect(searchClasses(catalogue, '螺絲')).toEqual(['SocketHeadCapScrew']);
  });
  it('finds by group and module', () => {
    expect(searchClasses(catalogue, 'hole tools')).toEqual(['ClearanceHole']);
    expect(searchClasses(catalogue, 'fasteners')).toEqual(['SocketHeadCapScrew', 'ClearanceHole']);
  });
  it('needs every word to match', () => {
    expect(searchClasses(catalogue, 'screw seal')).toEqual([]);
  });
});

describe('formatting', () => {
  it('writes sizes without noise', () => {
    expect(formatSize([22, 22, 7])).toBe('22 × 22 × 7 mm');
    expect(formatSize([10.2200001, 10.2, 26])).toBe('10.22 × 10.2 × 26 mm');
  });
  it('writes the parameters a preview was built with', () => {
    expect(formatParams({ size: 'M6-1', length: 20, simple: true, fastener_type: 'iso4762' })).toBe(
      'size M6-1, length 20, simple, fastener type iso4762',
    );
    expect(formatParams({ simple: false })).toBe('not simple');
  });
  it('writes sub-part counts', () => {
    expect(formatParts({ OuterRace: 1, Roller: 12 })).toBe('OuterRace ×1, Roller ×12');
    expect(formatParts({})).toBe('');
  });
});

describe('parseCatalogue', () => {
  it('accepts the expected shape', () => {
    expect(parseCatalogue(JSON.parse(JSON.stringify(catalogue))).library).toBe('bd_warehouse');
  });
  it('refuses another format or a damaged file', () => {
    expect(() => parseCatalogue(null)).toThrow();
    expect(() => parseCatalogue({ ...catalogue, format: 2 })).toThrow(/format/);
    expect(() => parseCatalogue({ format: 1, library: 'x', libraryVersion: '1' })).toThrow(
      /no modules/,
    );
  });
});
