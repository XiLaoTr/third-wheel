/**
 * Version chain (T8.6; a tree with one parent per file since T13.4): which files are versions of
 * one model, recorded in each version's notes when the user (or the AI) says so — Import new
 * version, Bring my notes over, `load_model` with `revisionOf` — or when a file is overwritten in
 * place. Names never link versions.
 *
 * Like a linked list spread over files, with one rule against bugs: each file's `earlier[0]` (its
 * parent) is the truth; `newer` lists are signposts, trusted only when the newer file names this
 * one as its parent; the rest of `earlier` is a cache for files whose notes can't be read. Walks
 * remember what they visited and stop after `MAX_VERSION_LINKS` steps, so a broken or circular
 * chain on disk can never hang the app.
 */
import { z } from 'zod';
import {
  MAX_VERSION_LINKS,
  versionLinkSchema,
  type VersionChain,
  type VersionLink,
} from './schema.js';

/** One version = a path with given contents (the same path may hold several, overwritten). */
export type VersionKey = Pick<VersionLink, 'path' | 'contentHash'>;

const keyOf = (l: VersionKey): string => `${l.path}\n${l.contentHash}`;

/** Whether two links mean the same version (same path, same contents). */
export function sameVersion(a: VersionKey, b: VersionKey): boolean {
  return a.path === b.path && a.contentHash === b.contentHash;
}

/** Links without repeats (first one kept), at most `MAX_VERSION_LINKS`. */
function unique(links: readonly VersionLink[]): VersionLink[] {
  const seen = new Set<string>();
  const out: VersionLink[] = [];
  for (const l of links) {
    const k = keyOf(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length === MAX_VERSION_LINKS) break;
  }
  return out;
}

/** `chain` without empty lists; undefined when nothing is left. */
function compact(chain: VersionChain): VersionChain | undefined {
  const out: VersionChain = {
    ...(chain.earlier?.length ? { earlier: chain.earlier } : {}),
    ...(chain.newer?.length ? { newer: chain.newer } : {}),
    ...(chain.unlinked ? { unlinked: chain.unlinked } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The chain of a new version made from an earlier one: `link` (the earlier version, its parent)
 * first, then everything that version came from (`base` = its chain) as a cache. The new file's own
 * earlier versions (`own`) are dropped: a file has one parent (the caller asks the user first when
 * `own` named another one). A file overwritten in place keeps its newer versions (they are still
 * newer); a different file keeps only its own. `self` is never listed as its own earlier version.
 * Linking again clears an `unlinked` mark.
 */
export function chainAfter(
  base: VersionChain | undefined,
  link: VersionLink,
  own?: VersionChain,
  self?: VersionKey,
): VersionChain {
  const earlier = unique([link, ...(base?.earlier ?? [])]).filter(
    (l) => !self || !sameVersion(l, self),
  );
  const newer = link.overwritten
    ? unique([...(base?.newer ?? []), ...(own?.newer ?? [])])
    : own?.newer;
  return newer?.length ? { earlier, newer: [...newer] } : { earlier };
}

/** `chain` with the link at `path` + `contentHash` moved to a new place (Locate…). */
export function relocated(
  chain: VersionChain,
  link: VersionKey,
  to: { readonly path: string; readonly name: string },
): VersionChain {
  const k = keyOf(link);
  const move = (list: readonly VersionLink[] | undefined): VersionLink[] | undefined =>
    list && unique(list.map((l) => (keyOf(l) === k ? { ...l, path: to.path, name: to.name } : l)));
  const earlier = move(chain.earlier);
  const newer = move(chain.newer);
  return {
    ...(earlier ? { earlier } : {}),
    ...(newer ? { newer } : {}),
    ...(chain.unlinked ? { unlinked: chain.unlinked } : {}),
  };
}

/**
 * The version chain in the notes of one version, as a walk reads it: `undefined` = these contents'
 * notes can't be read (file gone, changed, overwritten, no notes, unreadable); `{ chain }` = read
 * (`chain` undefined when the notes list no versions).
 */
export type ChainRead = { readonly chain: VersionChain | undefined } | undefined;
export type ChainReader = (link: VersionLink) => Promise<ChainRead>;

/**
 * The earlier versions of a file, nearest first, walked parent by parent: each readable version's
 * own `earlier` list takes over (its parent is the truth); where a version can't be read, the
 * cache it was found in goes on. A version marked `unlinked` is left out (removed from the chain
 * while a newer one's notes couldn't be updated). Stops at `self`, at a repeat (a circle on disk)
 * and after `max` versions.
 */
export async function walkEarlier(
  start: readonly VersionLink[] | undefined,
  read: ChainReader,
  self?: VersionKey,
  max = MAX_VERSION_LINKS,
): Promise<VersionLink[]> {
  const out: VersionLink[] = [];
  const seen = new Set<string>(self ? [keyOf(self)] : []);
  let list = start ?? [];
  let i = 0;
  // Each step either moves on in a list or switches to a new (unseen) version's list.
  for (let steps = 0; i < list.length && out.length < max && steps < max * 4; steps++) {
    const link = list[i];
    if (!link) break;
    const k = keyOf(link);
    if (seen.has(k)) {
      if (self && k === keyOf(self)) break; // a circle back to the start: the line ends here
      i++;
      continue;
    }
    seen.add(k);
    const got = link.overwritten ? undefined : await read(link);
    if (got?.chain?.unlinked) {
      i++; // removed: skip it, the cache it was found in goes on
      continue;
    }
    out.push(link);
    if (got) {
      list = got.chain?.earlier ?? [];
      i = 0;
    } else i++;
  }
  return out;
}

/**
 * Whether a newer file's chain (`child`) names `parent` as the version it was made from — the test
 * for a `newer` signpost. Also true when the child's parent is earlier contents of the same path
 * that `parent` replaced in place (Reload with changes keeps the newer versions).
 */
export function confirmsParent(
  child: VersionChain | undefined,
  parent: VersionKey & { readonly chain?: VersionChain | undefined },
): boolean {
  const first = child?.earlier?.[0];
  if (!first) return false;
  if (sameVersion(first, parent)) return true;
  return (
    first.path === parent.path &&
    (parent.chain?.earlier ?? []).some((l) => l.overwritten && sameVersion(l, first))
  );
}

/**
 * One change to a version's chain (T13.4), applied by the window to the shown file and by main to
 * another file's notes. `drop`: links to take out of both lists. `parent`: put first in `earlier`
 * (the new parent). `addNewer`: signposts to add. `clear`: empty both lists. `unlinked`: set the
 * mark (a date) or, with null, remove it.
 */
export const chainEditSchema = z.object({
  drop: z
    .array(z.object({ path: z.string(), contentHash: z.string() }))
    .max(MAX_VERSION_LINKS)
    .optional(),
  parent: versionLinkSchema.optional(),
  addNewer: z.array(versionLinkSchema).max(MAX_VERSION_LINKS).optional(),
  clear: z.literal(true).optional(),
  unlinked: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type ChainEdit = z.infer<typeof chainEditSchema>;

/** `chain` with `edit` applied; undefined when no list or mark is left. */
export function editChain(
  chain: VersionChain | undefined,
  edit: ChainEdit,
): VersionChain | undefined {
  const unlinked = edit.unlinked === null ? undefined : (edit.unlinked ?? chain?.unlinked);
  if (edit.clear) return compact({ ...(unlinked ? { unlinked } : {}) });
  const dropped = (l: VersionLink): boolean => (edit.drop ?? []).some((d) => sameVersion(l, d));
  const earlier = unique([
    ...(edit.parent ? [edit.parent] : []),
    ...(chain?.earlier ?? []).filter((l) => !dropped(l)),
  ]);
  const newer = unique([
    ...(edit.addNewer ?? []),
    ...(chain?.newer ?? []).filter((l) => !dropped(l)),
  ]);
  return compact({ earlier, newer, ...(unlinked ? { unlinked } : {}) });
}

/** A version the removal changes: its path + contents, and the edit for its notes. */
export interface PlannedEdit extends VersionKey {
  readonly name: string;
  readonly edit: ChainEdit;
}

/**
 * T13.4: take `removed` out of its chain, like unlinking a node from a list: each child (version
 * made from it) gets `removed`'s parent as its own, the parent gets the children as newer versions,
 * and `removed` gets empty lists and the `unlinked` mark. In write order — the children first
 * (their parent is the truth), then the parent's signposts, then the mark — so a crash or an
 * unwritable file part-way leaves a chain that still reads sensibly. Overwritten contents have no
 * notes of their own, so they get no edit.
 */
export function removalPlan(input: {
  readonly removed: VersionLink;
  readonly parent: VersionLink | undefined;
  readonly children: readonly VersionLink[];
  readonly date: string;
}): PlannedEdit[] {
  const { removed, parent, date } = input;
  const children = unique(input.children).filter((c) => !sameVersion(c, removed));
  const drop = [{ path: removed.path, contentHash: removed.contentHash }];
  const edits: PlannedEdit[] = children.map((c) => ({
    path: c.path,
    contentHash: c.contentHash,
    name: c.name,
    edit: { drop, ...(parent ? { parent } : {}) },
  }));
  if (parent && !parent.overwritten)
    edits.push({
      path: parent.path,
      contentHash: parent.contentHash,
      name: parent.name,
      edit: { drop, addNewer: children },
    });
  if (!removed.overwritten)
    edits.push({
      path: removed.path,
      contentHash: removed.contentHash,
      name: removed.name,
      edit: { clear: true, unlinked: date },
    });
  return edits;
}

/** Whether linking `child` as a newer version of a file with earlier versions `parentLine` (that
 * file first) would make a circle: `child` is already one of them. */
export function makesCircle(child: VersionKey, parentLine: readonly VersionKey[]): boolean {
  return parentLine.some((l) => sameVersion(l, child));
}
