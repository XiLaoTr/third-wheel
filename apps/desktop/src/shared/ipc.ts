import type { AgentId } from './agents.js';
import type { AiActivity, ConnectResult, McpSetup } from './ai-status.js';
import type { ThemeMode } from './theme.js';
import type { MenuCommand } from './menu-commands.js';

/** IPC channel names. */
export const IPC = {
  /** renderer → main */
  setThemeSource: 'theme:set-source',
  /** renderer → main (invoke): show the Open dialog, resolve with the file or null. */
  openModelDialog: 'model:open-dialog',
  /**
   * renderer → main (invoke): read an already opened model file again (exact values after its
   * kernel was freed — T2.8). Only paths main handed out before.
   */
  rereadModelFile: 'model:reread',
  /** renderer → main (invoke): text of an opened model's sidecar, or null when there is none (T5.1). */
  readSidecar: 'sidecar:read',
  /** renderer → main (invoke): other versions of an opened model in its folder (T8.4). */
  listModelVersions: 'model:versions',
  /** renderer → main (invoke): content hash (or missing) of version-chain files (T8.6). */
  versionFileStates: 'model:version-states',
  /** renderer → main (invoke): add a "newer version" line to an earlier version's notes (T8.6). */
  addNewerVersion: 'sidecar:add-newer',
  /** renderer → main (invoke): change the version chain in another version's notes (T13.4). */
  editVersionLinks: 'sidecar:edit-versions',
  /** renderer → main (invoke): write the annotation sidecar of an opened model (T5.1). */
  saveSidecar: 'sidecar:save',
  /** renderer → main (sync): same, blocking — the last save while the window closes. */
  saveSidecarSync: 'sidecar:save-sync',
  /** renderer → main (invoke): rename an unusable sidecar to a backup; resolves with its file name. */
  backupSidecar: 'sidecar:backup',
  /** main → renderer: a model file to load (e.g. from `THIRD_WHEEL_OPEN`). */
  modelFile: 'model:file',
  /** renderer → main (dev, `THIRD_WHEEL_PERF=bench`): benchmark result; main adds memory, prints, quits. */
  perfResult: 'perf:result',
  /** main → renderer: an app-bridge request for the window (T7.1), `BridgeRendererRequest`. */
  bridgeRequest: 'bridge:request',
  /** renderer → main: its answer, `BridgeRendererReply`. */
  bridgeReply: 'bridge:reply',
  /** renderer → main (invoke): bridge state + last MCP tool call, `AiActivity` (T7.6). */
  getAiActivity: 'ai:activity',
  /** main → renderer: the same, whenever it changes. */
  aiActivity: 'ai:activity-changed',
  /** renderer → main (invoke): where the MCP server is, `McpSetup` (T7.6). */
  getMcpSetup: 'ai:mcp-setup',
  /**
   * renderer → main (invoke, `AgentId`): what an agent's one-click button needs — the `claude` /
   * `gemini` program, Codex's `config.toml`; null when not found (R4, T14.2).
   */
  findAgent: 'ai:find-agent',
  /** renderer → main (invoke, `AgentId`): run the agent's one-click Connect, `ConnectResult` (R4, T14.2). */
  connectAgent: 'ai:connect-agent',
  /** main → renderer: the About menu item was chosen (T13.1). */
  showAbout: 'about:show',
  /** renderer → main (invoke): the app version, `app.getVersion()` (T13.1). */
  getAppVersion: 'about:version',
  /** renderer → main (invoke): text of the shipped third-party notices file (T13.1). */
  getThirdPartyNotices: 'about:notices',
  /** main → renderer: an app menu item the window carries out, `MenuCommand` (T13.2). */
  menuCommand: 'menu:command',
  /** renderer → main (send): undo / redo typing in the focused text field (menu, T13.2). */
  textUndoRedo: 'menu:text-undo-redo',
} as const;

/** A bridge request main hands to the window (methods the window answers, e.g. `status`). */
export interface BridgeRendererRequest {
  readonly requestId: number;
  readonly method: string;
  readonly params: unknown;
}

/** The window's answer to a `BridgeRendererRequest`. */
export type BridgeRendererReply =
  | { readonly requestId: number; readonly ok: true; readonly result: unknown }
  | { readonly requestId: number; readonly ok: false; readonly message: string };

/** Dev perf mode from `THIRD_WHEEL_PERF`, passed to the renderer as the `perf` URL query. */
export type PerfMode = 'off' | 'live' | 'bench';

export function perfModeFromEnv(value: string | undefined): PerfMode {
  if (value === 'bench') return 'bench';
  return value && value !== '0' ? 'live' : 'off';
}

/** A model file read by the main process (the sandboxed renderer can't read files). */
export interface ModelFile {
  /** Absolute path (sidecar goes next to it). */
  readonly path: string;
  /** File name for display. */
  readonly name: string;
  readonly data: ArrayBuffer;
  /** `sha256:<hex>` of the file's bytes (sidecar check, T5.1). */
  readonly contentHash: string;
}

/** Bridge `load` to the window: the file, and the modelId it is a new version of (T8.1). */
export interface LoadRequest extends ModelFile {
  readonly revisionOf?: string;
}

/** A STEP file next to an opened model whose name makes it a version of it (T8.4). */
export interface ModelVersionFile {
  readonly path: string;
  readonly name: string;
  /** Modification time of its sidecar (ms since 1970), when it has one. */
  readonly sidecarMtimeMs?: number;
}

/** A version-chain file on disk now (T8.6): its content hash, or null when it isn't there. */
export interface VersionFileState {
  readonly path: string;
  readonly contentHash: string | null;
}

/** Result of a sidecar write. */
/** `backup` = file name of the copy made first (when asked to back up before writing). */
export type SaveResult =
  { readonly ok: true; readonly backup?: string } | { readonly ok: false; readonly error: string };

/** API exposed on `window.thirdWheel` by the preload script. */
export interface ThirdWheelApi {
  /** Sync Electron's native theme (title bar, `prefers-color-scheme`) with the user's choice. */
  setThemeSource(mode: ThemeMode): void;
  /** Show the native Open dialog for STEP files (`title`: its title); null if cancelled. */
  /** `shownPath`: the shown model; the dialog starts in its folder (T12.8). */
  openModelDialog(title?: string, shownPath?: string): Promise<ModelFile | null>;
  /**
   * Read a model file opened before, or one listed by `listModelVersions`, again (rejects for
   * any other path). A listed version is opened (its sidecar writable) only with `open` (T8.5:
   * read only to compare otherwise).
   */
  rereadModelFile(path: string, open?: boolean): Promise<ModelFile>;
  /**
   * Text of `<model>.thirdwheel.json` next to an opened model, null if there is none. Read only
   * after the previous model's last save, so reopening the same file never sees an old copy.
   */
  readSidecar(modelPath: string): Promise<string | null>;
  /**
   * STEP files in an opened model's folder whose names make them versions of it (`part.step`,
   * `part_v2.step`, `part (2).step`; T8.4). Their sidecars can then be read with `readSidecar`.
   */
  listModelVersions(modelPath: string): Promise<ModelVersionFile[]>;
  /**
   * T8.6: the content hash of each file named in the shown model's version chain (null = not
   * found). STEP files only, at most 200; found ones can then be read with `rereadModelFile` and
   * `readSidecar`.
   */
  versionFileStates(paths: readonly string[]): Promise<VersionFileState[]>;
  /**
   * T8.6: add `link` (sidecar `VersionLink` JSON) as the newest "newer version" of the earlier
   * version at `olderPath` — only that field of its notes changes. With no notes file yet,
   * `emptyNotes` (sidecar text without markers) is written with the line. Rejects on failure.
   */
  addNewerVersion(olderPath: string, link: unknown, emptyNotes: string): Promise<void>;
  /**
   * T13.4: apply `edit` (a core `ChainEdit`) to the version chain in the existing notes of the
   * version at `path` with contents `contentHash`. Rejects when there are no notes, they belong to
   * other contents, or the write fails.
   */
  editVersionLinks(path: string, contentHash: string, edit: unknown): Promise<void>;
  /**
   * Write `<model>.thirdwheel.json` next to an opened model (`modelPath`). `backupFirst`: copy the
   * existing file to a `.bak.json` first (a load dropped data); the write fails if the copy does.
   */
  saveSidecar(modelPath: string, text: string, backupFirst?: boolean): Promise<SaveResult>;
  /** Same, blocking (used while the window closes). */
  saveSidecarSync(modelPath: string, text: string, backupFirst?: boolean): SaveResult;
  /** Rename the model's sidecar to `<model>.thirdwheel.<date>.bak.json`; its file name, or null if none. */
  backupSidecar(modelPath: string): Promise<string | null>;
  /** Called when the main process pushes a model to open. */
  onModelFile(listener: (file: ModelFile) => void): void;
  /** Dev perf benchmark: hand the result to the main process (which prints it and quits). */
  sendPerfResult(result: unknown): void;
  /**
   * Answer app-bridge requests (T7.1) for the window: `handler` resolves with the result or
   * rejects with a message. Set once.
   */
  onBridgeRequest(handler: (method: string, params: unknown) => unknown): void;
  /** Bridge state and the last MCP tool call (T7.6). */
  getAiActivity(): Promise<AiActivity>;
  /** Called whenever the bridge state or the last tool call changes. Set once. */
  onAiActivity(handler: (activity: AiActivity) => void): void;
  /** Where the MCP server file is, for the "Connect an AI agent" pop-up. */
  getMcpSetup(): Promise<McpSetup>;
  /** What the agent's one-click button uses (program, settings file, link); null = not found. */
  findAgent(agent: AgentId): Promise<string | null>;
  /** One-click Connect for an agent (Claude Code R4; others T14.2). */
  connectAgent(agent: AgentId): Promise<ConnectResult>;
  /** Called when the About menu item is chosen. Set once. */
  onShowAbout(handler: () => void): void;
  /** Called when an app menu item the window carries out is chosen (T13.2). Set once. */
  onMenuCommand(handler: (command: MenuCommand) => void): void;
  /** Undo / redo typing in the focused text field (`webContents.undo()` / `redo()`). */
  textUndoRedo(which: 'undo' | 'redo'): void;
  /** `app.getVersion()`. */
  getAppVersion(): Promise<string>;
  /** The third-party notices text (rejects when the file is missing). */
  getThirdPartyNotices(): Promise<string>;
}
