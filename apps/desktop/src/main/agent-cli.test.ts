import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexToml } from '../shared/agents.js';
import { claudeAddArgs, MCP_RUN_AS_NODE, type McpSetup } from '../shared/ai-status.js';
import {
  claudeCandidates,
  codexConfigPath,
  commandLine,
  connectCodex,
  geminiCandidates,
} from './agent-cli.js';

const extensions = (dir: string): string[] =>
  /[\\/]\.vscode[\\/]extensions$/.test(dir)
    ? [
        'anthropic.claude-code-2.1.9-darwin-arm64',
        'anthropic.claude-code-2.1.322-darwin-arm64',
        'ms-python.python-2025.1.0',
      ]
    : [];

describe('claudeCandidates (R4 one-click Connect)', () => {
  it('macOS: PATH first, then install folders, then the newest editor extension copy', () => {
    const home = '/Users/me';
    const list = claudeCandidates(
      { platform: 'darwin', home, env: { PATH: '/usr/bin:/bin:relative/bin' } },
      extensions,
    );
    expect(list.slice(0, 3)).toEqual([
      posix.join('/usr/bin', 'claude'),
      posix.join('/bin', 'claude'),
      posix.join(home, '.local', 'bin', 'claude'),
    ]);
    expect(list).toContain('/opt/homebrew/bin/claude');
    expect(list.some((p) => p.includes('relative'))).toBe(false);
    const ext = list.filter((p) => p.includes('anthropic.claude-code-'));
    expect(ext).toEqual([
      posix.join(
        home,
        '.vscode',
        'extensions',
        'anthropic.claude-code-2.1.322-darwin-arm64',
        'resources',
        'native-binary',
        'claude',
      ),
      posix.join(
        home,
        '.vscode',
        'extensions',
        'anthropic.claude-code-2.1.9-darwin-arm64',
        'resources',
        'native-binary',
        'claude',
      ),
    ]);
  });

  it('Windows: .exe before npm’s .cmd shim; extension copy is claude.exe', () => {
    const home = 'C:\\Users\\me';
    const list = claudeCandidates(
      {
        platform: 'win32',
        home,
        env: { PATH: 'C:\\Tools;C:\\Windows', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      },
      extensions,
    );
    expect(list[0]).toBe(win32.join('C:\\Tools', 'claude.exe'));
    expect(list[1]).toBe(win32.join('C:\\Tools', 'claude.cmd'));
    expect(list).toContain(win32.join(home, '.local', 'bin', 'claude.exe'));
    expect(list).toContain(win32.join('C:\\Users\\me\\AppData\\Roaming', 'npm', 'claude.cmd'));
    expect(
      list.filter((p) => p.includes('anthropic.')).every((p) => p.endsWith('claude.exe')),
    ).toBe(true);
  });
});

describe('commandLine (R4)', () => {
  const app = 'C:\\Users\\me\\AppData\\Local\\Programs\\Third Wheel';
  const setup = {
    serverPath: `${app}\\resources\\mcp\\third-wheel-mcp.js`,
    exists: true,
    packaged: true,
    platform: 'win32',
    command: `${app}\\Third Wheel.exe`,
    env: MCP_RUN_AS_NODE,
    temporaryLocation: false,
  };

  it('Windows .cmd shim: one cmd.exe line, paths with spaces quoted', () => {
    const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd';
    expect(commandLine('win32', shim, claudeAddArgs(setup, 'user'))).toEqual({
      exe: 'cmd.exe',
      argv: [
        '/d',
        '/s',
        '/c',
        `"${shim} mcp add --scope user third-wheel --env ELECTRON_RUN_AS_NODE=1 -- "${setup.command}" "${setup.serverPath}""`,
      ],
      verbatim: true,
    });
  });

  it('.exe and macOS: started directly with the arguments as they are', () => {
    const args = claudeAddArgs(setup, 'user');
    expect(commandLine('win32', 'C:\\x\\claude.exe', args)).toEqual({
      exe: 'C:\\x\\claude.exe',
      argv: args,
      verbatim: false,
    });
    expect(commandLine('darwin', '/usr/local/bin/claude', ['mcp', 'list']).verbatim).toBe(false);
  });
});

describe('geminiCandidates (T14.2)', () => {
  it('macOS: PATH, then npm / Homebrew folders; no editor-extension copies', () => {
    const list = geminiCandidates(
      { platform: 'darwin', home: '/Users/me', env: { PATH: '/usr/bin' } },
      extensions,
    );
    expect(list[0]).toBe('/usr/bin/gemini');
    expect(list).toContain('/opt/homebrew/bin/gemini');
    expect(list).toContain('/Users/me/.npm-global/bin/gemini');
    expect(list.some((p) => p.includes('extensions'))).toBe(false);
  });

  it('Windows: npm’s gemini.cmd on PATH and in %APPDATA%\\npm', () => {
    const list = geminiCandidates(
      {
        platform: 'win32',
        home: 'C:\\Users\\me',
        env: { Path: 'C:\\Tools', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      },
      extensions,
    );
    expect(list[0]).toBe(win32.join('C:\\Tools', 'gemini.cmd'));
    expect(list).toContain(win32.join('C:\\Users\\me\\AppData\\Roaming', 'npm', 'gemini.cmd'));
  });
});

describe('connectCodex (T14.2)', () => {
  const setup: McpSetup = {
    serverPath: '/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js',
    exists: true,
    packaged: true,
    platform: 'darwin',
    command: '/Applications/Third Wheel.app/Contents/MacOS/Third Wheel',
    env: MCP_RUN_AS_NODE,
    temporaryLocation: false,
  };

  it('creates the folder + file; keeps a backup of an existing file and the user’s settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-codex-'));
    try {
      const home = join(dir, 'codex-home');
      const file = codexConfigPath(home);
      expect(file).toBe(join(home, 'config.toml'));
      expect(await connectCodex(setup, home)).toEqual({ ok: true, path: file });
      expect(readFileSync(file, 'utf8')).toBe(`${codexToml(setup)}\n`);
      writeFileSync(file, 'model = "gpt-5"\n[mcp_servers.third-wheel]\ncommand = "old"\n');
      expect((await connectCodex(setup, home)).ok).toBe(true);
      expect(readFileSync(`${file}.bak`, 'utf8')).toContain('command = "old"');
      const now = readFileSync(file, 'utf8');
      expect(now).toContain('model = "gpt-5"');
      expect(now).not.toContain('"old"');
      expect(now).toContain('tool_timeout_sec = 600');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Windows: making a symlink needs admin rights / developer mode (CI runs on Windows).
  it.skipIf(process.platform === 'win32')(
    'a symlinked config.toml stays a link; an unsafe layout is left alone',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tw-codex-'));
      try {
        const home = join(dir, 'codex-home');
        mkdirSync(home);
        const real = join(dir, 'dotfiles-config.toml');
        writeFileSync(real, 'model = "gpt-5"\n');
        symlinkSync(real, join(home, 'config.toml'));
        expect((await connectCodex(setup, home)).ok).toBe(true);
        expect(lstatSync(join(home, 'config.toml')).isSymbolicLink()).toBe(true);
        expect(readFileSync(real, 'utf8')).toContain('tool_timeout_sec = 600');
        writeFileSync(real, 'x = """\nmulti\n"""\n');
        const r = await connectCodex(setup, home);
        expect(r).toMatchObject({ ok: false, reason: 'failed' });
        expect(readFileSync(real, 'utf8')).toBe('x = """\nmulti\n"""\n');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('refuses from a temporary location', async () => {
    expect(await connectCodex({ ...setup, temporaryLocation: true }, '/nowhere')).toEqual({
      ok: false,
      reason: 'temporary-location',
    });
  });
});
