/**
 * Electron test: `load_model` tells the AI when a new version lost the user's body names (a build123d
 * round trip turns them into SOLID / COMPOUND). Uses the real MCP server against the built app.
 * Run with `pnpm test:e2e` (builds first).
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OcctKernel } from 'occt-wasm';

interface TestHook {
  loaded(): boolean;
}
type HookWindow = Window & { __thirdWheelTest?: TestHook };

const appDir = resolve(import.meta.dirname, '..');
let dir: string;
let app: ElectronApplication;
let client: Client;
let bridgeFile: string;
const files: Record<'named' | 'generic' | 'renamedBigger', string> = {
  named: '',
  generic: '',
  renamedBigger: '',
};

/**
 * The Bodies list shows the instance names of the assembly (the second field of
 * `NEXT_ASSEMBLY_USAGE_OCCURRENCE`, as CAD programs write them). The kernel leaves them empty: fill
 * them in, and the product names too.
 */
function withNames(step: string, first: string, second: string): string {
  const names = [first, second];
  // The kernel numbers its exports (8.0 1, 8.0 2, …), so match any number.
  let product = 0;
  let instance = 0;
  return step
    .replace(/PRODUCT\('Open CASCADE STEP translator 8\.0 \d+\.\d+'/g, () => {
      return `PRODUCT('${names[product++] ?? 'x'}'`;
    })
    .replace(/(NEXT_ASSEMBLY_USAGE_OCCURRENCE\('\d+',)''/g, (_m, head: string) => {
      return `${head}'${names[instance++] ?? 'x'}'`;
    });
}

test.beforeAll(async () => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'third-wheel-e2e-names-')));
  bridgeFile = join(dir, 'bridge.json');
  const kernel = await OcctKernel.init();
  const parts = (height: number) =>
    kernel.makeCompound([
      kernel.makeBox(10, 20, height),
      kernel.translate(kernel.makeCylinder(4, 15), 50, 0, 0),
    ]);
  const base = kernel.exportStep(parts(30));
  const bigger = kernel.exportStep(parts(34));
  files.named = join(dir, 'part.step');
  files.generic = join(dir, 'part_v2.step'); // what a round trip leaves: SOLID everywhere
  files.renamedBigger = join(dir, 'part_v3.step'); // new geometry, the names kept
  writeFileSync(files.named, withNames(base, 'Bracket', 'Pin'));
  writeFileSync(files.generic, withNames(base, 'SOLID', 'SOLID'));
  writeFileSync(files.renamedBigger, withNames(bigger, 'Bracket', 'Pin'));

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_RENDERER_URL'];
  app = await electron.launch({
    args: [appDir, `--user-data-dir=${join(dir, 'profile')}`],
    env: {
      ...env,
      THIRD_WHEEL_OPEN: files.named,
      THIRD_WHEEL_TEST: '1',
      THIRD_WHEEL_BRIDGE_FILE: bridgeFile,
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.loaded() === true, {
    timeout: 60_000,
  });
  client = new Client({ name: 'e2e-names', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(appDir, '../../packages/mcp-server/build/third-wheel-mcp.js')],
      cwd: dir,
      env: { ...env, THIRD_WHEEL_BRIDGE_FILE: bridgeFile },
      stderr: 'ignore',
    }),
  );
});

test.afterAll(async () => {
  await client.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function load(path: string, revisionOf?: string) {
  const r = (await client.callTool({
    name: 'load_model',
    arguments: { path, ...(revisionOf ? { revisionOf } : {}) },
  })) as { content: { text?: string }[]; isError?: boolean };
  expect(r.isError, r.content.map((c) => c.text).join(' ')).not.toBe(true);
  return JSON.parse(r.content.at(-1)?.text ?? 'null') as {
    modelId: string;
    namesLost?: string;
    revision?: unknown;
  };
}

test('A new version whose bodies lost their names gets a namesLost warning; kept names do not', async () => {
  const named = await load(files.named);
  expect(named.namesLost).toBeUndefined();

  // Same parts, every body now called SOLID: the user's names (Bracket, Pin) are gone.
  const generic = await load(files.generic, named.modelId);
  expect(generic.revision).toBeDefined();
  expect(generic.namesLost).toContain('2 of the 2 named bodies');
  expect(generic.namesLost).toContain('"Bracket"');
  expect(generic.namesLost).toContain('"Pin"');
  expect(generic.namesLost).toContain('.label');
  expect(generic.namesLost).toContain('revisionOf');
  expect(generic.namesLost).toContain('restore_step_names.py');

  // Changed geometry with the names kept: nothing to warn about.
  const kept = await load(files.renamedBigger, named.modelId);
  expect(kept.revision).toBeDefined();
  expect(kept.namesLost).toBeUndefined();

  // Without revisionOf there is nothing to compare with.
  const plain = await load(files.generic);
  expect(plain.namesLost).toBeUndefined();
});
