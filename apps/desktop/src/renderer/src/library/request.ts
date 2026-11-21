/**
 * A part request being put together in the Library panel: parts picked from the catalogue, each with
 * copies, whole / sub-parts, target markers and a note. `buildRequest` turns it into what is saved on a
 * comment (`comments[].parts`, see core `schema.ts`). Pure.
 */
import {
  MAX_PART_ITEMS,
  MAX_PART_PARAMS,
  MAX_PART_TEXT,
  nextPartId,
  type PartItemData,
} from '@third-wheel/core';

export interface DraftItem {
  /** Catalogue class, e.g. "SocketHeadCapScrew". */
  readonly cls: string;
  /** What the user fixed (standard type, size, numbers). A name left out = the AI chooses. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly copies: number;
  /** Sub-part names chosen; empty = the whole part. */
  readonly subparts: readonly string[];
  readonly markerIds: readonly string[];
  readonly mode: 'each' | 'pattern';
  readonly note: string;
}

export const DEFAULT_REQUEST_TEXT = 'Add the parts listed below.';

export function newDraftItem(cls: string): DraftItem {
  return { cls, params: {}, copies: 1, subparts: [], markerIds: [], mode: 'each', note: '' };
}

/** A whole number from 1 to 999 (what a copies box may hold). */
export function clampCopies(n: number): number {
  return Number.isFinite(n) ? Math.min(999, Math.max(1, Math.round(n))) : 1;
}

export interface BuiltRequest {
  readonly text: string;
  /** Every marker any part is aimed at (the comment must name them all). */
  readonly markerIds: readonly string[];
  readonly parts: readonly PartItemData[];
}

/**
 * `exists` says which marker ids are still there; others are left out. Returns undefined when there is
 * nothing to send.
 */
export function buildRequest(
  items: readonly DraftItem[],
  text: string,
  library: { readonly name: string; readonly version: string },
  exists: (markerId: string) => boolean,
): BuiltRequest | undefined {
  if (items.length === 0) return undefined;
  const parts: PartItemData[] = [];
  const markerIds: string[] = [];
  for (const d of items.slice(0, MAX_PART_ITEMS)) {
    const live = [...new Set(d.markerIds)].filter(exists);
    for (const m of live) if (!markerIds.includes(m)) markerIds.push(m);
    const note = d.note.trim().slice(0, MAX_PART_TEXT);
    parts.push({
      id: nextPartId(parts),
      source: {
        kind: 'library',
        library: library.name,
        version: library.version,
        cls: d.cls,
        params: Object.fromEntries(Object.entries(d.params).slice(0, MAX_PART_PARAMS)),
      },
      copies: clampCopies(d.copies),
      scope: d.subparts.length > 0 ? { subparts: [...d.subparts] } : 'whole',
      ...(live.length > 0
        ? {
            target: {
              markerIds: live,
              ...(d.mode === 'pattern' ? { mode: 'pattern' as const } : {}),
            },
          }
        : {}),
      ...(note ? { note } : {}),
    });
  }
  return { text: text.trim() || DEFAULT_REQUEST_TEXT, markerIds, parts };
}

/** "Socket Head Cap Screw ×2 → Hole 1, Hole 2", for the comment card. */
export function describePart(
  p: PartItemData,
  title: (cls: string) => string,
  markerName: (id: string) => string | undefined,
): string {
  const names = (p.target?.markerIds ?? []).map(markerName).filter((n): n is string => !!n);
  const what = p.scope === 'whole' ? '' : ` (${p.scope.subparts.join(', ')})`;
  const copies = p.copies > 1 ? ` ×${String(p.copies)}` : '';
  const where = names.length > 0 ? ` → ${names.join(', ')}` : '';
  return `${title(p.source.cls)}${what}${copies}${where}`;
}
