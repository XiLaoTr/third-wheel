import { describe, expect, it } from 'vitest';
import { BodyFolders, type FolderEdit } from './body-folders.js';
import { buildBodyTree, type TreeNode } from './body-tree.js';

/** Compact text form: folders as "Name(…)", bodies as their id. */
function show(nodes: readonly TreeNode[]): string {
  return nodes
    .map((n) => (n.kind === 'body' ? String(n.body) : `${n.name}(${show(n.children)})`))
    .join(' ');
}

// Root "Printer" (unwrapped) › { Fans › {0, 1}, 2, Screws › {3, 4} }.
const stepTree = (): TreeNode[] =>
  buildBodyTree(
    5,
    [
      { name: 'Printer', parent: -1 },
      { name: 'Fans', parent: 0 },
      { name: 'Screws', parent: 0 },
    ],
    [1, 1, 0, 2, 2],
  );

function setup(): { f: BodyFolders; edits: FolderEdit[] } {
  const f = new BodyFolders();
  f.reset(stepTree());
  const edits: FolderEdit[] = [];
  f.onEdit = (e) => edits.push(e);
  return { f, edits };
}

describe('BodyFolders', () => {
  it('shows the STEP tree while nothing changed', () => {
    const { f } = setup();
    expect(show(f.tree())).toBe('Fans(0 1) 2 Screws(3 4)');
    expect(f.isEmpty).toBe(true);
    expect(f.data()).toBeUndefined();
  });

  it('makes a folder with the given rows, user folders first', () => {
    const { f, edits } = setup();
    const id = f.newFolder('top', ['b2', 'b3']);
    expect(id).toBe('n1');
    expect(show(f.tree())).toBe('Folder 1(2 3) Fans(0 1) Screws(4)');
    expect(edits.map((e) => e.kind)).toEqual(['new-folder']);
    const folder = f.tree()[0];
    expect(folder?.kind === 'folder' && folder.bodies).toEqual([2, 3]);
    expect(folder?.kind === 'folder' && folder.key).toBe('un1');
    expect(f.nextFolderName()).toBe('Folder 2');
  });

  it('moves bodies and STEP folders anywhere; moving back home leaves no entry', () => {
    const { f } = setup();
    expect(f.move(['b0'], 'top')).toBe(1);
    expect(f.move(['f2'], { assembly: 1 })).toBe(1);
    expect(show(f.tree())).toBe('Fans(1 Screws(3 4)) 0 2');
    expect(f.data()).toEqual({
      folders: [],
      bodies: [{ body: 0, parent: 'top' }],
      assemblies: [{ assembly: 2, parent: { assembly: 1 } }],
    });
    f.move(['b0'], { assembly: 1 });
    f.move(['f2'], 'top');
    expect(f.isEmpty).toBe(true);
  });

  it('never puts a folder inside itself', () => {
    const { f } = setup();
    const outer = f.newFolder('top', ['f1']) ?? '';
    const inner = f.newFolder({ folder: outer }) ?? '';
    expect(f.canMove(`u${outer}`, { folder: inner })).toBe(false);
    expect(f.canMove(`u${outer}`, { folder: outer })).toBe(false);
    expect(f.canMove('f1', { assembly: 1 })).toBe(false);
    expect(f.move([`u${outer}`], { folder: inner })).toBe(0);
    expect(show(f.tree())).toBe('Folder 1(Folder 2() Fans(0 1)) 2 Screws(3 4)');
  });

  it('delete moves the contents to the folder parent', () => {
    const { f } = setup();
    const a = f.newFolder({ assembly: 2 }, ['b0']) ?? '';
    f.newFolder({ folder: a }, ['b2']);
    expect(show(f.tree())).toBe('Fans(1) Screws(Folder 1(Folder 2(2) 0) 3 4)');
    expect(f.deleteFolder(a)).toBe(true);
    expect(show(f.tree())).toBe('Fans(1) Screws(Folder 2(2) 0 3 4)');
  });

  it('renames user folders (trimmed, not empty, not unchanged)', () => {
    const { f, edits } = setup();
    const id = f.newFolder('top') ?? '';
    expect(f.rename(id, '  Bolts ')).toBe(true);
    expect(f.rename(id, 'Bolts')).toBe(false);
    expect(f.rename(id, '   ')).toBe(false);
    expect(f.folder(id)?.name).toBe('Bolts');
    expect(edits.map((e) => e.kind)).toEqual(['new-folder', 'rename-folder']);
  });

  it('undo snapshots restore the arrangement', () => {
    const { f, edits } = setup();
    f.newFolder('top', ['b0', 'b1']);
    f.move(['b4'], 'top');
    const shown = show(f.tree());
    f.restore(edits[0]?.before ?? f.state());
    expect(show(f.tree())).toBe('Fans(0 1) 2 Screws(3 4)');
    f.restore(edits[1]?.after ?? f.state());
    expect(show(f.tree())).toBe(shown);
  });

  it('round-trips through data() / load()', () => {
    const { f } = setup();
    const id = f.newFolder('top', ['b2', 'f2'], 'Loose') ?? '';
    f.newFolder({ folder: id }, ['b0']);
    const data = f.data();
    const g = new BodyFolders();
    g.reset(stepTree());
    expect(g.load(data)).toBe(0);
    expect(show(g.tree())).toBe(show(f.tree()));
    expect(g.newFolder('top')).toBe('n3'); // ids continue
  });

  it('load drops what does not fit the model and breaks cycles', () => {
    const g = new BodyFolders();
    g.reset(stepTree());
    const dropped = g.load({
      folders: [
        { id: 'a', name: 'A', parent: { folder: 'b' } },
        { id: 'b', name: 'B', parent: { folder: 'a' } },
        { id: 'a', name: 'dup', parent: 'top' },
        { id: 'c', name: 'C', parent: { folder: 'missing' } },
      ],
      bodies: [
        { body: 99, parent: 'top' },
        { body: 0, parent: { assembly: 7 } },
        { body: 1, parent: { folder: 'b' } },
      ],
      assemblies: [{ assembly: 0, parent: 'top' }],
    });
    // dup, cycle (one folder to top), missing parent, body 99, assembly 7, wrapper assembly 0
    expect(dropped).toBe(6);
    expect(show(g.tree())).toBe('A(B(1)) C() Fans(0) 2 Screws(3 4)');
  });

  it('load breaks a cycle between a user folder and a STEP assembly', () => {
    const g = new BodyFolders();
    g.reset(stepTree());
    const dropped = g.load({
      folders: [{ id: 'n1', name: 'In Fans', parent: { assembly: 1 } }],
      bodies: [],
      assemblies: [{ assembly: 1, parent: { folder: 'n1' } }],
    });
    expect(dropped).toBe(1);
    expect(show(g.tree())).toBe('Fans(In Fans() 0 1) 2 Screws(3 4)');
  });

  it('lists folder choices with paths', () => {
    const { f } = setup();
    f.newFolder({ assembly: 1 }, [], 'Front');
    expect(f.choices().map((c) => c.label)).toEqual(['Fans', 'Fans › Front', 'Screws']);
  });
});
