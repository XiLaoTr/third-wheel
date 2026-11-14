/**
 * Annotation transfer (T8.2): moves a sidecar's markers onto a new revision of the model, after
 * the geometry changed and ids no longer apply. Works from the old sidecar alone (the old model
 * may be gone): body fingerprints, held entities' fingerprints, and per-face paint samples and
 * fingerprints. Pure. Rules and tolerances: below.
 *
 * 1. Bodies: by name, then by size (area + sorted bbox sides within 10 %), the nearest wins.
 * 2. Per body, the old markers are lined up with the new body: kept in place, or moved / turned in
 *    90° steps onto the new bounding box, whichever puts most of them back on the surface. A
 *    mirror that fits better than any turn → the body's markers are "check" (never moved).
 * 3. Held entities: same type within the "found" distance; else one candidate within the
 *    "changed" distance, or the same entity shifted (moved with a side of the bounding box, or the
 *    only one of that type, size and direction) → changed; else lost.
 * 4. Paint: each face's samples go to the nearest surface of the same type and direction; found
 *    when most land within the "found" distance, changed when they land within the "changed" one
 *    or the face shifted as in 3. New triangles near the landed points are painted.
 */
import {
  toRuns,
  type Annotations,
  type BodyFingerprint,
  type BodyTreeData,
  type EntityFingerprint,
  type MarkerData,
  type MarkerEntityData,
  type MarkerTransfer,
  type MeshCoverage,
  type PaintPieces,
  type PieceTree,
} from '@third-wheel/core';
import type { EntityRef, InfoModel } from './entity-info.js';
import { bodyFingerprints, entityFingerprints } from './fingerprint.js';
import type { StepModel } from './model.js';
import { at3, dot, len, sub, type V3 } from './vec.js';

/**
 * Per marker (T8.0): `found` in the same place; `changed`
 * moved or resized (flagged for the user); `lost` gone (kept as a ghost with its comments);
 * `check` not mapped on purpose (a mirrored body).
 */
export type TransferStatus = 'found' | 'changed' | 'lost' | 'check';

/** The annotations for the new model + a status per marker id. */
export interface TransferResult {
  readonly annotations: Annotations;
  readonly status: Readonly<Record<string, TransferStatus>>;
}

export type TransferModel = InfoModel & Pick<StepModel, 'bodyCount'>;

/** "Found" distance: max(0.5 mm, 1 % of the body's largest side). */
export const FOUND_MM = 0.5;
export const FOUND_SHARE = 0.01;
/** "Changed" distance: max(5 mm, 5 % of the body's largest side). */
export const CHANGED_MM = 5;
export const CHANGED_SHARE = 0.05;
/** Bodies match by size when area and sorted bbox sides are within this share. */
const SIZE_SHARE = 0.1;
/** Directions agree within 10°. */
const COS_DIR = Math.cos((10 * Math.PI) / 180);
/** Paint samples tried per face when lining up a body (keeps it quick). */
const PROBE_SAMPLES = 48;
/** Moves `old` (a sidecar of an earlier version) onto `m`. Comments are kept as they are. */
export function transferAnnotations(old: Annotations, m: TransferModel): TransferResult {
  const newBodies = bodyFingerprints(m, m.bodyCount);
  const ctx = new Context(m, newBodies);
  const oldBodies = old.bodies;
  const bodyMap = matchBodies(oldBodies, newBodies);
  // Re-placed ghost entities get new `seq`s above every saved one.
  let seq = Math.max(0, ...old.markers.flatMap((mk) => mk.entities.map((e) => e.seq + 1)));

  // Items per old body (to line each body up once, with all its markers).
  const items = old.markers.map((mk) => markerItems(mk));
  const aligns = new Map<number, Alignment>();
  let legacy: Alignment | undefined;
  const alignOf = (oldBody: number | undefined): Alignment | undefined => {
    if (oldBody === undefined)
      return (legacy ??= { body: ctx.body(-1), t: IDENTITY, mirrored: false, oldBox: undefined });
    const nb = bodyMap.get(oldBody);
    if (nb === undefined) return undefined;
    let a = aligns.get(oldBody);
    if (!a) {
      a = align(ctx.body(nb), oldBodies?.[oldBody], items, oldBody);
      aligns.set(oldBody, a);
    }
    return a;
  };
  /** Body index on the new model for a ghost (none when its body has no match). */
  const newBody = (a: Alignment | undefined): number | undefined =>
    a && a.body.index >= 0 ? a.body.index : undefined;

  const status: Record<string, TransferStatus> = {};
  const markers = old.markers.map((mk, i): MarkerData => {
    const it = items[i] ?? { groups: [], entities: [] };
    const statuses: TransferStatus[] = [];
    const entities: MarkerEntityData[] = [];
    const ghostFaces: GhostFace[] = [];
    const ghostEntities: GhostEntity[] = [];
    const wasCheck = mk.transfer?.status === 'check';
    /**
     * Whether an item may be placed with alignment `a`: never across a mirror — except the parts of
     * a "check" marker (left at their mirrored place), which are placed when mirrored back.
     */
    const placeable = (a: Alignment, ghost: boolean): boolean =>
      ghost && wasCheck ? a.mirrored : !a.mirrored;
    const missed = (a: Alignment | undefined, ghost: boolean): TransferStatus =>
      a && !placeable(a, ghost) ? 'check' : 'lost';
    for (const e of it.entities) {
      const a = alignOf(e.body);
      const got = a && placeable(a, e.ghost) ? matchEntity(e, a) : undefined;
      if (got) {
        // Two old entities may land on one new one: the marker holds it once.
        if (!entities.some((x) => x.kind === e.kind && x.id === got.id))
          entities.push({ kind: e.kind, id: got.id, seq: e.ghost ? seq++ : e.seq });
        // Back after being lost / mirrored: the user checks where it landed.
        statuses.push(e.ghost ? 'changed' : got.status);
      } else {
        statuses.push(missed(a, e.ghost));
        if (e.fp) {
          const fp = moveFp(e.fp, a?.t ?? IDENTITY, newBody(a));
          ghostEntities.push({ ...fp, kind: e.kind });
        }
      }
    }
    const paintFaces = new Map<number, { whole: number[]; pieces: PaintPieces[] }>();
    for (const g of it.groups) {
      const a = alignOf(g.body);
      const got = a && placeable(a, g.ghost) ? movePaint(g, a) : undefined;
      if (got) {
        statuses.push(g.ghost ? 'changed' : got.status);
        for (const [face, add] of got.faces) {
          const f = paintFaces.get(face) ?? { whole: [], pieces: [] };
          f.whole.push(...add.whole);
          f.pieces.push(...add.pieces);
          paintFaces.set(face, f);
        }
      } else {
        statuses.push(missed(a, g.ghost));
        const t = a?.t ?? IDENTITY;
        ghostFaces.push(
          compactFace({
            samples: g.samples.flatMap((p) => round3(apply(t, p))),
            clear: g.clear.flatMap((p) => round3(apply(t, p))),
            fingerprint: g.fp && moveFp(g.fp, t, newBody(a)),
          }),
        );
      }
    }
    // Paint saved without any sample points can't be placed: lost, never silently "found".
    if (it.groups.length === 0 && mk.paint.faces.length > 0) statuses.push('lost');
    let s = combine(statuses);
    // Flagged before and not confirmed yet: still for the user to check.
    if (s === 'found' && mk.transfer) s = 'changed';
    status[mk.id] = s;
    const ghost =
      ghostFaces.length + ghostEntities.length > 0
        ? {
            ...(ghostFaces.length > 0 ? { faces: ghostFaces } : {}),
            ...(ghostEntities.length > 0 ? { entities: ghostEntities } : {}),
          }
        : undefined;
    const transfer: MarkerTransfer | undefined =
      s === 'found'
        ? undefined
        : {
            status: s,
            // The version it was last placed by the user on.
            from: mk.transfer?.from ?? old.model.fileName,
            ...(ghost ? { ghost } : {}),
          };
    return {
      id: mk.id,
      name: mk.name,
      color: mk.color,
      visible: mk.visible,
      entities,
      paint: { faces: facePaint(paintFaces) },
      ...(transfer ? { transfer } : {}),
    };
  });

  const bodyTree = remapBodyTree(old.bodyTree, bodyMap, m.bodyCount);
  return {
    annotations: {
      ...old,
      markers,
      ...(bodyTree ? { bodyTree } : {}),
      bodies: newBodies,
    },
    status,
  };
}

/** What `placeGhost` put on the model, and what it still couldn't place. */
export interface PlacedGhost {
  readonly entities: readonly { readonly kind: MarkerEntityData['kind']; readonly id: number }[];
  /** New paint only (the marker's own paint is left to the caller). */
  readonly paint: MarkerData['paint']['faces'];
  /** Parts still not placed (undefined: everything was). */
  readonly ghost: MarkerTransfer['ghost'];
}

/**
 * "✓ Place here" on a "? Check" marker (T8.5): its ghost — already moved to
 * where the mirrored body puts it, as drawn — is placed on the model as it is (no turn, no mirror
 * rule): paint rebuilt from its points, entities matched by fingerprint, as in the transfer.
 */
export function placeGhost(
  ghost: NonNullable<MarkerTransfer['ghost']>,
  m: TransferModel,
): PlacedGhost {
  const ctx = new Context(m, bodyFingerprints(m, m.bodyCount));
  const at = (body: number | undefined): Alignment => ({
    body: ctx.body(body !== undefined && body >= 0 && body < m.bodyCount ? body : -1),
    t: IDENTITY,
    mirrored: false,
    oldBox: undefined,
  });
  const it = markerItems({
    id: '',
    name: '',
    color: '',
    visible: true,
    entities: [],
    paint: { faces: [] },
    transfer: { status: 'check', from: '', ghost },
  });
  const entities: { kind: MarkerEntityData['kind']; id: number }[] = [];
  const ghostEntities: GhostEntity[] = [];
  for (const e of it.entities) {
    const got = matchEntity(e, at(e.body));
    if (got) {
      if (!entities.some((x) => x.kind === e.kind && x.id === got.id))
        entities.push({ kind: e.kind, id: got.id });
    } else if (e.fp) ghostEntities.push({ ...e.fp, kind: e.kind });
  }
  const paintFaces = new Map<number, { whole: number[]; pieces: PaintPieces[] }>();
  const ghostFaces: GhostFace[] = [];
  for (const g of it.groups) {
    const got = movePaint(g, at(g.body));
    if (!got) {
      ghostFaces.push(
        compactFace({
          samples: g.samples.flatMap((p) => round3(p)),
          clear: g.clear.flatMap((p) => round3(p)),
          fingerprint: g.fp,
        }),
      );
      continue;
    }
    for (const [face, add] of got.faces) {
      const f = paintFaces.get(face) ?? { whole: [], pieces: [] };
      f.whole.push(...add.whole);
      f.pieces.push(...add.pieces);
      paintFaces.set(face, f);
    }
  }
  const left =
    ghostFaces.length + ghostEntities.length > 0
      ? {
          ...(ghostFaces.length > 0 ? { faces: ghostFaces } : {}),
          ...(ghostEntities.length > 0 ? { entities: ghostEntities } : {}),
        }
      : undefined;
  return { entities, paint: facePaint(paintFaces), ghost: left };
}

type GhostFace = NonNullable<NonNullable<MarkerTransfer['ghost']>['faces']>[number];
type GhostEntity = NonNullable<NonNullable<MarkerTransfer['ghost']>['entities']>[number];

function compactFace(f: {
  samples: number[];
  clear: number[];
  fingerprint: EntityFingerprint | undefined;
}): GhostFace {
  return {
    samples: f.samples,
    ...(f.clear.length > 0 ? { clear: f.clear } : {}),
    ...(f.fingerprint ? { fingerprint: f.fingerprint } : {}),
  };
}

/** Paint per face for the sidecar: whole triangles as runs, cut ones as pieces. */
function facePaint(
  faces: ReadonlyMap<number, { whole: number[]; pieces: PaintPieces[] }>,
): MarkerData['paint']['faces'] {
  return [...faces]
    .sort((a, b) => a[0] - b[0])
    .map(([faceId, f]) => {
      const whole = [...new Set(f.whole)].sort((a, b) => a - b);
      const taken = new Set(whole);
      const pieces = f.pieces.filter((p) => !taken.has(p.triangle) && taken.add(p.triangle));
      return {
        faceId,
        triangles: toRuns(whole),
        ...(pieces.length > 0 ? { pieces: pieces.sort((a, b) => a.triangle - b.triangle) } : {}),
      };
    });
}

// --- Marker items ------------------------------------------------------------------------------

interface EntityItem {
  readonly kind: MarkerEntityData['kind'];
  readonly seq: number;
  readonly fp: EntityFingerprint | undefined;
  /** Old body index (fingerprint `body`); undefined = unknown. */
  readonly body: number | undefined;
  /** From the marker's ghost (not placed on the previous version). */
  readonly ghost: boolean;
}

interface PaintGroup {
  readonly samples: readonly V3[];
  /** Points just outside the paint (none in older sidecars). */
  readonly clear: readonly V3[];
  readonly fp: EntityFingerprint | undefined;
  readonly body: number | undefined;
  readonly ghost: boolean;
}

function markerItems(mk: MarkerData): { groups: PaintGroup[]; entities: EntityItem[] } {
  const entities = mk.entities.map((e): EntityItem => ({
    kind: e.kind,
    seq: e.seq,
    fp: e.fingerprint,
    body: e.kind === 'body' ? (e.fingerprint?.body ?? e.id) : e.fingerprint?.body,
    ghost: false,
  }));
  const groups: PaintGroup[] = [];
  for (const f of mk.paint.faces) {
    if (!f.samples?.length) continue;
    groups.push({
      samples: points(f.samples),
      clear: points(f.clear ?? []),
      fp: f.fingerprint,
      body: f.fingerprint?.body,
      ghost: false,
    });
  }
  // Older sidecars: one list of triangle centres for the whole marker, no face or body.
  if (groups.length === 0 && mk.paint.samples?.length)
    groups.push({
      samples: points(mk.paint.samples),
      clear: [],
      fp: undefined,
      body: undefined,
      ghost: false,
    });
  // What could not be placed on the previous version is tried again.
  for (const e of mk.transfer?.ghost?.entities ?? [])
    entities.push({
      kind: e.kind,
      seq: 0,
      fp: e,
      body: e.kind === 'body' ? e.body : e.body,
      ghost: true,
    });
  for (const f of mk.transfer?.ghost?.faces ?? [])
    groups.push({
      samples: points(f.samples),
      clear: points(f.clear ?? []),
      fp: f.fingerprint,
      body: f.fingerprint?.body,
      ghost: true,
    });
  return { groups, entities };
}

const points = (flat: readonly number[]): V3[] => {
  const out: V3[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push(at3(flat, i / 3));
  return out;
};

function combine(s: readonly TransferStatus[]): TransferStatus {
  if (s.length === 0 || s.every((x) => x === 'found')) return 'found';
  if (s.includes('check')) return 'check';
  if (s.every((x) => x === 'lost')) return 'lost';
  return 'changed';
}

// --- Bodies ------------------------------------------------------------------------------------

/** Old body index → new body index (name, then size, then nearest). */
export function matchBodies(
  old: readonly BodyFingerprint[] | undefined,
  now: readonly BodyFingerprint[],
): Map<number, number> {
  const map = new Map<number, number>();
  // No fingerprints (sidecar before T6.2): same index when the count fits.
  if (!old) {
    for (let b = 0; b < now.length; b++) map.set(b, b);
    return map;
  }
  const used = new Set<number>();
  const free = (pred: (n: BodyFingerprint) => boolean): number[] =>
    now.flatMap((n, j) => (!used.has(j) && pred(n) ? [j] : []));
  const nearest = (o: BodyFingerprint, js: readonly number[]): number | undefined => {
    let best: number | undefined;
    let bestD = Infinity;
    for (const j of js) {
      const n = now[j];
      if (!n) continue;
      const d = len(sub(n.centre, o.centre));
      if (d < bestD) [best, bestD] = [j, d];
    }
    return best;
  };
  // Names first for every body (so a renamed body can't take another's place by size).
  const pending: number[] = [];
  old.forEach((o, i) => {
    const named = free((n) => n.name === o.name && (n.path ?? '') === (o.path ?? ''));
    const named2 = named.length > 0 ? named : free((n) => n.name === o.name);
    const pick =
      named2.length <= 1
        ? named2[0]
        : nearest(o, sameSize(o, named2).length ? sameSize(o, named2) : named2);
    if (pick === undefined) pending.push(i);
    else {
      map.set(i, pick);
      used.add(pick);
    }
  });
  for (const i of pending) {
    const o = old[i];
    if (!o) continue;
    const pick = nearest(
      o,
      sameSize(
        o,
        free(() => true),
      ),
    );
    if (pick === undefined) continue;
    map.set(i, pick);
    used.add(pick);
  }
  return map;

  function sameSize(o: BodyFingerprint, js: readonly number[]): number[] {
    const os = [...o.size].sort((a, b) => a - b);
    return js.filter((j) => {
      const n = now[j];
      if (!n) return false;
      const ns = [...n.size].sort((a, b) => a - b);
      return close(n.area, o.area) && ns.every((x, k) => close(x, os[k] ?? 0));
    });
  }
}

const close = (a: number, b: number, share = SIZE_SHARE, abs = 0.01): boolean =>
  Math.abs(a - b) <= Math.max(abs, share * Math.max(Math.abs(a), Math.abs(b)));

function remapBodyTree(
  tree: BodyTreeData | undefined,
  map: ReadonlyMap<number, number>,
  bodyCount: number,
): BodyTreeData | undefined {
  if (!tree) return undefined;
  const identity = [...map].every(([a, b]) => a === b) && map.size === bodyCount;
  return {
    folders: tree.folders,
    bodies: tree.bodies.flatMap((r) => {
      const b = map.get(r.body);
      return b === undefined ? [] : [{ ...r, body: b }];
    }),
    // Assemblies have no fingerprints: kept only while every body kept its place.
    assemblies: identity ? tree.assemblies : [],
  };
}

// --- Transforms --------------------------------------------------------------------------------

/** p ↦ r · (p − from) + to; `r` row-major 3 × 3 (a signed permutation). */
interface Transform {
  readonly r: readonly number[];
  readonly from: V3;
  readonly to: V3;
}

const IDENTITY: Transform = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], from: [0, 0, 0], to: [0, 0, 0] };

const rot = (r: readonly number[], v: V3): V3 => [
  (r[0] ?? 0) * v[0] + (r[1] ?? 0) * v[1] + (r[2] ?? 0) * v[2],
  (r[3] ?? 0) * v[0] + (r[4] ?? 0) * v[1] + (r[5] ?? 0) * v[2],
  (r[6] ?? 0) * v[0] + (r[7] ?? 0) * v[1] + (r[8] ?? 0) * v[2],
];

function apply(t: Transform, p: V3): V3 {
  const q = rot(t.r, sub(p, t.from));
  return [q[0] + t.to[0], q[1] + t.to[1], q[2] + t.to[2]];
}

/** A fingerprint moved by `t`; `body` = its body's index on the new model (none: left out). */
function moveFp(fp: EntityFingerprint, t: Transform, body: number | undefined): EntityFingerprint {
  const out: EntityFingerprint = { ...fp };
  delete out.body;
  return {
    ...out,
    ...(body !== undefined ? { body } : {}),
    ...(fp.point ? { point: round3(apply(t, fp.point)) } : {}),
    ...(fp.dir ? { dir: round3(rot(t.r, fp.dir)) } : {}),
    ...(fp.bounds ? { bounds: moveBounds(fp.bounds, t) } : {}),
  };
}

/** A box moved by `t` (a signed permutation keeps it axis-aligned). */
function moveBounds(
  [lo, hi]: readonly [V3, V3],
  t: Transform,
): [[number, number, number], [number, number, number]] {
  const a = apply(t, lo);
  const b = apply(t, hi);
  return [
    round3([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]),
    round3([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]),
  ];
}

/** How far apart two boxes' corners are (sum over both corners). */
const boundsGap = (a: readonly [V3, V3], b: readonly [V3, V3]): number =>
  len(sub(a[0], b[0])) + len(sub(a[1], b[1]));

const round3 = (p: V3): [number, number, number] => [
  Math.round(p[0] * 1e4) / 1e4,
  Math.round(p[1] * 1e4) / 1e4,
  Math.round(p[2] * 1e4) / 1e4,
];

/** The 48 signed permutation matrices (24 turns, 24 mirrors), with their determinant. */
const SIGNED_PERMS: readonly { r: number[]; det: number }[] = (() => {
  const perms = [
    [0, 1, 2, 1],
    [0, 2, 1, -1],
    [1, 0, 2, -1],
    [1, 2, 0, 1],
    [2, 0, 1, 1],
    [2, 1, 0, -1],
  ];
  const out: { r: number[]; det: number }[] = [];
  for (const [p0, p1, p2, ps] of perms)
    for (let s = 0; s < 8; s++) {
      const signs = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
      const r = new Array<number>(9).fill(0);
      [p0, p1, p2].forEach((col, row) => {
        r[row * 3 + (col ?? 0)] = signs[row] ?? 1;
      });
      out.push({ r, det: (ps ?? 1) * (signs[0] ?? 1) * (signs[1] ?? 1) * (signs[2] ?? 1) });
    }
  return out;
})();

// --- The new model, per body -------------------------------------------------------------------

interface Hit {
  readonly t: number;
  readonly face: number;
  readonly d: number;
  readonly q: V3;
}

class Context {
  private readonly bodies = new Map<number, BodyData>();
  /** Triangles of each face, in order (counting sort over `triangleFace`). */
  readonly faceTriStart: Uint32Array;
  readonly faceTris: Uint32Array;

  constructor(
    readonly m: TransferModel,
    readonly fingerprints: readonly BodyFingerprint[],
  ) {
    const faces = m.faceBody.length;
    const count = new Uint32Array(faces + 1);
    for (let t = 0; t < m.triangleFace.length; t++) {
      const f = m.triangleFace[t] ?? 0;
      if (f < faces) count[f + 1] = (count[f + 1] ?? 0) + 1;
    }
    for (let f = 0; f < faces; f++) count[f + 1] = (count[f + 1] ?? 0) + (count[f] ?? 0);
    this.faceTriStart = count;
    this.faceTris = new Uint32Array(m.triangleFace.length);
    const at = count.slice();
    for (let t = 0; t < m.triangleFace.length; t++) {
      const f = m.triangleFace[t] ?? 0;
      if (f >= faces) continue;
      const i = at[f] ?? 0;
      this.faceTris[i] = t;
      at[f] = i + 1;
    }
  }

  trisOf(face: number): Uint32Array {
    return this.faceTris.subarray(this.faceTriStart[face] ?? 0, this.faceTriStart[face + 1] ?? 0);
  }

  /** Body `b` of the new model; -1 = the whole model (older sidecars, body unknown). */
  body(b: number): BodyData {
    let d = this.bodies.get(b);
    if (!d) this.bodies.set(b, (d = new BodyData(this, b)));
    return d;
  }
}

class BodyData {
  readonly faces: number[] = [];
  readonly size: V3;
  readonly centre: V3;
  /** Largest bbox side: tolerances scale with it. */
  readonly extent: number;
  private grid: TriangleGrid | undefined;
  private readonly prints = new Map<string, Map<number, EntityFingerprint>>();

  constructor(
    readonly ctx: Context,
    readonly index: number,
  ) {
    const m = ctx.m;
    for (let f = 0; f < m.faceBody.length; f++)
      if (index < 0 || m.faceBody[f] === index) this.faces.push(f);
    const fp = ctx.fingerprints[index];
    if (fp) {
      this.size = fp.size;
      this.centre = fp.centre;
    } else {
      // The whole model (older sidecars): its bounding box.
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.positions.length; i++) {
        const k = i % 3;
        lo[k] = Math.min(lo[k] ?? 0, m.positions[i] ?? 0);
        hi[k] = Math.max(hi[k] ?? 0, m.positions[i] ?? 0);
      }
      const ok = lo.every(Number.isFinite);
      this.size = ok ? [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] : [0, 0, 0];
      this.centre = ok
        ? [(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, (hi[2] + lo[2]) / 2]
        : [0, 0, 0];
    }
    this.extent = Math.max(...this.size, 0);
  }

  get tolFound(): number {
    return Math.max(FOUND_MM, FOUND_SHARE * this.extent);
  }
  get tolChanged(): number {
    return Math.max(CHANGED_MM, CHANGED_SHARE * this.extent);
  }

  /** Fingerprints of this body's entities of one kind (faces: one mesh pass for all). */
  printsOf(kind: 'face' | 'edge' | 'vertex'): Map<number, EntityFingerprint> {
    let map = this.prints.get(kind);
    if (map) return map;
    const m = this.ctx.m;
    let ids: number[];
    if (kind === 'face') ids = this.faces;
    else {
      const owner = kind === 'edge' ? m.edgeBody : m.vertexBody;
      ids = [];
      for (let i = 0; i < owner.length; i++)
        if (this.index < 0 || owner[i] === this.index) ids.push(i);
    }
    const refs: EntityRef[] = ids.map((id) => ({ kind, id }));
    const fps = entityFingerprints(m, refs);
    map = new Map(ids.map((id, i) => [id, fps[i] ?? {}]));
    this.prints.set(kind, map);
    return map;
  }

  /** Nearest point on this body's mesh within `maxD`, on faces `ok` allows. */
  nearest(p: V3, maxD: number, ok: (face: number) => boolean): Hit | undefined {
    this.grid ??= new TriangleGrid(
      this.ctx,
      this.faces,
      Math.max(this.tolChanged, this.extent / 96),
    );
    return this.grid.nearest(p, maxD, ok);
  }

  /** Distance from `p` to one face's mesh. */
  faceDistance(face: number, p: V3): number {
    let d = Infinity;
    for (const t of this.ctx.trisOf(face))
      d = Math.min(d, len(sub(p, closestOnTriangle(this.ctx.m, t, p))));
    return d;
  }
}

/** Uniform grid of triangles for nearest-surface queries. */
class TriangleGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    private readonly ctx: Context,
    faces: readonly number[],
    private readonly h: number,
  ) {
    const m = ctx.m;
    for (const f of faces)
      for (const t of ctx.trisOf(f)) {
        const ps = [0, 1, 2].map((k) => at3(m.positions, m.indices[t * 3 + k] ?? 0));
        const lo = [0, 1, 2].map((i) => Math.floor(Math.min(...ps.map((q) => q[i] ?? 0)) / h));
        const hi = [0, 1, 2].map((i) => Math.floor(Math.max(...ps.map((q) => q[i] ?? 0)) / h));
        for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
          for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
            for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++) {
              const key = cellKey(x, y, z);
              const list = this.cells.get(key);
              if (list) list.push(t);
              else this.cells.set(key, [t]);
            }
      }
  }

  nearest(p: V3, maxD: number, ok: (face: number) => boolean): Hit | undefined {
    const m = this.ctx.m;
    const h = this.h;
    const lo = p.map((x) => Math.floor((x - maxD) / h));
    const hi = p.map((x) => Math.floor((x + maxD) / h));
    let best: Hit | undefined;
    const seen = new Set<number>();
    for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
      for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
        for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++)
          for (const t of this.cells.get(cellKey(x, y, z)) ?? []) {
            if (seen.has(t)) continue;
            seen.add(t);
            const face = m.triangleFace[t] ?? 0;
            if (!ok(face)) continue;
            const q = closestOnTriangle(m, t, p);
            const d = len(sub(p, q));
            if (d <= maxD && (!best || d < best.d)) best = { t, face, d, q };
          }
    return best;
  }
}

const cellKey = (x: number, y: number, z: number): number =>
  ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;

/** Closest point on triangle `t` to `p` (Ericson, "Real-Time Collision Detection" 5.1.5). */
function closestOnTriangle(m: InfoModel, t: number, p: V3): V3 {
  const a = at3(m.positions, m.indices[t * 3] ?? 0);
  const b = at3(m.positions, m.indices[t * 3 + 1] ?? 0);
  const c = at3(m.positions, m.indices[t * 3 + 2] ?? 0);
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = va + vb + vc;
  if (denom === 0) return a;
  const v = vb / denom;
  const w = vc / denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

const along = (a: V3, d: V3, s: number): V3 => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];

function polylineDistance(m: InfoModel, edge: number, p: V3): number {
  const first = m.edgeRanges[edge * 2] ?? 0;
  const count = m.edgeRanges[edge * 2 + 1] ?? 0;
  if (count === 1) return len(sub(p, at3(m.edgePoints, first)));
  let d = Infinity;
  for (let i = 0; i + 1 < count; i++) {
    const a = at3(m.edgePoints, first + i);
    const ab = sub(at3(m.edgePoints, first + i + 1), a);
    const l2 = dot(ab, ab);
    const s = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
    d = Math.min(d, len(sub(p, along(a, ab, s))));
  }
  return d;
}

// --- Lining a body up --------------------------------------------------------------------------

interface Alignment {
  readonly body: BodyData;
  readonly t: Transform;
  /** The new body is a mirror image of the old one: its markers are "check". */
  readonly mirrored: boolean;
  /** Old body's bounding box moved by `t` (for "moved with a side of the box"). */
  readonly oldBox: { lo: V3; hi: V3 } | undefined;
}

function align(
  body: BodyData,
  oldFp: BodyFingerprint | undefined,
  markers: readonly { groups: PaintGroup[]; entities: EntityItem[] }[],
  oldBody: number,
): Alignment {
  const make = (t: Transform, mirrored: boolean): Alignment => ({
    body,
    t,
    mirrored,
    oldBox: oldFp && boxOf(oldFp, t),
  });
  if (!oldFp) return make(IDENTITY, false);
  const groups = markers.flatMap((mk) => mk.groups.filter((g) => g.body === oldBody));
  const entities = markers.flatMap((mk) => mk.entities.filter((e) => e.body === oldBody));
  const tol = body.tolFound;
  const fit = (t: Transform): number => {
    const a = make(t, false);
    let n = 0;
    for (const g of groups)
      for (const p of every(g.samples, PROBE_SAMPLES)) {
        const hit = body.nearest(apply(t, p), tol, faceFilter(a, g.fp));
        if (hit) n++;
      }
    for (const e of entities) {
      if (e.kind === 'body' || !e.fp) continue;
      const best = candidates(e, a)[0];
      if (best && best.d <= tol) n++;
    }
    return n;
  };
  const tolSize = (a: number, b: number): boolean =>
    Math.abs(a - b) <= Math.max(tol, SIZE_SHARE * Math.max(a, b));
  const sizeFits = (r: readonly number[]): boolean =>
    rot(r, oldFp.size)
      .map(Math.abs)
      .every((s, i) => tolSize(s, body.size[i] ?? 0));
  // On equal fit (few marks, e.g. one stroke on a flat top fits a turned part both ways): the
  // candidate whose box lands on the new box wins, then turns before mirrors (a mirror image of a
  // symmetric part is the same part), then keeping it in place.
  const inPlace = sizeFits(IDENTITY.r) && len(sub(oldFp.centre, body.centre)) <= body.tolChanged;
  /**
   * How far the marked faces' and entities' centres land from the nearest alike new one (summed):
   * tells turns apart that put every sample on the surface (a stroke on a flat top fits several),
   * as a face's centre moves with its holes and cut-outs.
   */
  const err = (t: Transform): number => {
    const a = make(t, false);
    let e = 0;
    const probe = (item: EntityItem): void => {
      if (!item.fp?.point || item.kind === 'body') return;
      e += Math.min(
        candidates(item, a, undefined, body.tolChanged)[0]?.d ?? body.tolChanged,
        body.tolChanged,
      );
    };
    // Painted faces: centre to the nearest alike face's centre (a plane's centre, not its surface).
    const faces = body.printsOf('face');
    for (const g of groups) {
      const fp = g.fp;
      if (!fp?.point) continue;
      const p = apply(t, fp.point);
      const dir = fp.dir && rot(t.r, fp.dir);
      let d = body.tolChanged;
      for (const n of faces.values())
        if (n.point && n.type === fp.type && dirOk(fp.type, dir, n.dir))
          d = Math.min(d, len(sub(n.point, p)));
      e += d;
    }
    for (const it of entities) probe(it);
    return e;
  };
  /**
   * How far the marked faces' outline boxes land from the nearest alike new face's box (summed):
   * robust to a rib or hole inside the face, unlike its centre.
   */
  const boundsErr = (t: Transform): number => {
    const faces = body.printsOf('face');
    let e = 0;
    const faceFps = [
      ...groups.map((g) => g.fp),
      ...entities.filter((it) => it.kind === 'face').map((it) => it.fp),
    ];
    for (const fp of faceFps) {
      if (!fp?.bounds) continue;
      const moved = moveBounds(fp.bounds, t);
      const dir = fp.dir && rot(t.r, fp.dir);
      let d = body.tolChanged;
      for (const n of faces.values())
        if (n.bounds && n.type === fp.type && dirOk(fp.type, dir, n.dir))
          d = Math.min(d, boundsGap(moved, n.bounds));
      e += d;
    }
    return e;
  };
  // Centres are exact mesh numbers: a few hundredths of a mm tell a hole's side apart (last resort:
  // a rib or cut-out added inside the face shifts its centre too).
  const errTol = Math.max(0.02, 1e-4 * body.extent);
  const scoreOf = (t: Transform, box: boolean, det: number) => ({
    t,
    score: fit(t),
    bounds: boundsErr(t),
    err: err(t),
    box,
    det,
  });
  let best = scoreOf(IDENTITY, inPlace, 1);
  const better = (c: typeof best): boolean =>
    c.score !== best.score
      ? c.score > best.score
      : Math.abs(c.bounds - best.bounds) > tol
        ? c.bounds < best.bounds
        : c.box !== best.box
          ? c.box
          : Math.abs(c.err - best.err) > errTol
            ? c.err < best.err
            : c.det > best.det;
  for (const { r, det } of SIGNED_PERMS) {
    if (!sizeFits(r)) continue;
    const t: Transform = { r, from: oldFp.centre, to: body.centre };
    const c = scoreOf(t, true, det);
    if (better(c)) best = c;
  }
  return make(best.t, best.det < 0);
}

function boxOf(fp: BodyFingerprint, t: Transform): { lo: V3; hi: V3 } {
  const c = apply(t, fp.centre);
  const s = rot(t.r, fp.size);
  const h = (i: 0 | 1 | 2): number => Math.abs(s[i]) / 2;
  return {
    lo: [c[0] - h(0), c[1] - h(1), c[2] - h(2)],
    hi: [c[0] + h(0), c[1] + h(1), c[2] + h(2)],
  };
}

/** Up to `n` items spread over the list. */
function every<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  const step = list.length / n;
  return Array.from({ length: n }, (_, k) => list[Math.floor(k * step)] as T);
}

/** The old point moved with whichever sides of the body's box it lay on (zero if none moved). */
function followBox(a: Alignment, p: V3): V3 | undefined {
  const box = a.oldBox;
  if (!box) return undefined;
  const tol = a.body.tolFound;
  const { centre, size } = a.body;
  const shift: [number, number, number] = [0, 0, 0];
  for (const i of [0, 1, 2] as const) {
    const lo = centre[i] - size[i] / 2;
    const hi = centre[i] + size[i] / 2;
    if (Math.abs(p[i] - box.hi[i]) <= tol) shift[i] = hi - box.hi[i];
    else if (Math.abs(p[i] - box.lo[i]) <= tol) shift[i] = lo - box.lo[i];
  }
  return shift.every((s) => Math.abs(s) <= tol) ? undefined : shift;
}

// --- Entities ----------------------------------------------------------------------------------

/** Same-type entities of the body with the right direction, nearest first (within "changed"). */
function candidates(
  e: EntityItem,
  a: Alignment,
  at?: V3,
  maxD = a.body.tolChanged,
): { id: number; d: number; fp: EntityFingerprint }[] {
  const fp = e.fp;
  if (!fp?.point || e.kind === 'body') return [];
  const p = at ?? apply(a.t, fp.point);
  const dir = fp.dir && rot(a.t.r, fp.dir);
  const m = a.body.ctx.m;
  const out: { id: number; d: number; fp: EntityFingerprint }[] = [];
  for (const [id, nfp] of a.body.printsOf(e.kind)) {
    if (e.kind !== 'vertex' && nfp.type !== fp.type) continue;
    if (!dirOk(fp.type, dir, nfp.dir)) continue;
    let d: number;
    if (!nfp.point) continue;
    // Quick reject by the centre / midpoint before the exact distance.
    if (e.kind === 'face' && fp.type === 'plane') {
      d = a.body.faceDistance(id, p);
    } else if (e.kind === 'edge') {
      d = polylineDistance(m, id, p);
    } else d = len(sub(nfp.point, p));
    if (d <= maxD) out.push({ id, d, fp: nfp });
  }
  return out.sort((x, y) => x.d - y.d);
}

function dirOk(
  type: string | undefined,
  a: V3 | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (!a || !b) return true;
  const c =
    dot(a, [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0]) /
    (len(a) * Math.hypot(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0) || 1);
  // A plane's normal keeps its side; an axis or line may point either way.
  return type === 'plane' ? c >= COS_DIR : Math.abs(c) >= COS_DIR;
}

function sameSize(a: EntityFingerprint, b: EntityFingerprint, strict = false): boolean {
  const eq = (x: number | undefined, y: number | undefined, abs: number, share: number): boolean =>
    x === undefined || y === undefined || Math.abs(x - y) <= Math.max(abs, share * Math.max(x, y));
  return (
    eq(a.radius, b.radius, 0.01, 0.01) &&
    eq(a.minorRadius, b.minorRadius, 0.01, 0.01) &&
    eq(a.halfAngle, b.halfAngle, 0.5, 0) &&
    eq(a.length, b.length, 0.05, 0.01) &&
    (!strict || eq(a.area, b.area, 0.05, 0.02))
  );
}

function matchEntity(
  e: EntityItem,
  a: Alignment,
): { id: number; status: 'found' | 'changed' } | undefined {
  if (e.kind === 'body') {
    return a.body.index >= 0 ? { id: a.body.index, status: 'found' } : undefined;
  }
  const fp = e.fp;
  if (!fp?.point) return undefined;
  const near = candidates(e, a);
  const first = near[0];
  const tol = a.body.tolFound;
  if (first && first.d <= tol)
    return { id: first.id, status: sameSize(fp, first.fp) ? 'found' : 'changed' };
  // One clear candidate a little further away (a moved wall, a resized hole).
  const second = near[1];
  if (first && (!second || second.d > first.d * 1.5 + tol))
    return { id: first.id, status: 'changed' };
  if (first) return undefined; // several equally near (an edge split by a fillet): can't tell
  // Shifted: moved with a side of the box (a longer plate's end), or the only one of its kind.
  const shift = followBox(a, apply(a.t, fp.point));
  if (shift) {
    const p = apply(a.t, fp.point);
    const moved = candidates(e, a, [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]], tol)[0];
    if (moved && sameSize(fp, moved.fp)) return { id: moved.id, status: 'changed' };
  }
  const alike = candidates(e, a, undefined, Infinity).filter((c) => sameSize(fp, c.fp, true));
  if (alike.length === 1 && alike[0]) return { id: alike[0].id, status: 'changed' };
  return undefined;
}

// --- Paint -------------------------------------------------------------------------------------

/** Faces a paint group may land on: same type and direction as the painted face. */
function faceFilter(a: Alignment, fp: EntityFingerprint | undefined): (face: number) => boolean {
  if (!fp?.type) return () => true;
  const dir = fp.dir && rot(a.t.r, fp.dir);
  const prints = a.body.printsOf('face');
  return (f) => {
    const n = prints.get(f);
    return n !== undefined && n.type === fp.type && dirOk(fp.type, dir, n.dir);
  };
}

/** Paint of one face group moved onto the new model: whole triangles and cut ones per face. */
type MovedPaint = Map<number, { whole: number[]; pieces: PaintPieces[] }>;
type Root = PaintPieces['tree'];

function movePaint(
  g: PaintGroup,
  a: Alignment,
): { status: 'found' | 'changed'; faces: MovedPaint } | undefined {
  const ok = faceFilter(a, g.fp);
  const body = a.body;
  let moved = g.samples.map((p) => apply(a.t, p));
  let clear = g.clear.map((p) => apply(a.t, p));
  const land = (pts: readonly V3[], maxD: number, on = ok): Hit[] =>
    pts.flatMap((p) => {
      const h = body.nearest(p, maxD, on);
      return h ? [h] : [];
    });
  const n = moved.length;
  let hits = land(moved, body.tolChanged);
  let status: 'found' | 'changed';
  let reach = body.tolChanged;
  if (n > 0 && hits.filter((h) => h.d <= body.tolFound).length >= 0.8 * n) status = 'found';
  else if (n > 0 && hits.length >= 0.5 * n) status = 'changed';
  else {
    const shift = shiftPaint(g, a, moved);
    if (!shift) return undefined;
    const by = (ps: readonly V3[]): V3[] =>
      ps.map((p) => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]]);
    moved = by(moved);
    clear = by(clear);
    reach = body.tolFound * 2;
    hits = land(moved, reach);
    if (hits.length < 0.5 * n) return undefined;
    status = 'changed';
  }
  // Only faces that took a fair share (a rib's side under a few samples takes nothing).
  const perFace = new Map<number, number>();
  for (const h of hits) perFace.set(h.face, (perFace.get(h.face) ?? 0) + 1);
  const keep = new Set([...perFace].filter(([, c]) => c >= 0.1 * hits.length).map(([f]) => f));
  const pos = hits.filter((h) => keep.has(h.face)).map((h) => h.q);
  const neg = land(clear, reach, (f) => keep.has(f)).map((h) => h.q);
  return { status, faces: rebuildPaint(body, keep, pos, neg, spacing(g.samples)) };
}

/** How far the group's samples move when its face shifted as a whole (see `matchEntity`). */
function shiftPaint(g: PaintGroup, a: Alignment, moved: readonly V3[]): V3 | undefined {
  const centre = g.fp?.point ? apply(a.t, g.fp.point) : mean(moved);
  const box = followBox(a, centre);
  if (box) return box;
  if (!g.fp?.point) return undefined;
  const e: EntityItem = { kind: 'face', seq: 0, fp: g.fp, body: g.body, ghost: false };
  const alike = candidates(e, a, undefined, Infinity).filter(
    (c) => g.fp && sameSize(g.fp, c.fp, true),
  );
  const only = alike.length === 1 ? alike[0] : undefined;
  if (!only?.fp.point) return undefined;
  return sub(only.fp.point, centre);
}

const mean = (ps: readonly V3[]): V3 => {
  const s = [0, 0, 0];
  for (const p of ps) for (let i = 0; i < 3; i++) s[i] = (s[i] ?? 0) + (p[i] ?? 0) / ps.length;
  return [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0];
};

/** Typical distance between neighbouring samples (median nearest neighbour). */
function spacing(samples: readonly V3[]): number {
  if (samples.length < 2) return 1;
  const pts = every(samples, 400);
  const d = pts
    .map((p, i) => {
      let best = Infinity;
      pts.forEach((q, j) => {
        if (j !== i) best = Math.min(best, len(sub(p, q)));
      });
      return best;
    })
    .sort((x, y) => x - y);
  // Thinned samples (every k-th) are further apart than the real ones: the median still fits.
  return d[Math.floor(d.length / 2)] ?? 1;
}

/** Deepest cut when rebuilding paint (the brush allows 14; pieces stay ≥ half a spacing). */
const MAX_REBUILD_DEPTH = 12;
/** Nearest points that vote on a spot's paint. */
const VOTES = 5;

/**
 * Paint on faces `keep` from landed painted points `pos` and landed clear points `neg` (where the
 * paint ended): each spot takes the state most of its 5 nearest points (within 2 spacings) have, so an outline
 * comes back where it was instead of growing. Triangles are cut into pieces (as the brush does)
 * down to half a spacing, only where the paint's edge runs through them.
 */
function rebuildPaint(
  body: BodyData,
  keep: ReadonlySet<number>,
  pos: readonly V3[],
  neg: readonly V3[],
  gap: number,
): MovedPaint {
  const r = Math.max(gap * 2, 1e-3);
  const minEdge = Math.max(gap / 2, 1e-4);
  const grid = new Map<number, { p: V3; on: boolean }[]>();
  const add = (p: V3, on: boolean): void => {
    const k = cellKey(Math.floor(p[0] / r), Math.floor(p[1] / r), Math.floor(p[2] / r));
    const list = grid.get(k);
    if (list) list.push({ p, on });
    else grid.set(k, [{ p, on }]);
  };
  for (const p of pos) add(p, true);
  for (const p of neg) add(p, false);
  const all = [...pos.map((p) => ({ p, on: true })), ...neg.map((p) => ({ p, on: false }))];
  type Pt = { p: V3; on: boolean };
  const box = (a: V3, b: V3, c: V3): { lo: V3; hi: V3 } => ({
    lo: [
      Math.min(a[0], b[0], c[0]) - r,
      Math.min(a[1], b[1], c[1]) - r,
      Math.min(a[2], b[2], c[2]) - r,
    ],
    hi: [
      Math.max(a[0], b[0], c[0]) + r,
      Math.max(a[1], b[1], c[1]) + r,
      Math.max(a[2], b[2], c[2]) + r,
    ],
  });
  const inside = (q: V3, bx: { lo: V3; hi: V3 }): boolean =>
    q[0] >= bx.lo[0] &&
    q[0] <= bx.hi[0] &&
    q[1] >= bx.lo[1] &&
    q[1] <= bx.hi[1] &&
    q[2] >= bx.lo[2] &&
    q[2] <= bx.hi[2];
  /** Points within `r` of the box around a triangle: from the grid for small ones, else all. */
  const fetch = (a: V3, b: V3, c: V3): Pt[] => {
    const bx = box(a, b, c);
    const lo = bx.lo.map((x) => Math.floor(x / r));
    const hi = bx.hi.map((x) => Math.floor(x / r));
    const cells =
      ((hi[0] ?? 0) - (lo[0] ?? 0) + 1) *
      ((hi[1] ?? 0) - (lo[1] ?? 0) + 1) *
      ((hi[2] ?? 0) - (lo[2] ?? 0) + 1);
    if (cells > all.length) return all.filter((q) => inside(q.p, bx));
    const out: Pt[] = [];
    const seen = new Set<number>();
    for (let x = lo[0] ?? 0; x <= (hi[0] ?? 0); x++)
      for (let y = lo[1] ?? 0; y <= (hi[1] ?? 0); y++)
        for (let z = lo[2] ?? 0; z <= (hi[2] ?? 0); z++) {
          const k = cellKey(x, y, z);
          if (seen.has(k)) continue;
          seen.add(k);
          for (const q of grid.get(k) ?? []) if (inside(q.p, bx)) out.push(q);
        }
    return out;
  };
  /**
   * Painted at `p`: most of its nearest points (up to {@link VOTES}, within r) are painted ones —
   * a majority, so a stray speck doesn't come back larger on every version.
   */
  const stateAt = (p: V3, near: readonly Pt[]): boolean => {
    const ds: number[] = [];
    const on: boolean[] = [];
    const r2 = r * r;
    for (const q of near) {
      const dx = q.p[0] - p[0];
      const dy = q.p[1] - p[1];
      const dz = q.p[2] - p[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) continue;
      // Keep the VOTES nearest, sorted.
      let k = ds.length;
      if (k === VOTES && d >= (ds[k - 1] ?? Infinity)) continue;
      if (k === VOTES) {
        ds.pop();
        on.pop();
        k--;
      }
      while (k > 0 && (ds[k - 1] ?? 0) > d) k--;
      ds.splice(k, 0, d);
      on.splice(k, 0, q.on);
    }
    const yes = on.filter(Boolean).length;
    return yes * 2 === on.length ? (on[0] ?? false) : yes * 2 > on.length;
  };
  const classify = (a: V3, b: V3, c: V3, depth: number, from: readonly Pt[]): PieceTree => {
    let near = from;
    if (depth > 0) {
      const lx = Math.min(a[0], b[0], c[0]) - r;
      const ly = Math.min(a[1], b[1], c[1]) - r;
      const lz = Math.min(a[2], b[2], c[2]) - r;
      const hx = Math.max(a[0], b[0], c[0]) + r;
      const hy = Math.max(a[1], b[1], c[1]) + r;
      const hz = Math.max(a[2], b[2], c[2]) + r;
      const kept: Pt[] = [];
      for (const q of from) {
        const [x, y, z] = q.p;
        if (x >= lx && x <= hx && y >= ly && y <= hy && z >= lz && z <= hz) kept.push(q);
      }
      near = kept;
    }
    const cen: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    // The whole piece is on one side when, for every point in it, the nearest painted point is
    // clearly nearer (and within r) than any clear point — or the other way round.
    const rho = Math.max(len(sub(a, cen)), len(sub(b, cen)), len(sub(c, cen)));
    let dPos = Infinity;
    let dNeg = Infinity;
    for (const q of near) {
      const dx = q.p[0] - cen[0];
      const dy = q.p[1] - cen[1];
      const dz = q.p[2] - cen[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (q.on) {
        if (d < dPos) dPos = d;
      } else if (d < dNeg) dNeg = d;
    }
    if (dPos === Infinity) return 0;
    dPos = Math.sqrt(dPos);
    dNeg = Math.sqrt(dNeg);
    // Uniform when every point of the piece has a painted point within r and no clear one (or
    // the other way round): then all its votes agree.
    if (dPos + rho <= r && dNeg - rho > r) return 1;
    if (dPos - rho > r) return 0;
    const longest = Math.max(len(sub(b, a)), len(sub(c, b)), len(sub(a, c)));
    if (depth >= MAX_REBUILD_DEPTH || longest <= minEdge) return stateAt(cen, near) ? 1 : 0;
    const ab = halfway(a, b);
    const bc = halfway(b, c);
    const ca = halfway(c, a);
    const kids: [PieceTree, PieceTree, PieceTree, PieceTree] = [
      classify(a, ab, ca, depth + 1, near),
      classify(ab, b, bc, depth + 1, near),
      classify(ca, bc, c, depth + 1, near),
      classify(ab, bc, ca, depth + 1, near),
    ];
    if (kids.every((k) => k === 0)) return 0;
    if (kids.every((k) => k === 1)) return 1;
    return kids;
  };
  const m = body.ctx.m;
  const out: MovedPaint = new Map();
  for (const f of keep) {
    const whole: number[] = [];
    const pieces: PaintPieces[] = [];
    for (const t of body.ctx.trisOf(f)) {
      const a = at3(m.positions, m.indices[t * 3] ?? 0);
      const b = at3(m.positions, m.indices[t * 3 + 1] ?? 0);
      const c = at3(m.positions, m.indices[t * 3 + 2] ?? 0);
      const tree = classify(a, b, c, 0, fetch(a, b, c));
      if (tree === 1) whole.push(t);
      else if (tree !== 0) pieces.push({ triangle: t, tree: [...tree] as Root });
    }
    if (whole.length + pieces.length > 0) out.set(f, { whole, pieces });
  }
  return out;
}

const halfway = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

// --- Mesh → STEP (T9.2) ------------------------------------------------------------------------

export interface MeshTransferResult extends TransferResult {
  readonly coverage: MeshCoverage;
}

/** Mesh surface points tried per turn when lining the files up. */
const MESH_PROBES = 1500;
/** A mirror must fit this share of the probes better than the best turn. */
const MIRROR_MARGIN = 0.02;

/**
 * Moves the annotations of a mesh file (STL / 3MF, mesh-only mode, T9.1) onto a STEP model of the
 * same part (T9.2). The two files may lie differently (an STL is often turned Y-up and moved), so
 * the whole mesh is lined up with the whole STEP model first: each of the 24 turns in 90° steps
 * that fits the bounding box (mirrors only when clearly better) is scored by how many mesh points
 * land on the STEP surface, then the position is nudged until the surfaces sit on each other. One
 * transform for the file (parts moved apart on a slicer plate are not lined up one by one).
 * Then each painted sample goes to the nearest STEP triangle, on any face (a stroke may cross
 * many CAD faces), and the paint is rebuilt from the landed points as in `transferAnnotations`.
 * Per marker: found when ≥ 80 % of its points land within the "found" distance, changed when
 * ≥ 50 % land within the "changed" distance, else lost (a ghost where the mesh put it).
 *
 * `mesh` = the mesh file's own triangles (a better fit); without it the paint points and the
 * sidecar's body boxes are all there is.
 */
export function transferMeshAnnotations(
  old: Annotations,
  m: TransferModel,
  mesh?: { readonly positions: ArrayLike<number>; readonly indices: ArrayLike<number> },
): MeshTransferResult {
  const newBodies = bodyFingerprints(m, m.bodyCount);
  const ctx = new Context(m, newBodies);
  const whole = ctx.body(-1);
  const tol = whole.tolFound;
  const items = old.markers.map((mk) => markerItems(mk));
  const paintPoints = items.flatMap((it) => it.groups.flatMap((g) => [...g.samples, ...g.clear]));

  // The mesh file's box and the points used to line it up.
  let box: { lo: V3; hi: V3 } | undefined;
  let probes: V3[];
  if (mesh && mesh.indices.length >= 3) {
    box = boundsOf(mesh.positions);
    const n = Math.floor(mesh.indices.length / 3);
    const step = Math.max(1, Math.floor(n / MESH_PROBES));
    probes = [];
    for (let t = 0; t < n; t += step) {
      const a = at3(mesh.positions, mesh.indices[t * 3] ?? 0);
      const b = at3(mesh.positions, mesh.indices[t * 3 + 1] ?? 0);
      const c = at3(mesh.positions, mesh.indices[t * 3 + 2] ?? 0);
      probes.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    }
  } else {
    // The box around the sidecar's body boxes.
    const corners: number[] = [];
    for (const b of old.bodies ?? [])
      for (const s of [-0.5, 0.5])
        corners.push(...b.centre.map((c, i) => c + s * (b.size[i] ?? 0)));
    box = boundsOf(corners);
    probes = every(paintPoints, MESH_PROBES);
  }

  const any = (): boolean => true;
  const fitOf = (t: Transform): number => {
    let n = 0;
    for (const p of probes) if (whole.nearest(apply(t, p), tol, any)) n++;
    return n;
  };
  let t: Transform | undefined;
  let mirrored = false;
  if (box && probes.length > 0) {
    const size: V3 = sub(box.hi, box.lo);
    const from: V3 = [
      (box.lo[0] + box.hi[0]) / 2,
      (box.lo[1] + box.hi[1]) / 2,
      (box.lo[2] + box.hi[2]) / 2,
    ];
    const fits = (r: readonly number[]): boolean =>
      rot(r, size)
        .map(Math.abs)
        .every((s, i) => {
          const n = whole.size[i] ?? 0;
          return Math.abs(s - n) <= Math.max(tol, SIZE_SHARE * Math.max(s, n));
        });
    let turn: { t: Transform; fit: number } | undefined;
    let mirror: { t: Transform; fit: number } | undefined;
    for (const { r, det } of SIGNED_PERMS) {
      if (!fits(r)) continue;
      const c = { t: { r, from, to: whole.centre }, fit: 0 };
      c.fit = fitOf(c.t);
      if (det > 0) {
        if (!turn || c.fit > turn.fit) turn = c;
      } else if (!mirror || c.fit > mirror.fit) mirror = c;
    }
    const margin = MIRROR_MARGIN * probes.length;
    if (mirror && (!turn || mirror.fit > turn.fit + margin)) {
      t = mirror.t;
      mirrored = true;
    } else t = turn?.t;
    // Nudge: the mean offset of probes to their nearest STEP point (boxes differ a little when
    // the mesh was exported with another chord error or the part changed slightly).
    let fitNow = t ? fitOf(t) : 0;
    for (let k = 0; t && k < 4; k++) {
      const cur: Transform = t;
      const off = [0, 0, 0];
      let n = 0;
      for (const p of probes) {
        const q = apply(cur, p);
        const h = whole.nearest(q, whole.tolChanged, any);
        if (!h) continue;
        for (let i = 0; i < 3; i++) off[i] = (off[i] ?? 0) + ((h.q[i] ?? 0) - (q[i] ?? 0));
        n++;
      }
      if (n === 0) break;
      const d: V3 = [(off[0] ?? 0) / n, (off[1] ?? 0) / n, (off[2] ?? 0) / n];
      if (len(d) < 1e-4) break;
      const moved: Transform = {
        ...cur,
        to: [cur.to[0] + d[0], cur.to[1] + d[1], cur.to[2] + d[2]],
      };
      const fitMoved = fitOf(moved);
      if (fitMoved < fitNow) break;
      t = moved;
      fitNow = fitMoved;
    }
  }
  const surface = t && probes.length > 0 ? fitOf(t) / probes.length : 0;

  let points = 0;
  let matched = 0;
  const status: Record<string, TransferStatus> = {};
  const markers = old.markers.map((mk, i): MarkerData => {
    const it = items[i] ?? { groups: [], entities: [] };
    const samples = it.groups.flatMap((g) => g.samples.map((p) => (t ? apply(t, p) : p)));
    const clear = it.groups.flatMap((g) => g.clear.map((p) => (t ? apply(t, p) : p)));
    const gap = spacing(it.groups.flatMap((g) => g.samples));
    points += samples.length;
    let s: TransferStatus;
    let faces = new Map<number, { whole: number[]; pieces: PaintPieces[] }>();
    if (samples.length === 0) s = mk.paint.faces.length > 0 ? 'lost' : 'found';
    else if (!t) s = 'lost';
    else {
      const hits = samples.flatMap((p) => {
        const h = whole.nearest(p, whole.tolChanged, any);
        return h ? [h] : [];
      });
      const near = hits.filter((h) => h.d <= tol).length;
      if (!mirrored) matched += near; // a mirror paints nothing
      s =
        near >= 0.8 * samples.length
          ? 'found'
          : hits.length >= 0.5 * samples.length
            ? 'changed'
            : 'lost';
      if (mirrored) s = 'check';
      else if (s !== 'lost') {
        const keep = new Set(hits.map((h) => h.face));
        // A mesh's clear points may lie past a CAD edge (the mesh is one face): only those
        // whose nearest STEP face took paint mark where it ends.
        const neg = clear.flatMap((p) => {
          const h = whole.nearest(p, whole.tolChanged, any);
          return h && keep.has(h.face) ? [h.q] : [];
        });
        faces = rebuildPaint(
          whole,
          keep,
          hits.map((h) => h.q),
          neg,
          gap,
        );
      }
    }
    status[mk.id] = s;
    const ghostFaces =
      s === 'lost' || s === 'check'
        ? it.groups.map((g) =>
            compactFace({
              samples: g.samples.flatMap((p) => round3(t ? apply(t, p) : p)),
              clear: g.clear.flatMap((p) => round3(t ? apply(t, p) : p)),
              fingerprint: undefined,
            }),
          )
        : [];
    const transfer: MarkerTransfer | undefined =
      s === 'found'
        ? undefined
        : {
            status: s,
            from: mk.transfer?.from ?? old.model.fileName,
            ...(ghostFaces.length > 0 ? { ghost: { faces: ghostFaces } } : {}),
          };
    return {
      id: mk.id,
      name: mk.name,
      color: mk.color,
      visible: mk.visible,
      // A mesh holds no entities (mesh-only mode).
      entities: [],
      paint: { faces: facePaint(faces) },
      ...(transfer ? { transfer } : {}),
    };
  });
  // The mesh's body list (one row per mesh body) doesn't fit the STEP's: the STEP's own is used.
  const annotations: Annotations = { ...old, markers, bodies: newBodies };
  delete annotations.bodyTree;
  return {
    annotations,
    status,
    coverage: {
      points,
      matched,
      surface,
      toleranceMm: Math.round(tol * 1000) / 1000,
      mirrored,
      meshRead: mesh !== undefined && mesh.indices.length >= 3,
    },
  };
}

function boundsOf(pos: ArrayLike<number>): { lo: V3; hi: V3 } | undefined {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    const v = pos[i] ?? 0;
    if (v < (lo[k] ?? 0)) lo[k] = v;
    if (v > (hi[k] ?? 0)) hi[k] = v;
  }
  return lo.every(Number.isFinite) ? { lo, hi } : undefined;
}
