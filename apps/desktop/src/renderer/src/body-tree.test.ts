import { describe, expect, it } from 'vitest';
import {
  buildBodyTree,
  rangeBodies,
  folderVisibility,
  initiallyOpen,
  visibleRows,
  type TreeNode,
} from './body-tree.js';

/** Compact text form: folders as "Name(…)", bodies as their id. */
function show(nodes: readonly TreeNode[]): string {
  return nodes
    .map((n) => (n.kind === 'body' ? String(n.body) : `${n.name}(${show(n.children)})`))
    .join(' ');
}

// Root "Printer" › { Fans › {0, 1}, 2, Screws › {3, 4} } — like a typical STEP export.
const assemblies = [
  { name: 'Printer', parent: -1 },
  { name: 'Fans', parent: 0 },
  { name: 'Screws', parent: 0 },
];
const bodyAssembly = [1, 1, 0, 2, 2];

describe('buildBodyTree', () => {
  it('unwraps the single top assembly and keeps STEP order', () => {
    expect(show(buildBodyTree(5, assemblies, bodyAssembly))).toBe('Fans(0 1) 2 Screws(3 4)');
  });

  it('keeps the loose body at the top level and still unwraps', () => {
    const tree = buildBodyTree(6, assemblies, [...bodyAssembly, -1], 5);
    expect(show(tree)).toBe('Fans(0 1) 2 Screws(3 4) 5');
  });

  it('lists folder bodies at any depth', () => {
    const tree = buildBodyTree(
      3,
      [
        { name: 'A', parent: -1 },
        { name: 'B', parent: 0 },
        { name: 'C', parent: -1 },
      ],
      [1, 0, 2],
    );
    expect(show(tree)).toBe('A(B(0) 1) C(2)');
    const a = tree[0];
    expect(a?.kind === 'folder' && a.bodies).toEqual([0, 1]);
  });

  it('keeps two copies of a sub-assembly apart', () => {
    const tree = buildBodyTree(
      4,
      [
        { name: 'Top', parent: -1 },
        { name: 'Fan', parent: 0 },
        { name: 'Fan', parent: 0 },
        { name: 'X', parent: -1 },
      ],
      [1, 1, 2, 3],
    );
    expect(show(tree)).toBe('Top(Fan(0 1) Fan(2)) X(3)');
  });

  it('drops empty folders and gives a flat list without assemblies', () => {
    expect(show(buildBodyTree(2, [{ name: 'Empty', parent: -1 }], [-1, -1]))).toBe('0 1');
    expect(show(buildBodyTree(3, [], []))).toBe('0 1 2');
  });

  it('unwraps nested single wrappers', () => {
    const tree = buildBodyTree(
      2,
      [
        { name: 'File', parent: -1 },
        { name: 'Inner', parent: 0 },
      ],
      [1, 1],
    );
    expect(show(tree)).toBe('0 1');
  });
});

describe('folderVisibility', () => {
  it('reports shown / hidden / mixed', () => {
    expect(folderVisibility([0, 1], [true, true, false])).toBe('shown');
    expect(folderVisibility([1, 2], [true, false, false])).toBe('hidden');
    expect(folderVisibility([0, 2], [true, true, false])).toBe('mixed');
  });
});

describe('visibleRows', () => {
  it('opens top-level folders by default and hides the inside of closed ones', () => {
    const tree = buildBodyTree(
      3,
      [
        { name: 'A', parent: -1 },
        { name: 'B', parent: 0 },
        { name: 'C', parent: -1 },
      ],
      [1, 0, 2],
    );
    const open = initiallyOpen(tree);
    const label = (rows: ReturnType<typeof visibleRows>): string[] =>
      rows.map(
        (r) => `${String(r.depth)}:${r.node.kind === 'body' ? String(r.node.body) : r.node.name}`,
      );
    expect(label(visibleRows(tree, open))).toEqual(['0:A', '1:B', '1:1', '0:C', '1:2']);
    open.add('f1');
    expect(label(visibleRows(tree, open))).toEqual(['0:A', '1:B', '2:0', '1:1', '0:C', '1:2']);
    open.delete('f0');
    expect(label(visibleRows(tree, open))).toEqual(['0:A', '0:C', '1:2']);
  });
});

describe('rangeBodies', () => {
  // Rows: Body 0, [Folder 0: 1, 2] (open), Body 1, Body 2, Body 3
  const folder: TreeNode = {
    kind: 'folder',
    key: 'f0',
    assembly: 0,
    name: 'Screws',
    children: [
      { kind: 'body', body: 1 },
      { kind: 'body', body: 2 },
    ],
    bodies: [1, 2],
  };
  const roots: TreeNode[] = [{ kind: 'body', body: 0 }, folder, { kind: 'body', body: 3 }];
  const rows = visibleRows(roots, new Set(['f0']));

  it('covers the rows between anchor and clicked, either direction, each body once', () => {
    expect(rangeBodies(rows, 'b0', 'b2')).toEqual([0, 1, 2]);
    expect(rangeBodies(rows, 'b3', 'b1')).toEqual([1, 2, 3]);
  });

  it('a folder row in the range brings all its bodies, also when closed', () => {
    const closed = visibleRows(roots, new Set());
    expect(rangeBodies(closed, 'b0', 'f0')).toEqual([0, 1, 2]);
  });

  it('without a shown anchor selects only the clicked row', () => {
    expect(rangeBodies(rows, undefined, 'b3')).toEqual([3]);
    expect(rangeBodies(rows, 'b99', 'f0')).toEqual([1, 2]);
    expect(rangeBodies(rows, 'b0', 'b99')).toEqual([]);
  });
});
