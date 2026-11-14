/**
 * Loading a new revision of a model (T8.1). Pure: decides whether the previous version's
 * annotations fit the new file as they are, and words what the app tells the user.
 *
 * A revision is the same file with new contents (Reload from disk, or opened / loaded again), or
 * another file the AI names with `load_model({ revisionOf })`. Same mesh hash → the annotations are
 * carried over exactly; otherwise they are kept for the transfer (T8.2) and the model starts empty.
 */
import type {
  Annotations,
  MeshCoverage,
  RevisionAnnotations,
  TransferSummary,
  TransferredMarker,
} from '@third-wheel/core';

/** Where the previous version's annotations come from. */
export interface PreviousAnnotations {
  readonly doc: Annotations;
  /** Fields this app doesn't know (lost on the next save). */
  readonly droppedFields: readonly string[];
  /** Model file the sidecar belongs to. */
  readonly path: string;
  readonly name: string;
  /** The sidecar next to the newly loaded file (it gets replaced), not another file's. */
  readonly own: boolean;
}

/**
 * True when the annotations fit the new model as they are: the mesh hash saved with them (or the
 * previous model's, still in memory) equals the new one, with the same mesh settings.
 */
export function sameGeometry(
  doc: Annotations,
  meshHash: string,
  tessellation: { readonly linearDeflection: number; readonly angularDeflection: number },
  previousMeshHash?: string,
): boolean {
  const old = doc.model.meshHash ?? previousMeshHash;
  const tess = doc.tessellation;
  return (
    old === meshHash &&
    tess?.linearDeflection === tessellation.linearDeflection &&
    tess.angularDeflection === tessellation.angularDeflection
  );
}

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

/** "2 markers and 3 comments" (or "no annotations"). */
export function annotationCounts(doc: Annotations): string {
  const m = doc.markers.length;
  const c = doc.comments.length;
  if (m === 0 && c === 0) return 'no annotations';
  if (c === 0) return plural(m, 'marker');
  if (m === 0) return plural(c, 'comment');
  return `${plural(m, 'marker')} and ${plural(c, 'comment')}`;
}

/**
 * Notice after carrying annotations over to a new version with the same geometry. `ownBackup` =
 * where the new file's own older sidecar went (when another file's annotations were used).
 */
export function carriedText(
  prev: PreviousAnnotations,
  newName: string,
  ownBackup: string | null = null,
): string {
  const what = annotationCounts(prev.doc);
  if (prev.own)
    return `${newName} changed on disk, but its geometry is the same: ${what} carried over.`;
  const old = ownBackup ? ` Its own older annotations were moved to ${ownBackup}.` : '';
  return `${newName} has the same geometry as ${prev.name}: ${what} carried over.${old}`;
}

/** T9.2: the question when a STEP looks like the same part as a mesh with notes (sizes match). */
export function meshQuestion(
  newName: string,
  prev: PreviousAnnotations,
): { title: string; text: string } {
  return {
    title: `Is ${newName} the same part as ${prev.name}?`,
    text: `${prev.name} has ${annotationCounts(prev.doc)}. Bring them onto ${newName}? The two files are lined up and the paint goes onto the nearest STEP faces; ${prev.name} and its notes stay as they are.`,
  };
}

/** T8.4: the question "Is part_v2.step a new version of part.step?" — its explanation. */
export function versionQuestionText(newName: string, prev: PreviousAnnotations): string {
  return `${prev.name} has ${annotationCounts(prev.doc)}. Bring them over to ${newName}? They are moved onto the new geometry; ${prev.name} and its notes stay as they are.`;
}

/**
 * Pop-up text when the geometry changed and moving the annotations failed (T8.2): they are kept,
 * not shown. `backup` = file name the new file's own sidecar was moved to (null: none).
 */
export function waitingText(
  prev: PreviousAnnotations,
  newName: string,
  detail: string,
  backup: string | null,
): string {
  const what = annotationCounts(prev.doc);
  const later = 'They could not be moved onto the new geometry.';
  if (!prev.own) {
    const old = backup ? ` Its own older annotations were moved to ${backup}.` : '';
    return `${newName} is a new version of ${prev.name}. Its ${what} stay saved with ${prev.name}; ${newName} starts without annotations.${old} ${later}`;
  }
  const where = backup
    ? `were moved to ${backup}; the model starts without annotations.`
    : `were left as they are; changes you make now will replace them.`;
  return `${newName} is a new version (${detail}). Its ${what} ${where} ${later}`;
}

/** What `load_model` tells the AI about the previous version (bridge `LoadResult.revision`). */
export function revisionResult(
  prev: { readonly name: string; readonly path: string },
  annotations: RevisionAnnotations,
  doc?: Annotations,
  transfer?: TransferSummary,
): {
  of: string;
  path: string;
  annotations: RevisionAnnotations;
  markers: number;
  comments: number;
  transfer?: TransferSummary;
} {
  return {
    of: prev.name,
    path: prev.path,
    annotations,
    markers: doc?.markers.length ?? 0,
    comments: doc?.comments.length ?? 0,
    ...(transfer ? { transfer } : {}),
  };
}

/** Counts per status and the markers not found where they were (T8.2). */
export function transferSummary(
  doc: Annotations,
  status: Readonly<Record<string, 'found' | 'changed' | 'lost' | 'check'>>,
): TransferSummary {
  const flagged: TransferredMarker[] = [];
  const n = { found: 0, changed: 0, lost: 0, check: 0 };
  for (const m of doc.markers) {
    const s = status[m.id] ?? 'lost';
    n[s]++;
    if (s !== 'found') flagged.push({ id: m.id, name: m.name, status: s });
  }
  return { ...n, flagged };
}

/**
 * Notice after moving annotations onto changed geometry (T8.2). `backup` = where the new file's
 * own older sidecar went (null: none).
 */
export function movedText(
  prev: PreviousAnnotations,
  newName: string,
  sum: TransferSummary,
  backup: string | null,
): string {
  const total = sum.found + sum.changed + sum.lost + sum.check;
  const head = prev.own
    ? `${newName} changed on disk: ${plural(total, 'marker')} moved onto the new geometry`
    : `${newName} is a new version of ${prev.name}: ${plural(total, 'marker')} moved over`;
  const parts = [
    sum.changed ? `${String(sum.changed)} changed` : '',
    sum.lost ? `${String(sum.lost)} lost` : '',
    sum.check ? `${String(sum.check)} to check (mirrored)` : '',
  ].filter(Boolean);
  const how =
    parts.length === 0
      ? total === 0
        ? '.'
        : ', all found.'
      : ` — ${String(sum.found)} found, ${parts.join(', ')}. Look for ⚠ in Markers.`;
  const kept = !backup
    ? ''
    : prev.own
      ? ` The old file was kept as ${backup}.`
      : ` Its own older annotations were moved to ${backup}.`;
  return `${head}${how}${kept}`;
}

/** "97 %" (rounded down, so 99.6 % never reads as 100 %). */
const percent = (share: number): string => `${String(Math.floor(share * 100))} %`;

/**
 * T9.2 notice after moving a mesh's notes (STL / 3MF) onto a STEP: how many markers, how much of
 * the paint matched within the tolerance, and a warning when the files only partly match.
 */
export function meshMovedText(
  prev: PreviousAnnotations,
  newName: string,
  sum: TransferSummary,
  cov: MeshCoverage,
  backup: string | null,
): string {
  const total = sum.found + sum.changed + sum.lost + sum.check;
  const head = `Notes from ${prev.name} moved onto ${newName}: ${plural(total, 'marker')}`;
  const share = cov.points > 0 ? cov.matched / cov.points : 1;
  const tol = `${String(Math.round(cov.toleranceMm * 100) / 100)} mm`;
  const parts = [
    sum.changed ? `${String(sum.changed)} changed` : '',
    sum.lost ? `${String(sum.lost)} lost` : '',
    sum.check ? `${String(sum.check)} to check (mirrored)` : '',
  ].filter(Boolean);
  const paint =
    cov.points === 0 ? '' : `, ${percent(share)} of the paint matched a STEP face within ${tol}`;
  const how = parts.length === 0 ? '.' : ` (${parts.join(', ')}). Look for ⚠ in Markers.`;
  const fit = cov.mirrored
    ? ' The mesh only fits the STEP as a mirror image: its paint is kept as ghosts to check.'
    : cov.surface >= 0.9
      ? ''
      : cov.meshRead
        ? ` Only ${percent(cov.surface)} of the mesh lies on the STEP surface: the files may be different parts or versions.`
        : ` The mesh file couldn't be read, so the files were lined up from the paint alone: check where it landed.`;
  const kept = backup ? ` Its own older annotations were moved to ${backup}.` : '';
  return `${head}${paint}${how}${fit}${kept}`;
}

/**
 * T15.2: notes worth keeping: a comment, or a marker that holds something (paint, entities, or
 * parts a transfer couldn't place). An empty notes file, or only an empty "Marker 1", counts as none.
 */
export function hasNotes(doc: Annotations): boolean {
  return (
    doc.comments.length > 0 ||
    doc.markers.some(
      (m) =>
        m.entities.length > 0 ||
        m.paint.faces.length > 0 ||
        (m.paint.samples?.length ?? 0) > 0 ||
        m.transfer?.ghost !== undefined,
    )
  );
}

/**
 * T15.2: Import onto a file that already has its own notes for these contents: the question
 * (Keep its notes / Replace with the earlier file's) and the notice after Keep.
 */
export function ownNotesQuestion(
  newName: string,
  own: Annotations,
  prev: PreviousAnnotations,
): { title: string; text: string; keep: string; replace: string } {
  return {
    title: `${newName} already has its own notes`,
    text: `${newName} has ${annotationCounts(own)}; ${prev.name} has ${annotationCounts(prev.doc)}. Keep the notes of ${newName}, or replace them with the notes of ${prev.name} (moved onto the new geometry)? Replaced notes are kept in a backup copy (….bak.json); ${prev.name} keeps its notes either way.`,
    keep: `Keep its notes`,
    replace: `Replace with notes from ${prev.name}`,
  };
}

/** T15.2: notice after keeping the imported file's own notes. */
export function keptOwnText(newName: string, prevName: string): string {
  return `${newName} kept its own notes; nothing was moved from ${prevName}.`;
}
