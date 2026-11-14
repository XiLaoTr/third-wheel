import { describe, expect, it } from 'vitest';
import { annotationsSchema, MAX_VERSION_LINKS, type VersionLink } from './schema.js';
import {
  chainAfter,
  confirmsParent,
  editChain,
  makesCircle,
  relocated,
  removalPlan,
  walkEarlier,
  type ChainEdit,
  type ChainRead,
} from './version-chain.js';

const hash = (c: string): string => `sha256:${c.repeat(64)}`;
const link = (name: string, c: string, more: Partial<VersionLink> = {}): VersionLink => ({
  path: `/m/${name}`,
  name,
  contentHash: hash(c),
  date: '2026-11-09T14:02:00.000Z',
  ...more,
});

describe('chainAfter', () => {
  it('puts the earlier version first, then what it came from', () => {
    const a = link('a.step', 'a');
    const b = link('b.step', 'b');
    const c = link('c.step', 'c');
    expect(chainAfter({ earlier: [a], newer: [c] }, b)).toEqual({ earlier: [b, a] });
  });

  it('one parent: the new file’s own earlier versions are dropped, its newer kept (T13.4)', () => {
    const a = link('a.step', 'a');
    const b = link('b.step', 'b');
    const own = link('x.step', 'x');
    const newer = link('n.step', 'n');
    expect(chainAfter({ earlier: [a] }, b, { earlier: [own, a], newer: [newer] })).toEqual({
      earlier: [b, a],
      newer: [newer],
    });
  });

  it('never lists the file itself as earlier, and drops an unlinked mark (T13.4)', () => {
    const a = link('a.step', 'a');
    const c = link('c.step', 'c');
    // C shown with A as parent; A (cached in C's chain) imported onto C must not list itself.
    expect(chainAfter({ earlier: [a] }, c, { unlinked: '2026-11-11T10:00:00.000Z' }, a)).toEqual({
      earlier: [c],
    });
  });

  it('a file overwritten in place keeps its newer versions', () => {
    const old = link('a.step', 'a', { overwritten: true });
    const n = link('n.step', 'n');
    expect(chainAfter({ newer: [n] }, old)).toEqual({ earlier: [old], newer: [n] });
  });

  it('keeps at most MAX_VERSION_LINKS', () => {
    const many = Array.from({ length: MAX_VERSION_LINKS + 5 }, (_, i) =>
      link(`p${String(i)}.step`, 'a'),
    );
    expect(chainAfter({ earlier: many }, link('b.step', 'b')).earlier).toHaveLength(
      MAX_VERSION_LINKS,
    );
  });
});

describe('relocated', () => {
  it('moves a located link to its new place', () => {
    const a = link('a.step', 'a');
    const moved = relocated({ earlier: [a] }, a, { path: '/n/a2.step', name: 'a2.step' });
    expect(moved.earlier?.[0]).toMatchObject({ path: '/n/a2.step', name: 'a2.step' });
  });
});

describe('versions in the sidecar', () => {
  const doc = {
    schemaVersion: 1,
    model: { fileName: 'b.step', format: 'step', contentHash: hash('b') },
    tessellation: { linearDeflection: 0.1, angularDeflection: 0.5 },
    markers: [],
    comments: [],
  };

  it('reads a chain', () => {
    const versions = { earlier: [link('a.step', 'a', { overwritten: true })] };
    expect(annotationsSchema.parse({ ...doc, versions }).versions).toEqual(versions);
  });

  it('drops a malformed chain, never the file', () => {
    const parsed = annotationsSchema.parse({ ...doc, versions: { earlier: [{ path: 3 }] } });
    expect(parsed.versions).toBeUndefined();
  });
});

describe('walkEarlier (T13.4)', () => {
  const a = link('a.step', 'a');
  const b = link('b.step', 'b');
  const c = link('c.step', 'c');
  const d = link('d.step', 'd');
  const reader =
    (notes: Record<string, ChainRead>) =>
    (l: VersionLink): Promise<ChainRead> =>
      Promise.resolve(notes[l.name]);

  it('follows each parent; a stale cache is ignored where notes can be read', async () => {
    // D was made from C (cache: C, B, A); B was removed since: C's parent is now A.
    const line = await walkEarlier(
      [c, b, a],
      reader({ 'c.step': { chain: { earlier: [a] } }, 'a.step': { chain: undefined } }),
    );
    expect(line.map((l) => l.name)).toEqual(['c.step', 'a.step']);
  });

  it('uses the cache where a version can’t be read (moved, overwritten)', async () => {
    const line = await walkEarlier([c, b, a], reader({}));
    expect(line.map((l) => l.name)).toEqual(['c.step', 'b.step', 'a.step']);
  });

  it('leaves out a version marked unlinked (its newer file couldn’t be updated)', async () => {
    const line = await walkEarlier(
      [b, a],
      reader({
        'b.step': { chain: { unlinked: '2026-11-11T10:00:00.000Z' } },
        'a.step': { chain: undefined },
      }),
    );
    expect(line.map((l) => l.name)).toEqual(['a.step']);
  });

  it('stops on a circle on disk and at the shown file', async () => {
    // A says its parent is B, B says A: visited once each, then the walk ends.
    const loop = await walkEarlier(
      [a],
      reader({ 'a.step': { chain: { earlier: [b] } }, 'b.step': { chain: { earlier: [a] } } }),
    );
    expect(loop.map((l) => l.name)).toEqual(['a.step', 'b.step']);
    const self = await walkEarlier([c], reader({ 'c.step': { chain: { earlier: [d, a] } } }), d);
    expect(self.map((l) => l.name)).toEqual(['c.step']);
  });

  it('a long chain ends after the limit', async () => {
    const many = Array.from({ length: 500 }, (_, i) => link(`p${String(i)}.step`, 'a'));
    const notes: Record<string, ChainRead> = {};
    many.forEach((l, i) => {
      const next = many[i + 1];
      notes[l.name] = { chain: next ? { earlier: [next] } : undefined };
    });
    expect(await walkEarlier([many[0] as VersionLink], reader(notes))).toHaveLength(
      MAX_VERSION_LINKS,
    );
  });

  it('never reads overwritten contents (their path holds another version’s notes)', async () => {
    const old = link('a.step', 'o', { overwritten: true });
    let reads = 0;
    const line = await walkEarlier([old, b], (l) => {
      reads++;
      return Promise.resolve(l.name === 'b.step' ? { chain: undefined } : undefined);
    });
    expect(line.map((l) => l.contentHash)).toEqual([hash('o'), hash('b')]);
    expect(reads).toBe(1);
  });
});

describe('confirmsParent (T13.4)', () => {
  const a = link('a.step', 'a');
  const b = link('b.step', 'b');
  it('a signpost counts only when the newer file names this one first', () => {
    expect(confirmsParent({ earlier: [a] }, a)).toBe(true);
    expect(confirmsParent({ earlier: [b, a] }, a)).toBe(false); // moved to B
    expect(confirmsParent(undefined, a)).toBe(false);
  });
  it('… or earlier contents of the same path this one replaced', () => {
    const old = link('a.step', 'o', { overwritten: true });
    const now = { path: '/m/a.step', contentHash: hash('n'), chain: { earlier: [old] } };
    expect(confirmsParent({ earlier: [link('a.step', 'o')] }, now)).toBe(true);
    expect(confirmsParent({ earlier: [link('a.step', 'x')] }, now)).toBe(false);
  });
});

const edit = (plan: readonly { edit: ChainEdit }[], i: number): ChainEdit => {
  const step = plan[i];
  if (!step) throw new Error(`no step ${String(i)}`);
  return step.edit;
};

describe('removalPlan + editChain (T13.4)', () => {
  const a = link('a.step', 'a');
  const b = link('b.step', 'b');
  const c = link('c.step', 'c');
  const d = link('d.step', 'd');
  const date = '2026-11-11T10:00:00.000Z';

  it('middle version: children re-pointed first, then the parent, then the mark', () => {
    const plan = removalPlan({ removed: b, parent: a, children: [c], date });
    expect(plan.map((e) => e.name)).toEqual(['c.step', 'a.step', 'b.step']);
    const [toC, toA, toB] = plan.map((e) => e.edit);
    if (!toC || !toA || !toB) throw new Error('three edits expected');
    expect(editChain({ earlier: [b, a], newer: [d] }, toC)).toEqual({ earlier: [a], newer: [d] });
    expect(editChain({ newer: [b] }, toA)).toEqual({ newer: [c] });
    expect(editChain({ earlier: [a], newer: [c] }, toB)).toEqual({ unlinked: date });
  });

  it('first version: the child keeps no parent; last version: only the parent changes', () => {
    const first = removalPlan({ removed: a, parent: undefined, children: [b], date });
    expect(first.map((e) => e.name)).toEqual(['b.step', 'a.step']);
    expect(editChain({ earlier: [a] }, edit(first, 0))).toBeUndefined();
    const last = removalPlan({ removed: c, parent: b, children: [], date });
    expect(last.map((e) => e.name)).toEqual(['b.step', 'c.step']);
    expect(editChain({ earlier: [a], newer: [c] }, edit(last, 0))).toEqual({ earlier: [a] });
  });

  it('two children (variants) both move to the parent', () => {
    const plan = removalPlan({ removed: b, parent: a, children: [c, d, c], date });
    expect(plan.map((e) => e.name)).toEqual(['c.step', 'd.step', 'a.step', 'b.step']);
    expect(editChain({ newer: [b] }, edit(plan, 2))).toEqual({ newer: [c, d] });
  });

  it('overwritten contents get no edit of their own', () => {
    const old = link('a.step', 'o', { overwritten: true });
    const plan = removalPlan({ removed: old, parent: undefined, children: [b], date });
    expect(plan.map((e) => e.name)).toEqual(['b.step']);
  });

  it('removed from A behind a moved B: C is fixed from its own menu (T13.5)', async () => {
    // A → B → C; B was moved, so A's Remove couldn't reach C, and B's mark couldn't be written.
    const notes: Record<string, ChainRead> = { 'a.step': { chain: { newer: [] } } };
    const read = (l: VersionLink): Promise<ChainRead> => Promise.resolve(notes[l.name]);
    // C's menu: B still shown (unreadable → from C's cache), then A.
    const line = await walkEarlier([b, a], read);
    expect(line.map((l) => l.name)).toEqual(['b.step', 'a.step']);
    // Remove B there: parent = the next row (A), child = C itself.
    const plan = removalPlan({ removed: b, parent: line[1], children: [c], date });
    expect(editChain({ earlier: [b, a] }, edit(plan, 0))).toEqual({ earlier: [a] });
    expect(editChain({ newer: [] }, edit(plan, 1))).toEqual({ newer: [c] });
    expect(confirmsParent({ earlier: [a] }, { ...a, chain: { newer: [c] } })).toBe(true);
  });

  it('re-linking clears the mark; a cleared chain keeps the mark only', () => {
    expect(editChain({ unlinked: date }, { addNewer: [c], unlinked: null })).toEqual({
      newer: [c],
    });
    expect(editChain({ earlier: [a] }, { clear: true })).toBeUndefined();
  });
});

describe('makesCircle (T13.4)', () => {
  it('a file can’t become newer than one of its own newer versions', () => {
    const a = link('a.step', 'a');
    const c = link('c.step', 'c');
    expect(makesCircle(a, [c, link('b.step', 'b'), a])).toBe(true);
    expect(makesCircle(link('d.step', 'd'), [c, a])).toBe(false);
    // Same path, other contents (overwritten since): not the same version.
    expect(makesCircle(link('a.step', 'z'), [c, a])).toBe(false);
  });
});
