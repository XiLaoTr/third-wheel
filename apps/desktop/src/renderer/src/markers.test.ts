import { describe, expect, it, vi } from 'vitest';
import {
  cleanMarkerName,
  colorToHex,
  MARKER_COLORS,
  Markers,
  nextMarkerColor,
  nextMarkerName,
  normalizeColor,
  type Marker,
  shownEntities,
  type MarkerEdit,
} from './markers.js';

const marker = (name: string, color: string): Marker => ({
  id: name,
  name,
  color,
  visible: true,
  entities: [],
});

describe('helpers', () => {
  it('normalizes colours', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor(' #FF8A1F ')).toBe('#ff8a1f');
    expect(normalizeColor('red')).toBeUndefined();
    expect(normalizeColor('#12345')).toBeUndefined();
    expect(colorToHex('#ff8a1f')).toBe(0xff8a1f);
  });

  it('has 8 distinct palette colours', () => {
    expect(MARKER_COLORS).toHaveLength(8);
    expect(new Set(MARKER_COLORS.map((c) => c.hex)).size).toBe(8);
  });

  it('picks the first unused palette colour, then cycles', () => {
    expect(nextMarkerColor([])).toBe(MARKER_COLORS[0]?.hex);
    const first = MARKER_COLORS[0]?.hex ?? '';
    const third = MARKER_COLORS[2]?.hex ?? '';
    expect(nextMarkerColor([marker('a', first), marker('b', third)])).toBe(MARKER_COLORS[1]?.hex);
    const all = MARKER_COLORS.map((c) => marker(c.name, c.hex));
    expect(nextMarkerColor(all)).toBe(MARKER_COLORS[0]?.hex);
  });

  it('numbers new names above the highest "Marker N"', () => {
    expect(nextMarkerName([])).toBe('Marker 1');
    expect(nextMarkerName([marker('Marker 3', '#000000'), marker('Wall', '#000000')])).toBe(
      'Marker 4',
    );
  });

  it('cleans names', () => {
    expect(cleanMarkerName('  too   thin ')).toBe('too thin');
    expect(cleanMarkerName('   ')).toBeUndefined();
    expect(cleanMarkerName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('Markers', () => {
  it('starts with one active "Marker 1"', () => {
    const m = new Markers();
    expect(m.list().map((x) => x.name)).toEqual(['Marker 1']);
    expect(m.active()?.name).toBe('Marker 1');
    expect(m.active()?.color).toBe(MARKER_COLORS[0]?.hex);
  });

  it('add makes the new marker active and reports changes', () => {
    const m = new Markers();
    const onChange = vi.fn();
    m.onChange = onChange;
    const b = m.add();
    expect(b.name).toBe('Marker 2');
    expect(m.active()?.id).toBe(b.id);
    expect(onChange).toHaveBeenCalledWith(m.list(), b.id);
  });

  it('renames, recolours and hides; ignores no-ops and bad input', () => {
    const m = new Markers();
    const id = m.list()[0]?.id ?? '';
    const onChange = vi.fn();
    m.onChange = onChange;
    expect(m.rename(id, ' Too thin ')).toBe(true);
    expect(m.rename(id, '')).toBe(false);
    expect(m.rename(id, 'Too thin')).toBe(false);
    expect(m.setColor(id, '#00F')).toBe(true);
    expect(m.setColor(id, 'blue')).toBe(false);
    expect(m.setVisible(id, false)).toBe(true);
    expect(m.get(id)).toEqual({
      id,
      name: 'Too thin',
      color: '#0000ff',
      visible: false,
      entities: [],
    });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('add takes an optional name (T4.2)', () => {
    const m = new Markers();
    expect(m.add([], ' Comment 1 ').name).toBe('Comment 1');
    expect(m.add([], '   ').name).toBe('Marker 2');
  });

  it('ids stay unique after deletes', () => {
    const m = new Markers();
    const b = m.add();
    m.remove(b.id);
    expect(m.add().id).not.toBe(b.id);
  });

  it('removing the active marker activates the next, else the previous', () => {
    const m = new Markers();
    const [a] = m.list();
    const b = m.add();
    const c = m.add();
    m.setActive(b.id);
    m.remove(b.id);
    expect(m.active()?.id).toBe(c.id);
    m.remove(c.id);
    expect(m.active()?.id).toBe(a?.id);
    m.remove(a?.id ?? '');
    expect(m.list()).toEqual([]);
    expect(m.active()).toBeUndefined();
    expect(m.remove('nope')).toBe(false);
  });

  it('removing an inactive marker keeps the active one', () => {
    const m = new Markers();
    const [a] = m.list();
    const b = m.add();
    m.remove(a?.id ?? '');
    expect(m.active()?.id).toBe(b.id);
  });

  it('reset goes back to a single Marker 1', () => {
    const m = new Markers();
    m.add();
    m.rename(m.list()[0]?.id ?? '', 'Wall');
    m.reset();
    expect(m.list().map((x) => x.name)).toEqual(['Marker 1']);
    expect(m.active()?.id).toBe('m1');
  });

  it('reports undoable edits (not hide / activate / reset) and restores them (T3.5)', () => {
    const m = new Markers();
    const edits: MarkerEdit[] = [];
    m.onEdit = (e) => edits.push(e);
    const a = m.active();
    if (!a) throw new Error('no marker');
    const b = m.add();
    m.rename(a.id, 'Too thin');
    m.setColor(a.id, '#00ff00');
    m.setVisible(a.id, false);
    m.setActive(a.id);
    m.remove(a.id);
    expect(edits.map((e) => e.kind)).toEqual(['add', 'rename', 'color', 'remove']);
    expect(edits[2]?.live).toBe(false);
    m.setColor(b.id, '#123456', true);
    expect(edits[4]?.live).toBe(true);
    m.reset();
    expect(edits).toHaveLength(5);
  });

  it('restore keeps visibility, ids and (unless asked) the active marker', () => {
    const m = new Markers();
    const edits: MarkerEdit[] = [];
    m.onEdit = (e) => edits.push(e);
    const a = m.active();
    if (!a) throw new Error('no marker');
    const b = m.add(); // active = b
    m.rename(a.id, 'Old');
    m.setVisible(a.id, false);
    const [add, rename] = edits;
    if (!add || !rename) throw new Error('no edits');
    // Undo the rename: name back, a stays hidden, b stays active.
    m.restore(rename.before, false);
    expect(m.get(a.id)?.name).toBe('Marker 1');
    expect(m.get(a.id)?.visible).toBe(false);
    expect(m.active()?.id).toBe(b.id);
    // Undo the add (takeActive): b gone, a active again; the next add gets a new id.
    m.restore(add.before, true);
    expect(m.list().map((x) => x.id)).toEqual([a.id]);
    expect(m.active()?.id).toBe(a.id);
    expect(m.get(a.id)?.visible).toBe(false);
    expect(m.add().id).not.toBe(b.id);
  });
});

describe('marker entities (T3.7)', () => {
  const face = (id: number) => ({ kind: 'face' as const, id });
  const edge = (id: number) => ({ kind: 'edge' as const, id });

  it('adds new entities once, in order, and removes them', () => {
    const m = new Markers();
    const id = m.active()?.id ?? '';
    expect(m.addEntities(id, [face(3), edge(1), face(3)])).toBe(2);
    expect(m.addEntities(id, [face(3), face(4)])).toBe(1);
    expect(m.get(id)?.entities.map((e) => `${e.kind}${String(e.id)}`)).toEqual([
      'face3',
      'edge1',
      'face4',
    ]);
    expect(m.removeEntities(id, [face(3), face(99)])).toBe(1);
    expect(m.removeEntities(id, [face(99)])).toBe(0);
    expect(m.get(id)?.entities).toHaveLength(2);
    expect(m.addEntities('nope', [face(1)])).toBe(0);
  });

  it('new marker with entities is one edit; entity edits undo via restore', () => {
    const m = new Markers();
    const edits: MarkerEdit[] = [];
    m.onEdit = (e) => edits.push(e);
    const b = m.add([face(1), face(1), edge(2)]);
    expect(b.entities).toHaveLength(2);
    expect(edits.map((e) => e.kind)).toEqual(['add']);
    m.addEntities(b.id, [face(5)]);
    m.removeEntities(b.id, [face(1)]);
    expect(edits.map((e) => e.kind)).toEqual(['add', 'add-entities', 'remove-entities']);
    const [, added, removed] = edits;
    if (!added || !removed) throw new Error('edits missing');
    m.restore(removed.before, false);
    expect(m.get(b.id)?.entities).toHaveLength(3);
    m.restore(added.before, false);
    expect(m.get(b.id)?.entities).toHaveLength(2);
  });

  it('holding lists markers that contain any of the items', () => {
    const m = new Markers();
    const a = m.active()?.id ?? '';
    const b = m.add([edge(2)]).id;
    m.addEntities(a, [face(1)]);
    expect(m.holding([face(1)]).map((x) => x.id)).toEqual([a]);
    expect(m.holding([face(1), edge(2)]).map((x) => x.id)).toEqual([a, b]);
    expect(m.holding([face(9)])).toEqual([]);
  });

  it('colours an entity by the active marker, else the one it was added to last', () => {
    const m = new Markers();
    const a = m.active()?.id ?? '';
    const b = m.add().id; // b active
    m.addEntities(a, [face(1), face(2)]);
    m.addEntities(b, [face(1)]);
    m.addEntities(a, [face(3)]);
    const owner = (activeId: string | undefined) =>
      Object.fromEntries(
        shownEntities(m.list(), activeId).map((e) => [`${e.kind}${String(e.id)}`, e.markerId]),
      );
    expect(owner(b)).toEqual({ face1: b, face2: a, face3: a });
    expect(owner(a)).toEqual({ face1: a, face2: a, face3: a });
    expect(owner(undefined)).toEqual({ face1: b, face2: a, face3: a });
    m.setVisible(b, false); // hidden marker shows nothing; a still shows face 1
    expect(owner(b)).toEqual({ face1: a, face2: a, face3: a });
    m.setVisible(a, false);
    expect(shownEntities(m.list(), b)).toEqual([]);
  });
});
