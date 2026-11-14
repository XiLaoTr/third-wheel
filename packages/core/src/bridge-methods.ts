/**
 * App bridge methods for the MCP tools (T7.2): params (checked by the app with these schemas)
 * and results. The MCP server (`packages/mcp-server`) turns them into tools; spec in
 * `docs/mcp-tools.md`. Pure — shared by the app window and the MCP server.
 */
import { z } from 'zod';
import { commentStatusSchema, MAX_COMMENT_LENGTH, type CommentStatus } from './schema.js';

/** Hex characters of the content hash used as the model id. */
const MODEL_ID_HEX = 12;

/**
 * Short id the AI uses for a model file: the first 12 hex digits of its `sha256:` content hash.
 * A new export of the CAD gives a new id (old annotations then come over by revision transfer).
 */
export function modelIdOf(contentHash: string): string {
  return contentHash.replace(/^sha256:/, '').slice(0, MODEL_ID_HEX);
}

/** STEP files: full experience (entity selection, versions). */
export const STEP_EXTENSIONS: readonly string[] = ['.step', '.stp'];
/** Mesh files (T9.1, mesh-only mode): brush + comments, no entity selection. */
export const MESH_EXTENSIONS: readonly string[] = ['.stl', '.3mf'];
/** Model files `load_model` and the Open dialog open. */
export const LOADABLE_EXTENSIONS: readonly string[] = [...STEP_EXTENSIONS, ...MESH_EXTENSIONS];

/** Longest `wait_for_review` long-poll, seconds. */
export const MAX_WAIT_SECONDS = 300;
/** Region pictures: default and largest square size, px (kept small: fewer tokens for the AI). */
export const DEFAULT_RENDER_SIZE = 384;
export const MAX_RENDER_SIZE = 768;
export const MIN_RENDER_SIZE = 64;
/** Most groups in one contact sheet (T6.4). */
export const MAX_RENDER_GROUPS = 4;
const MAX_IDS = 200;
const idText = z.string().min(1).max(64);
const modelId = z.string().min(1).max(64);

/**
 * `load` (main reads the file, then the window shows it). `revisionOf` (T8.1): modelId of a model
 * loaded earlier in this session that the new file is a new version of (another file name).
 */
export const loadParamsSchema = z.object({
  path: z.string().min(1).max(4096),
  revisionOf: modelId.optional(),
});

/**
 * How the previous version's annotations came to the new one (T8.1): `carried` = same geometry,
 * moved over exactly; `moved` = geometry changed, moved over by matching geometry (T8.2, see
 * `transfer`); `waiting` = geometry changed and the move failed (kept, not shown); `none` = it had
 * none; `own` = the new file already has its own annotations (they are used).
 */
export type RevisionAnnotations = 'carried' | 'moved' | 'waiting' | 'none' | 'own';

/** A marker the transfer could not place exactly (T8.2). */
export interface TransferredMarker {
  readonly id: string;
  readonly name: string;
  /** `changed` moved / resized (please confirm); `lost` nothing matched; `check` mirrored body. */
  readonly status: 'changed' | 'lost' | 'check';
}

/** Result of moving annotations onto changed geometry (T8.2). */
export interface TransferSummary {
  readonly found: number;
  readonly changed: number;
  readonly lost: number;
  readonly check: number;
  /** Every marker not found where it was. */
  readonly flagged: readonly TransferredMarker[];
  /** T9.2: paint moved from a mesh file (STL / 3MF) onto this STEP — how well it matched. */
  readonly fromMesh?: MeshCoverage;
}

/** T9.2 coverage report: paint points of a mesh's notes landed on the STEP surface. */
export interface MeshCoverage {
  /** Painted sample points in all markers. */
  readonly points: number;
  /** Of those, on the STEP surface within `toleranceMm`. */
  readonly matched: number;
  /** Share (0..1) of the mesh's surface lying on the STEP surface once lined up. */
  readonly surface: number;
  /** max(0.5 mm, 1 % of the STEP model's largest side). */
  readonly toleranceMm: number;
  /** The mesh only fits as a mirror image: every marker is "check". */
  readonly mirrored: boolean;
  /** False: the mesh file couldn't be read; `surface` is then the share of the paint points. */
  readonly meshRead: boolean;
}

export interface RevisionInfo {
  /** File name of the previous version. */
  readonly of: string;
  readonly path: string;
  readonly annotations: RevisionAnnotations;
  /** The previous version's markers and comments. */
  readonly markers: number;
  readonly comments: number;
  /** Set when `annotations` is `moved`. */
  readonly transfer?: TransferSummary;
}

export interface LoadResult {
  readonly modelId: string;
  readonly name: string;
  readonly path: string;
  readonly bodies: number;
  readonly faces: number;
  /** Set for a mesh file (T9.1): paint + comments only, no entity ids (`faces` = bodies). */
  readonly mesh?: 'stl' | '3mf';
  readonly markers: number;
  /** Comments by status. */
  readonly comments: Readonly<Record<CommentStatus, number>>;
  /** Set when the file is a new version of a model loaded before (T8.1). */
  readonly revision?: RevisionInfo;
  /**
   * T8.4: the file looks like a newer copy of a model loaded this session, but `revisionOf` was
   * not given — what to do about it.
   */
  readonly hint?: string;
  /** T8.4: this load overwrote the previous version on disk; export the next one under a new name. */
  readonly warning?: string;
}

/** `annotations`: the review payload (geometry `reviewPayload`) as an object. */
export const annotationsParamsSchema = z.object({
  modelId,
  /** Comment statuses to include (default: open only). */
  statuses: z.array(commentStatusSchema).min(1).max(3).optional(),
});

/** Most other models one review request can cover (T7.4). */
export const MAX_ALSO_MODELS = 3;

/**
 * `request_review`: show the user a review request with an optional message. `modelId` is the shown
 * model; `alsoModelIds` are other models loaded this session that belong to the same review (T7.4:
 * two parts that must fit) — the banner lets the user switch between them, one Send answers all.
 */
export const requestReviewParamsSchema = z.object({
  modelId,
  alsoModelIds: z.array(modelId).max(MAX_ALSO_MODELS).optional(),
  message: z.string().max(2000).optional(),
});
export interface RequestReviewResult {
  readonly reviewId: string;
}

/** `wait_review`: long-poll until the user sends the review, dismisses it, or time runs out. */
export const waitReviewParamsSchema = z.object({
  reviewId: idText,
  timeoutSec: z.number().min(0).max(MAX_WAIT_SECONDS),
});
/**
 * `sent`: the user clicked "Send to AI" (read the annotations now). `waiting`: time ran out, call
 * again. `cancelled`: the user dismissed it, another request replaced it, or another model opened.
 */
export type ReviewState = 'sent' | 'waiting' | 'cancelled';
/** One model of a review that covers several (T7.4). */
export interface ReviewModelCount {
  readonly modelId: string;
  readonly name: string;
  /** Open comments when the review was sent. */
  readonly openComments: number;
}
export interface WaitReviewResult {
  readonly reviewId: string;
  readonly state: ReviewState;
  readonly modelId: string;
  /** Open comments when the review was sent (all its models together). */
  readonly openComments?: number;
  /** Per model, when the request named `alsoModelIds` and the review was sent. */
  readonly models?: readonly ReviewModelCount[];
  readonly reason?: string;
}

/** `render`: one picture of `markerIds`, or a contact sheet of up to 4 `groups`. */
export const renderParamsSchema = z
  .object({
    modelId,
    markerIds: z.array(idText).min(1).max(MAX_IDS).optional(),
    groups: z.array(z.array(idText).min(1).max(MAX_IDS)).min(1).max(MAX_RENDER_GROUPS).optional(),
    size: z.number().int().min(MIN_RENDER_SIZE).max(MAX_RENDER_SIZE).optional(),
  })
  .refine((p) => (p.markerIds === undefined) !== (p.groups === undefined), {
    message: 'Give either markerIds or groups',
  });

type V3 = readonly [number, number, number];
/** How one picture / tile was taken; numbers rounded for the AI. */
export interface RenderView {
  readonly viewDir: V3;
  readonly up: V3;
  readonly center: V3;
  readonly mmPerPx: number;
  /** Bodies in front of the region, drawn faint and see-through. */
  readonly ghosted: readonly { readonly body: number; readonly name: string }[];
}
export interface RenderTile extends RenderView {
  /** Label in the tile's top-left corner (none when the sheet has one tile). */
  readonly number: number;
  /** Index into `groups`. */
  readonly group: number;
  readonly markerIds: readonly string[];
  /** Pixel rect in the sheet. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
}
export interface RenderResult {
  /** PNG, base64. */
  readonly png: string;
  readonly width: number;
  readonly height: number;
  /** One picture (`markerIds`). */
  readonly view?: RenderView;
  /** Contact sheet (`groups`). */
  readonly tiles?: readonly RenderTile[];
  /** Group indices that showed nothing. */
  readonly skipped?: readonly number[];
}

/** `set_comment_status`: the AI resolves / reopens a comment of the shown model. */
export const setCommentStatusParamsSchema = z.object({
  modelId,
  commentId: idText,
  status: commentStatusSchema,
  note: z.string().max(MAX_COMMENT_LENGTH).optional(),
});
export interface SetCommentStatusResult {
  readonly commentId: string;
  readonly status: CommentStatus;
  /** The AI reply the note became (T7.5); missing without a note. */
  readonly replyId?: string;
  /** False when it already had this status and no note was given. */
  readonly changed: boolean;
}

/** `reply_comment` (T7.5): the AI answers in a comment's thread without changing its status. */
export const replyCommentParamsSchema = z.object({
  modelId,
  commentId: idText,
  text: z.string().min(1).max(MAX_COMMENT_LENGTH),
});
export interface ReplyCommentResult {
  readonly commentId: string;
  readonly replyId: string;
  /** The comment's status (unchanged). */
  readonly status: CommentStatus;
}

/** Checks bridge params; a readable error names what is wrong. */
export function parseParams<T>(schema: z.ZodType<T>, params: unknown, method: string): T {
  const r = schema.safeParse(params ?? {});
  if (!r.success) throw new Error(`Bad params for "${method}": ${z.prettifyError(r.error)}`);
  return r.data;
}
