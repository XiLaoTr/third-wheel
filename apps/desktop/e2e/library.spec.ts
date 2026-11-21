/**
 * Electron test of the Parts library: the toolbar button and panel, browsing and search, the 3D
 * preview, putting parts into a request (standard size, copies, markers, note), saving it as a comment
 * with `parts` in the sidecar, and getting it back after reopening the model.
 * Run with `pnpm test:e2e` (builds first).
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { OcctKernel } from 'occt-wasm';

interface TestHook {
  loaded(): boolean;
  flush(): Promise<void>;
  reopen(saveFirst?: boolean): Promise<void>;
  comments: { list(): { id: string; text: string; parts?: unknown[] }[] };
}
type HookWindow = Window & { __thirdWheelTest?: TestHook };

const appDir = resolve(import.meta.dirname, '..');
let dir: string;
let boxPath: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'third-wheel-e2e-lib-')));
  const kernel = await OcctKernel.init();
  boxPath = join(dir, 'box.step');
  writeFileSync(boxPath, kernel.exportStep(kernel.makeBox(10, 20, 30)));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_RENDERER_URL'];
  app = await electron.launch({
    args: [appDir, `--user-data-dir=${join(dir, 'profile')}`],
    env: {
      ...env,
      THIRD_WHEEL_OPEN: boxPath,
      THIRD_WHEEL_TEST: '1',
      THIRD_WHEEL_BRIDGE_FILE: join(dir, 'bridge.json'),
    },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.loaded() === true, {
    timeout: 60_000,
  });
});

test.afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Library: button opens the panel; 92 parts with thumbnails; search; 3D preview; Esc closes', async () => {
  const button = page.locator('#library-btn');
  const panel = page.locator('#library-panel');
  await expect(button).toBeVisible();
  await expect(panel).toBeHidden();

  await button.click();
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-sub')).toContainText('bd_warehouse');
  await expect(page.locator('.library-sub')).toContainText('92 parts');
  await expect(page.locator('.library-module')).toHaveCount(12);
  // The first module is open; every row gets a picture of the part.
  const rows = page.locator('.library-row');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(10);
  await expect(page.locator('.library-thumb img')).toHaveCount(count);

  // Search in English and in Chinese; an unknown word says so.
  await page.fill('.library-search', 'seal');
  await expect(page.locator('.library-row-name')).toContainText(['O Ring']);
  await page.fill('.library-search', '螺絲');
  await expect(page.locator('.library-row').first()).toBeVisible();
  await page.fill('.library-search', 'zzzz');
  await expect(page.locator('.library-empty')).toContainText('No part matches');
  await page.fill('.library-search', '');

  // A part: 3D preview, size and what it was built with.
  await page.locator('.library-row[data-class="SocketHeadCapScrew"]').click();
  await expect(page.locator('.library-preview canvas')).toBeVisible();
  await expect(page.locator('.library-detail-title')).toHaveText('Socket Head Cap Screw');
  await expect(page.locator('.library-facts')).toContainText('mm');

  // Typing in the search box must not trigger tool shortcuts (B = Brush).
  await page.locator('.library-search').pressSequentially('b');
  await expect(page.getByRole('button', { name: /^Select/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.fill('.library-search', '');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('Request: standard size and length, copies, marker, note → a comment with parts that survives reopening', async () => {
  await page.locator('#library-btn').click();
  await page.locator('.library-row[data-class="SocketHeadCapScrew"]').click();
  const add = page.locator('.library-add');
  await expect(add).toBeVisible();
  await add.click();
  await expect(add).toContainText('Added');
  const requestTab = page.locator('.library-tab').nth(1);
  await expect(requestTab).toHaveText('Request (1)');

  await requestTab.click();
  await expect(page.locator('.library-item')).toHaveCount(1);

  // Standard type and size come from the library's tables; the size list follows the type.
  const options = page.locator('.library-option');
  const typeSelect = options.nth(0).locator('select');
  const sizeSelect = options.nth(1).locator('select');
  await expect(typeSelect.locator('option')).toContainText(['AI decides', 'iso4762']);
  await typeSelect.selectOption('iso4762');
  await expect(sizeSelect.locator('option[value="M5-0.8"]')).toHaveCount(1);
  await page.locator('.library-option').nth(1).locator('select').selectOption('M5-0.8');
  const length = page.locator('.library-option').nth(2).locator('input');
  await length.fill('16');
  await length.dispatchEvent('change');

  // Copies, set after the choices above, must not undo them.
  const copies = page.locator('.library-item .library-copies').last();
  await copies.fill('2');
  await copies.dispatchEvent('change');

  await page.locator('.library-item .library-check input').first().check();
  await page.locator('.library-note').fill('countersunk flush');
  await page.locator('.library-instruction').fill('Fasten the plate here');
  await page.locator('.library-create').click();
  await expect(page.locator('.library-notice')).toContainText('Saved as comment #1');
  await expect(requestTab).toHaveText('Request');

  // The comment card lists the part.
  await expect(page.locator('.comment-parts li')).toHaveText('Socket Head Cap Screw ×2 → Marker 1');

  // The sidecar holds it, with the choices and the note kept apart.
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  const sidecar = JSON.parse(readFileSync(`${boxPath}.thirdwheel.json`, 'utf8')) as {
    comments: { text: string; markerIds: string[]; parts: unknown[] }[];
  };
  const comment = sidecar.comments.at(-1);
  expect(comment?.text).toBe('Fasten the plate here');
  expect(comment?.parts).toEqual([
    {
      id: 'p1',
      source: {
        kind: 'library',
        library: 'bd_warehouse',
        version: expect.any(String) as unknown,
        cls: 'SocketHeadCapScrew',
        params: { fastener_type: 'iso4762', size: 'M5-0.8', length: 16 },
      },
      copies: 2,
      scope: 'whole',
      target: { markerIds: comment?.markerIds },
      note: 'countersunk flush',
    },
  ]);

  // Reopening the model reads it back from the sidecar.
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen(true));
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.loaded() === true, {
    timeout: 60_000,
  });
  await expect(page.locator('.comment-parts li')).toHaveText('Socket Head Cap Screw ×2 → Marker 1');
});
