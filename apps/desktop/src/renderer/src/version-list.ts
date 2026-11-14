/**
 * The toolbar "Versions" menu's list (T8.5, chain only since T8.6): the shown model's newer
 * versions, the shown file, then its earlier versions — newest first, as linked by Import new
 * version / Bring my notes over / the AI's `revisionOf` (never by file names).
 */
import type { VersionChain, VersionLink } from '@third-wheel/core';

/**
 * - `found`: the file is there with the linked contents.
 * - `changed`: a file is there, with other contents (replaced since).
 * - `missing`: no file at that path (moved, renamed or deleted): Locate….
 * - `overwritten`: the file was replaced by a newer version of itself; these contents are gone.
 */
export type VersionRowState = 'shown' | 'found' | 'changed' | 'missing' | 'overwritten';

export interface VersionRow {
  readonly path: string;
  readonly name: string;
  readonly state: VersionRowState;
  /** The link this row comes from (none for the shown file). */
  readonly link?: VersionLink;
  /** In the shown file's own chain (can be located and saved); else found through a newer one. */
  readonly own: boolean;
}

/**
 * Rows for the menu. `further`: newer versions found in the newer files' notes, furthest first
 * (open `part_v1`, see `part_v3` through `part_v2`). `states`: content hash on disk per path
 * (null = not there).
 */
export function versionRows(
  shown: { readonly path: string; readonly name: string },
  chain: VersionChain | undefined,
  states: ReadonlyMap<string, string | null>,
  further: readonly VersionLink[] = [],
): VersionRow[] {
  const seen = new Set<string>();
  const row = (link: VersionLink, own: boolean): VersionRow | undefined => {
    const key = `${link.path}\n${link.contentHash}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const onDisk = states.get(link.path);
    const state: VersionRowState = link.overwritten
      ? 'overwritten'
      : onDisk === undefined || onDisk === null
        ? 'missing'
        : onDisk === link.contentHash
          ? 'found'
          : 'changed';
    return { path: link.path, name: link.name, state, link, own };
  };
  const out: VersionRow[] = [];
  const add = (r: VersionRow | undefined): void => {
    if (r) out.push(r);
  };
  for (const l of further) add(row(l, false));
  for (const l of chain?.newer ?? []) add(row(l, true));
  out.push({ path: shown.path, name: shown.name, state: 'shown', own: true });
  for (const l of chain?.earlier ?? []) add(row(l, true));
  // Newer rows: the furthest were added first; own newer ones are newest-first already.
  return out;
}

/** Short grey text after a row's name. */
export function versionDetail(row: VersionRow, locale?: string): string {
  switch (row.state) {
    case 'shown':
      return 'shown';
    case 'missing':
      return 'not found';
    case 'changed':
      return 'file changed since';
    case 'overwritten':
      return 'overwritten';
    case 'found': {
      if (!row.link) return '';
      return new Date(row.link.date).toLocaleString(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
}

/** The row's label: overwritten contents are "earlier contents of X". */
export function versionLabel(row: VersionRow): string {
  return row.state === 'overwritten' ? `earlier contents of ${row.name}` : row.name;
}
