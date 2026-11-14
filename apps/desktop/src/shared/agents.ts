/**
 * Setups for AI agents other than Claude Code (T14.2): what the Connect pop-up shows per agent and
 * what its one-click button writes / runs / opens. Formats follow `docs/user-guide.md`
 * "Other AI agents" (each tool's docs as of 2026-11-11). Pure: used by main and the renderer.
 */
import { MCP_SERVER_NAME, shellQuote, type ConnectResult, type McpSetup } from './ai-status.js';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'vscode' | 'other';
export type OtherAgentId = Exclude<AgentId, 'claude'>;

/** The choices in the pop-up, in order. */
export const AGENTS: readonly { readonly id: AgentId; readonly label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'other', label: 'Other' },
];

export function isAgentId(v: unknown): v is AgentId {
  return AGENTS.some((a) => a.id === v);
}

/** Codex stops a tool after 60 s by default; `wait_for_review` waits 120 s and a big load can too. */
export const CODEX_TOOL_TIMEOUT_SEC = 600;

/** The server entry most tools share: `{ command, args, env? }`. */
function serverEntry(setup: McpSetup): Record<string, unknown> {
  return {
    command: setup.command,
    args: [setup.serverPath],
    ...(Object.keys(setup.env).length > 0 ? { env: setup.env } : {}),
  };
}

// --- Codex (~/.codex/config.toml) -------------------------------------------

/**
 * A TOML string. Windows: a literal string in single quotes, so the `\` of a path stay as they
 * are and the user can edit it by hand (T14.1); a basic string otherwise (or if the path has `'`).
 */
export function tomlString(value: string, platform: string): string {
  if (platform === 'win32' && !/['\n\r]/.test(value)) return `'${value}'`;
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

/** The `[mcp_servers.third-wheel]` table (+ its `env` table) for Codex's `config.toml`. */
export function codexToml(setup: McpSetup): string {
  const s = (v: string): string => tomlString(v, setup.platform);
  const lines = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${s(setup.command)}`,
    `args = [${s(setup.serverPath)}]`,
    `tool_timeout_sec = ${String(CODEX_TOOL_TIMEOUT_SEC)}`,
  ];
  const env = Object.entries(setup.env);
  if (env.length > 0) {
    lines.push('', `[mcp_servers.${MCP_SERVER_NAME}.env]`);
    for (const [k, v] of env) lines.push(`${k} = ${s(v)}`);
  }
  return lines.join('\n');
}

/** `a."b c".d` → ['a', 'b c', 'd'] (enough of TOML's dotted keys for table headers). */
function tomlKeys(key: string): string[] {
  return (key.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^.]+/g) ?? []).map((k) => {
    const t = k.trim();
    return /^["'].*["']$/.test(t) ? t.slice(1, -1) : t;
  });
}

const HEADER = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/;

/** `[` / `{` outside strings minus `]` / `}`: non-zero = the value goes on over more lines. */
function openBrackets(line: string): number {
  const bare = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '');
  let n = 0;
  for (const c of bare) n += c === '[' || c === '{' ? 1 : c === ']' || c === '}' ? -1 : 0;
  return n;
}

/**
 * `config.toml` with this app's server entry replaced by `block`: drops every
 * `[mcp_servers.third-wheel…]` table and a `third-wheel = { … }` line under `[mcp_servers]`
 * (an older install's entry would make Codex refuse a duplicate), keeps everything else as is.
 * Undefined when the file can't be edited safely line by line (multi-line strings, or an old
 * entry spread over several lines): the user then pastes it by hand (T14.2 review).
 */
export function withCodexServer(existing: string, block: string): string | undefined {
  if (existing.includes('"""') || existing.includes("'''")) return undefined;
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  /** Comments / blank lines seen while dropping: they may belong to the next table. */
  let held: string[] = [];
  let table: string[] = [];
  let dropping = false;
  const isOurs = (keys: readonly string[], from: number): boolean =>
    keys[from] === 'mcp_servers' && keys[from + 1] === MCP_SERVER_NAME;
  for (const line of existing.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      table = tomlKeys(header[1] ?? '');
      const wasDropping = dropping;
      dropping = isOurs(table, 0);
      // The comment above a kept table (from its first comment line: no doubled blank lines).
      const from = held.findIndex((l) => l.trim().startsWith('#'));
      if (wasDropping && !dropping && from >= 0) out.push(...held.slice(from));
      held = [];
      if (dropping) continue;
    }
    if (dropping) {
      if (/^\s*(#.*)?$/.test(line)) held.push(line);
      else held = [];
      continue;
    }
    // Dotted or inline forms of the same entry.
    const key = /^\s*((?:"[^"]*"|'[^']*'|[\w-]+)(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[\w-]+))*)\s*=/.exec(
      line,
    );
    if (!header && key) {
      const keys = [...table, ...tomlKeys(key[1] ?? '').map((k) => k.trim())];
      if (isOurs(keys, 0)) {
        if (openBrackets(line) !== 0) return undefined;
        continue;
      }
    }
    out.push(line);
  }
  while (out.length > 0 && out.at(-1)?.trim() === '') out.pop();
  const head = out.length > 0 ? out.join(eol) + eol + eol : '';
  return head + block.split('\n').join(eol) + eol;
}

// --- Gemini CLI ---------------------------------------------------------------

/** The arguments after `gemini` (the button runs these without a shell). All folders (`-s user`). */
export function geminiAddArgs(setup: McpSetup): string[] {
  return [
    'mcp',
    'add',
    '-s',
    'user',
    ...Object.entries(setup.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    MCP_SERVER_NAME,
    setup.command,
    setup.serverPath,
  ];
}

export function geminiAddCommand(setup: McpSetup): string {
  const q = (v: string): string => shellQuote(v, setup.platform);
  const env = Object.entries(setup.env)
    .map(([k, v]) => ` -e ${k}=${v}`)
    .join('');
  const command = setup.command === 'node' ? 'node' : q(setup.command);
  return `gemini mcp add -s user${env} ${MCP_SERVER_NAME} ${command} ${q(setup.serverPath)}`;
}

// --- Cursor / VS Code / other JSON ----------------------------------------------

/** `mcpServers` JSON for Cursor, Cline, LM Studio … (same as Claude Code's `.mcp.json`). */
export function mcpServersJson(setup: McpSetup): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverEntry(setup) } }, null, 2);
}

/** GitHub Copilot's `.mcp.json` / `~/.copilot/mcp-config.json`: needs `type` and `tools`. */
export function vscodeJson(setup: McpSetup): string {
  const entry = { type: 'stdio', ...serverEntry(setup), tools: ['*'] };
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } }, null, 2);
}

/** Base64 of UTF-8 (paths may hold any letter; `btoa` alone takes Latin-1 only). */
function base64(text: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Cursor's "Add to Cursor" link: Cursor opens and asks to install the server. */
export function cursorInstallUrl(setup: McpSetup): string {
  const config = encodeURIComponent(base64(JSON.stringify(serverEntry(setup))));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${config}`;
}

/** VS Code's "Install in VS Code" link: VS Code opens and asks to install the server. */
export function vscodeInstallUrl(setup: McpSetup): string {
  const config = { name: MCP_SERVER_NAME, type: 'stdio', ...serverEntry(setup) };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

// --- What the pop-up shows -------------------------------------------------------

export interface AgentPanel {
  /** One-click button label; undefined = no button for this agent. */
  readonly button?: string | undefined;
  /** Under the button: what it does, or why there is none. */
  readonly buttonHint?: string;
  /** Heading above the copy box. */
  readonly title: string;
  readonly text: string;
  /** Under the copy box: where it goes and how to check. */
  readonly where: string;
}

/**
 * Panel of an agent other than Claude Code (that one keeps its own, R4). `found`: what main found
 * for the button — the `gemini` program, Codex's `config.toml` path; undefined = still looking,
 * null = not found.
 */
export function agentPanel(
  agent: OtherAgentId,
  setup: McpSetup,
  found: string | null | undefined,
): AgentPanel {
  switch (agent) {
    case 'codex':
      return {
        button: 'Add to Codex',
        buttonHint: `Writes the entry below into ${found ?? '~/.codex/config.toml'} (replacing an older Third Wheel entry) and keeps the old file as config.toml.bak.`,
        title: 'Or add this to ~/.codex/config.toml yourself',
        text: codexToml(setup),
        where: `Codex CLI, IDE extension and app share this file; create it if it isn't there (Windows: C:\\Users\\you\\.codex\\config.toml). Keep tool_timeout_sec: Codex stops a tool after 60 s by default, and waiting for your review takes longer. Then restart Codex and type /mcp: third-wheel should be listed.`,
      };
    case 'gemini':
      return {
        button: found === null ? undefined : 'Connect to Gemini CLI',
        buttonHint:
          found === null
            ? 'Gemini CLI wasn’t found on this computer. Install it, or run the command below in a terminal.'
            : 'Adds the Third Wheel tools to Gemini CLI for all your folders: runs the command below.',
        title: found === null ? 'Run this once in a terminal' : 'Or run this once in a terminal',
        text: geminiAddCommand(setup),
        where:
          'Leave out “-s user” for the current folder only. Then start Gemini CLI and type /mcp: third-wheel should be listed.',
      };
    case 'cursor':
      return {
        button: 'Add to Cursor',
        buttonHint: 'Opens Cursor, which asks you to install the Third Wheel server.',
        title: 'Or add this to Cursor’s mcp.json',
        text: mcpServersJson(setup),
        where:
          '~/.cursor/mcp.json for all folders (Windows: C:\\Users\\you\\.cursor\\mcp.json), or .cursor/mcp.json in your project folder. Already has servers? Paste the "third-wheel": { … } part inside its "mcpServers". Check in Cursor Settings → MCP.',
      };
    case 'vscode':
      return {
        button: 'Install in VS Code',
        buttonHint:
          'Opens VS Code, which asks you to install the Third Wheel server for GitHub Copilot.',
        title: 'Or add this to a .mcp.json',
        text: vscodeJson(setup),
        where:
          '.mcp.json in your project folder, or ~/.copilot/mcp-config.json for all folders. VS Code asks you to trust the server the first time it starts.',
      };
    case 'other':
      return {
        title: 'Paste this into your agent’s MCP settings',
        text: mcpServersJson(setup),
        where:
          'Cline, LM Studio, Continue, Goose and others: open their MCP settings and paste the "third-wheel": { … } part inside "mcpServers". Some stop a tool after 60 s: raise that limit if it has one (waiting for your review takes longer). ChatGPT and Ollama alone can’t use it. Details: docs/user-guide.md, “Other AI agents”.',
      };
  }
}

/** The line under an agent's button after a click. */
export function agentResultText(agent: OtherAgentId, result: ConnectResult): string {
  const name = AGENTS.find((a) => a.id === agent)?.label ?? agent;
  if (result.ok) {
    if (agent === 'codex')
      return `Added ✓ to ${result.path}. Restart Codex and type /mcp: third-wheel should be listed.`;
    if (agent === 'gemini')
      return 'Connected ✓ Start a new Gemini CLI session and type /mcp: third-wheel should be listed.';
    return `${name} should open and ask to install third-wheel. Nothing opened? Use the JSON below.`;
  }
  if (result.reason === 'temporary-location')
    return 'Move Third Wheel to your Applications folder and open it from there first.';
  if (result.reason === 'not-found')
    return agent === 'cursor' || agent === 'vscode'
      ? `${name} didn’t open: is it installed? Use the JSON below instead.`
      : `${name} wasn’t found. Use the setup below.`;
  return `Couldn’t connect${result.detail ? `: ${result.detail}` : '.'} Use the setup below instead.`;
}
