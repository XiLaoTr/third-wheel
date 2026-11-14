/**
 * One-click Connect (R4, T14.2): find the `claude` / `gemini` program and run its
 * `mcp add` for the user; write Codex's `config.toml`; open Cursor's / VS Code's install link.
 *
 * Apps started from the Dock / Start menu don't get the terminal's PATH (macOS gives them a bare
 * one), so besides PATH we look in Claude Code's usual install folders, in the copy the VS Code /
 * Cursor extension carries, and (macOS / Linux) ask the user's login shell.
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { isAbsolute } from 'node:path';
import {
  claudeAddArgs,
  MCP_SERVER_NAME,
  type ConnectResult,
  type McpSetup,
} from '../shared/ai-status.js';
import { codexToml, geminiAddArgs, withCodexServer } from '../shared/agents.js';

export interface FindEnv {
  readonly platform: string;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Folders (under home) where editors keep extensions; the Claude Code extension ships `claude`. */
const EDITOR_EXTENSION_DIRS = [
  ['.vscode', 'extensions'],
  ['.vscode-insiders', 'extensions'],
  ['.cursor', 'extensions'],
  ['.windsurf', 'extensions'],
];

/** `anthropic.claude-code-2.1.322-darwin-arm64` → [2, 1, 322]; newest first when sorted. */
function extensionVersion(folder: string): number[] {
  const m = /^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)/.exec(folder);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
}

function newestFirst(a: string, b: string): number {
  const va = extensionVersion(a);
  const vb = extensionVersion(b);
  for (let i = 0; i < 3; i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
  return 0;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** A command-line tool we look for: its name and its own install folders. */
interface CliSpec {
  readonly name: string;
  /** Windows file names, most likely first. */
  readonly winNames: readonly string[];
  /** Install folders under home (posix), besides PATH and the npm / Homebrew ones. */
  readonly homeDirs: readonly (readonly string[])[];
  /** Folder-name prefix of an editor extension that carries its own copy. */
  readonly extensionPrefix?: string;
}

const CLAUDE: CliSpec = {
  name: 'claude',
  winNames: ['claude.exe', 'claude.cmd'],
  homeDirs: [
    ['.local', 'bin'],
    ['.claude', 'local'],
  ],
  extensionPrefix: 'anthropic.claude-code-',
};

/** Gemini CLI is an npm package (or Homebrew): `gemini`, on Windows npm's `gemini.cmd` (T14.2). */
const GEMINI: CliSpec = {
  name: 'gemini',
  winNames: ['gemini.cmd', 'gemini.exe'],
  homeDirs: [['.local', 'bin']],
};

/** Where a tool may be, most likely first (not checked for existence). */
function cliCandidates(
  spec: CliSpec,
  { platform, home, env }: FindEnv,
  list: (dir: string) => string[],
): string[] {
  const win = platform === 'win32';
  // The rules of the platform asked about (tests run Windows paths on a Mac).
  const p = win ? path.win32 : path.posix;
  const join = (...parts: string[]): string => p.join(...parts);
  const names = win ? spec.winNames : [spec.name];
  const out: string[] = [];
  const pathDirs = (env['PATH'] ?? env['Path'] ?? '')
    .split(p.delimiter)
    .filter((d) => d && p.isAbsolute(d));
  for (const dir of pathDirs) for (const n of names) out.push(join(dir, n));
  // Native installer / old local install, Homebrew / npm global.
  if (win) {
    for (const dirs of spec.homeDirs.slice(0, 1)) out.push(join(home, ...dirs, names[0] ?? ''));
    if (env['APPDATA']) out.push(join(env['APPDATA'], 'npm', `${spec.name}.cmd`));
  } else {
    for (const dirs of spec.homeDirs) out.push(join(home, ...dirs, spec.name));
    out.push(`/opt/homebrew/bin/${spec.name}`, `/usr/local/bin/${spec.name}`);
    out.push(join(home, '.npm-global', 'bin', spec.name));
  }
  // The copy inside an editor extension (newest version first).
  const prefix = spec.extensionPrefix;
  if (prefix)
    for (const parts of EDITOR_EXTENSION_DIRS) {
      const dir = join(home, ...parts);
      const folders = list(dir)
        .filter((f) => f.startsWith(prefix))
        .sort(newestFirst);
      for (const f of folders)
        out.push(join(dir, f, 'resources', 'native-binary', win ? `${spec.name}.exe` : spec.name));
    }
  return [...new Set(out)];
}

/** Where `claude` may be, most likely first (not checked for existence). */
export function claudeCandidates(
  env: FindEnv,
  list: (dir: string) => string[] = listDir,
): string[] {
  return cliCandidates(CLAUDE, env, list);
}

/** Where `gemini` may be (T14.2). */
export function geminiCandidates(
  env: FindEnv,
  list: (dir: string) => string[] = listDir,
): string[] {
  return cliCandidates(GEMINI, env, list);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * How `claude` is started: a `.cmd` / `.bat` (npm's shim on Windows) only runs through cmd.exe
 * (Node refuses to spawn it directly), with every argument quoted by us; anything else directly.
 */
export function commandLine(
  platform: string,
  file: string,
  args: readonly string[],
): { exe: string; argv: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const quote = (a: string): string => (/[\s&()^|<>"]/.test(a) ? `"${a}"` : a);
    // `/s`: cmd strips only the outer pair of quotes and keeps the rest of the line as is.
    return {
      exe: 'cmd.exe',
      argv: ['/d', '/s', '/c', `"${[file, ...args].map(quote).join(' ')}"`],
      verbatim: true,
    };
  }
  return { exe: file, argv: [...args], verbatim: false };
}

function run(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    // npm tools (gemini) start with `#!/usr/bin/env node`; an app started from the Dock has a
    // bare PATH without node, which usually sits next to the tool (Homebrew, nvm, npm global).
    if (isAbsolute(file)) {
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = [path.dirname(file), env[key]].filter(Boolean).join(path.delimiter);
    }
    const { exe, argv, verbatim } = commandLine(process.platform, file, args);
    execFile(
      exe,
      argv,
      { env, timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: verbatim },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, out: `${stdout}${stderr}`.trim() });
      },
    );
  });
}

/** Ask the login shell (macOS / Linux): picks up PATH set in ~/.zshrc etc. */
async function fromLoginShell(name: string): Promise<string | undefined> {
  const shell = process.env['SHELL'];
  if (!shell || !isAbsolute(shell)) return undefined;
  const { out } = await run(shell, ['-ilc', `command -v ${name}`], 5000);
  // Interactive shells may print other lines first; the answer is the last absolute path.
  const line = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => isAbsolute(l));
  return line && isFile(line) ? line : undefined;
}

const found = new Map<string, string>();

async function findCli(
  name: string,
  candidates: (env: FindEnv) => string[],
  override: string | undefined,
): Promise<string | undefined> {
  if (override !== undefined) return override || undefined;
  const known = found.get(name);
  if (known && existsSync(known)) return known;
  const home = homedir(); // not $HOME: Git / MSYS tools on Windows may set it to a non-native path
  let hit = candidates({ platform: process.platform, home, env: process.env }).find(isFile);
  if (!hit && process.platform !== 'win32') hit = await fromLoginShell(name);
  if (hit) found.set(name, hit);
  else found.delete(name);
  return hit;
}

/**
 * The `claude` program, or undefined when Claude Code isn't installed where we look. `override`
 * (dev / e2e only, `THIRD_WHEEL_CLAUDE`): use this program instead; empty = "not installed".
 */
export function findClaude(override?: string): Promise<string | undefined> {
  return findCli('claude', claudeCandidates, override);
}

/** The `gemini` program (T14.2); `override` = `THIRD_WHEEL_GEMINI` (dev / e2e). */
export function findGemini(override?: string): Promise<string | undefined> {
  return findCli('gemini', geminiCandidates, override);
}

/** Add the MCP server for all the user's folders (`--scope user`), replacing an older entry. */
export async function connectClaudeCode(
  setup: McpSetup,
  override?: string,
): Promise<ConnectResult> {
  if (setup.temporaryLocation) return { ok: false, reason: 'temporary-location' };
  const claude = await findClaude(override);
  if (!claude) return { ok: false, reason: 'not-found' };
  // An entry from an earlier install / dev build would make `add` fail ("already exists").
  await run(claude, ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME], 20_000);
  const { code, out } = await run(claude, claudeAddArgs(setup, 'user'), 20_000);
  if (code !== 0) return { ok: false, reason: 'failed', detail: out.slice(0, 500) };
  return { ok: true, path: claude };
}

/** `gemini mcp add -s user third-wheel …`, replacing an older entry (T14.2). */
export async function connectGemini(setup: McpSetup, override?: string): Promise<ConnectResult> {
  if (setup.temporaryLocation) return { ok: false, reason: 'temporary-location' };
  const gemini = await findGemini(override);
  if (!gemini) return { ok: false, reason: 'not-found' };
  await run(gemini, ['mcp', 'remove', '-s', 'user', MCP_SERVER_NAME], 30_000);
  const { code, out } = await run(gemini, geminiAddArgs(setup), 30_000);
  if (code !== 0) return { ok: false, reason: 'failed', detail: out.slice(0, 500) };
  return { ok: true, path: gemini };
}

/**
 * Codex's settings file: `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`. `override`
 * (dev / e2e only, `THIRD_WHEEL_CODEX_HOME`) replaces the folder.
 */
export function codexConfigPath(override?: string): string {
  const dir = override || process.env['CODEX_HOME'] || path.join(homedir(), '.codex');
  return path.join(dir, 'config.toml');
}

/**
 * Write the Third Wheel entry (with `tool_timeout_sec`, which `codex mcp add` can't set) into
 * Codex's `config.toml` (T14.2). An older entry is replaced; the file before is kept as `.bak`.
 */
export async function connectCodex(setup: McpSetup, override?: string): Promise<ConnectResult> {
  if (setup.temporaryLocation) return { ok: false, reason: 'temporary-location' };
  const file = codexConfigPath(override);
  try {
    let existing = '';
    try {
      existing = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const next = withCodexServer(existing, codexToml(setup));
    if (next === undefined)
      return {
        ok: false,
        reason: 'failed',
        detail: `${file} has a layout the app doesn't change safely (multi-line text or an old Third Wheel entry over several lines); nothing was written`,
      };
    await mkdir(path.dirname(file), { recursive: true });
    if (existing) await copyFile(file, `${file}.bak`);
    // A symlinked file (dotfiles) stays a link: write to where it points.
    const target = existing ? await realpath(file) : file;
    // Write next to it, then swap: a crash never leaves a half-written settings file.
    const tmp = `${target}.thirdwheel-tmp`;
    await writeFile(tmp, next, 'utf8');
    await rename(tmp, target);
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}
