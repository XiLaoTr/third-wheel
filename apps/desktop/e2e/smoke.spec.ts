/**
 * Electron smoke test: opens a generated 10×20×30 box and checks the GPU picking path end to end
 * (T2.1 review) plus click-to-select (T2.2), the selection filter and double-click (T2.3), box
 * select (T2.4), multi-select by default (T2.6), the Info panel with collapsible sections (T2.5)
 * and its "Exact values" button (T2.8), tool switching with the brush cursors (T3.1), painting and
 * erasing with the sphere brush (T3.3), Smart fill (T3.4), the Markers palette (T3.2), undo / redo (T3.5)
 * markers holding selections (T3.7), the comment panel (T4.2), 3D comment pins (T4.3) and the
 * annotation sidecar (T5.1), user folders in the body list (T5.4) and the app bridge (T7.1).
 * Run with `pnpm test:e2e` (builds first).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectBridge } from '@third-wheel/mcp-server';
import { OcctKernel } from 'occt-wasm';

/** What the renderer exposes as `window.__thirdWheelTest` (main.ts, THIRD_WHEEL_TEST=1). */
interface TestHook {
  viewport: {
    pick(x: number, y: number): { kind: string; id: number; body: number } | undefined;
    projectToCanvas(p: [number, number, number]): { x: number; y: number };
    brushCursorState():
      | { center: number[]; normal: number[]; radius: number; style: string; color: number }
      | undefined;
    paintShownTriangles(): number;
    paintShownPieces(): number;
    fillPreviewTriangles(): number;
    isStroking(): boolean;
    markerEntityStats(): { tris: number; lines: number; bodyLines: number; dots: number };
    commentFocusStats(): { items: number; markers: number; faded: number };
    pinStats(): {
      id: string;
      number: number;
      focused: boolean;
      behind: boolean;
      x: number;
      y: number;
    }[];
  };
  comments: { list(): { id: string; text: string; markerIds: string[]; status: string }[] };
  paint():
    | { count(markerId: string): number; paintedArea(markerId: string): number; splitCount: number }
    | undefined;
  markers: {
    active(): { id: string } | undefined;
    list(): { id: string; entities: { kind: string; id: number }[] }[];
    add(entities: { kind: string; id: number }[], name?: string): { id: string };
    setActive(id: string): void;
    remove(id: string): boolean;
  };
  history: { canUndo(): boolean; canRedo(): boolean };
  reopen(saveFirst?: boolean): Promise<void>;
  flush(): Promise<void>;
  notice(): string | undefined;
  alert(): string | undefined;
  brushRadius(): number;
  fillAngle(): number;
  selection: {
    list(): { kind: string; id: number }[];
    addAll(items: { kind: string; id: number }[]): void;
    clear(): void;
  };
  model():
    | {
        positions: Float32Array;
        indices: Uint32Array;
        triangleFace: Uint32Array;
        edgePoints: Float32Array;
        edgeRanges: Uint32Array;
        vertexPositions: Float32Array;
        faceGeometry: Float32Array;
        edgeGeometry: Float32Array;
        edgeTypes: string[];
      }
    | undefined;
  /** The shown model is drawn and its load finished (T12.1). */
  loaded(): boolean;
}
type HookWindow = Window & { __thirdWheelTest?: TestHook };

const appDir = resolve(import.meta.dirname, '..');
let dir: string;
/** THIRD_WHEEL_E2E_SCALE=1.75 fakes Windows display scaling (175 %) on any machine (T11.1). */
const e2eScale = process.env['THIRD_WHEEL_E2E_SCALE'];
const scaleArgs = e2eScale ? [`--force-device-scale-factor=${e2eScale}`] : [];
let app: ElectronApplication;
/** Own bridge file: a Third Wheel the developer has open keeps its own. */
let bridgeFile: string;
/** Fake `claude` program (R4 one-click Connect) and the file it logs its calls to. */
let fakeClaude: string;
let claudeLog: string;
/** A fake `gemini` and its call log; a folder in place of `~/.codex` (T14.2). */
let fakeGemini: string;
let geminiLog: string;
let codexHome: string;

test.beforeAll(async () => {
  // Real path (macOS /var → /private/var): the app names opened models by their real path.
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'third-wheel-e2e-')));
  const kernel = await OcctKernel.init();
  bridgeFile = join(dir, 'bridge.json');
  const boxPath = join(dir, 'box.step');
  writeFileSync(boxPath, kernel.exportStep(kernel.makeBox(10, 20, 30)));
  // A second part for the multi-model review (T7.4).
  writeFileSync(join(dir, 'lid.step'), kernel.exportStep(kernel.makeBox(10, 20, 5)));
  // The same box as a mesh (T9.1).
  writeFileSync(join(dir, 'box.stl'), kernel.exportStl(kernel.makeBox(10, 20, 30), 0.1));

  // A fake `claude` for the one-click Connect (R4): logs its arguments, one call per line.
  claudeLog = join(dir, 'claude-calls.log');
  if (process.platform === 'win32') {
    fakeClaude = join(dir, 'claude.cmd');
    writeFileSync(fakeClaude, `@echo %*>> "${claudeLog}"\r\n@exit /b 0\r\n`);
  } else {
    fakeClaude = join(dir, 'claude');
    writeFileSync(fakeClaude, `#!/bin/sh\necho "$*" >> '${claudeLog}'\n`, { mode: 0o755 });
  }

  geminiLog = join(dir, 'gemini-calls.log');
  if (process.platform === 'win32') {
    fakeGemini = join(dir, 'gemini.cmd');
    writeFileSync(fakeGemini, `@echo %*>> "${geminiLog}"\r\n@exit /b 0\r\n`);
  } else {
    fakeGemini = join(dir, 'gemini');
    writeFileSync(fakeGemini, `#!/bin/sh\necho "$*" >> '${geminiLog}'\n`, { mode: 0o755 });
  }
  codexHome = join(dir, 'codex-home');

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE']; // set when started from some editors; Electron must run as an app
  delete env['ELECTRON_RENDERER_URL']; // use the built renderer, not a dev server
  app = await electron.launch({
    // Own profile: the app's saved settings (e.g. the selection filter) must not leak in or out.
    args: [appDir, `--user-data-dir=${join(dir, 'profile')}`, ...scaleArgs],
    env: {
      ...env,
      THIRD_WHEEL_OPEN: boxPath,
      THIRD_WHEEL_TEST: '1',
      THIRD_WHEEL_BRIDGE_FILE: bridgeFile,
      THIRD_WHEEL_CLAUDE: fakeClaude,
      THIRD_WHEEL_GEMINI: fakeGemini,
      THIRD_WHEEL_CODEX_HOME: codexHome,
    },
  });
  // After a failed test Playwright starts a fresh worker (and app): the next test must not
  // start while the window is still loading or the box isn't open yet (T11.1, Windows).
  await loadedWindow();
});

/**
 * The app's window once the box opened on start (`THIRD_WHEEL_OPEN`) is shown. Waits for `loaded()`,
 * not `model()`: that is set before the notes are read and the model is drawn, so a test could
 * pick an empty view (T12.1).
 */
async function loadedWindow(): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.loaded() === true, {
    timeout: 60_000,
  });
  return page;
}

test.afterAll(async () => {
  await app.close();
  expect(existsSync(bridgeFile), 'the app removes its bridge file on quit').toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('picks a vertex, an edge and a face of the box; a click selects', async () => {
  const page = await loadedWindow();
  // The window is shown on 'ready-to-show' and may still resize: wait until it is visible and
  // the canvas keeps its size for a few frames, so projected positions stay valid for the click.
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const canvas = document.querySelector('#viewport canvas');
        let last = '';
        let stable = 0;
        const step = (): void => {
          const size = `${String(canvas?.clientWidth)}x${String(canvas?.clientHeight)}`;
          stable = size === last ? stable + 1 : 0;
          last = size;
          if (stable >= 5) done();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );

  const picks = await page.evaluate(() => {
    const hook = (window as HookWindow).__thirdWheelTest;
    const model = hook?.model();
    if (!hook || !model) throw new Error('test hook missing');
    const at = (p: [number, number, number]): ReturnType<TestHook['viewport']['pick']> => {
      const s = hook.viewport.projectToCanvas(p);
      return hook.viewport.pick(s.x, s.y);
    };
    const xyz = (a: Float32Array, i: number): [number, number, number] => [
      a[i * 3] ?? 0,
      a[i * 3 + 1] ?? 0,
      a[i * 3 + 2] ?? 0,
    ];

    // Every vertex / edge / face aimed at directly; the visible ones must pick themselves.
    const vertexHits: number[] = [];
    for (let v = 0; v < model.vertexPositions.length / 3; v++) {
      const hit = at(xyz(model.vertexPositions, v));
      if (hit?.kind === 'vertex' && hit.id === v) vertexHits.push(v);
    }
    const edgeHits: number[] = [];
    for (let e = 0; e < model.edgeRanges.length / 2; e++) {
      const first = model.edgeRanges[e * 2] ?? 0;
      const n = model.edgeRanges[e * 2 + 1] ?? 0;
      const a = xyz(model.edgePoints, first);
      const b = xyz(model.edgePoints, first + n - 1);
      const hit = at([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      if (hit?.kind === 'edge' && hit.id === e) edgeHits.push(e);
    }
    const faceHits: number[] = [];
    const faceCount = Math.max(...model.triangleFace) + 1;
    const faceCentres: [number, number, number][] = [];
    for (let f = 0; f < faceCount; f++) {
      let [x, y, z, n] = [0, 0, 0, 0];
      model.triangleFace.forEach((tf, t) => {
        if (tf !== f) return;
        for (let k = 0; k < 3; k++) {
          const p = xyz(model.positions, model.indices[t * 3 + k] ?? 0);
          x += p[0];
          y += p[1];
          z += p[2];
          n++;
        }
      });
      const centre: [number, number, number] = [x / n, y / n, z / n];
      faceCentres.push(centre);
      const hit = at(centre);
      if (hit?.kind === 'face' && hit.id === f) faceHits.push(f);
    }
    const firstFace = faceHits[0];
    const centre = firstFace === undefined ? undefined : faceCentres[firstFace];
    const click =
      firstFace === undefined || !centre
        ? undefined
        : { face: firstFace, ...hook.viewport.projectToCanvas(centre) };
    return { vertexHits, edgeHits, faceHits, click };
  });

  // From a corner view of a box: 7 vertices, 9 edges and 3 faces are visible.
  expect(picks.vertexHits.length).toBeGreaterThanOrEqual(1);
  expect(picks.edgeHits.length).toBeGreaterThanOrEqual(1);
  expect(picks.faceHits.length).toBeGreaterThanOrEqual(1);

  // A real mouse click on a face selects it (T2.2); clicking it again removes it (T2.6).
  const click = picks.click;
  expect(click).toBeDefined();
  if (!click) return;
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const pickAt = (p: { x: number; y: number }) =>
    page.evaluate((q) => (window as HookWindow).__thirdWheelTest?.viewport.pick(q.x, q.y), p);
  const selectedList = (): Promise<{ kind: string; id: number }[] | undefined> =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.selection.list());
  // T12.1: this test failed now and then on a selection check after a click. Record what the
  // view received (pointer events, canvas resizes) so a failure says why.
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __t121: string[] }).__t121 = log;
    const canvas = document.querySelector('#viewport canvas');
    const t0 = performance.now();
    const at = (): string => `${(performance.now() - t0).toFixed(0)}ms`;
    for (const type of ['pointerdown', 'pointerup', 'dblclick'] as const)
      window.addEventListener(
        type,
        (e) => {
          const el = e.target as Element;
          log.push(
            `${at()} ${type} target=${el.tagName.toLowerCase()}#${el.id}.${el.className} ` +
              `xy=${String(e.clientX)},${String(e.clientY)} detail=${String(e.detail)}`,
          );
        },
        { capture: true },
      );
    if (canvas)
      new ResizeObserver(() => {
        log.push(`${at()} canvas ${String(canvas.clientWidth)}x${String(canvas.clientHeight)}`);
      }).observe(canvas);
  });
  const expectSelection = async (want: { kind: string; id: number }[]): Promise<void> => {
    const got = await selectedList();
    const why =
      JSON.stringify(got) === JSON.stringify(want)
        ? ''
        : await page.evaluate(
            (q) =>
              [
                `pick at click point now: ${JSON.stringify((window as HookWindow).__thirdWheelTest?.viewport.pick(q.x, q.y))}`,
                ...(window as unknown as { __t121: string[] }).__t121.slice(-12),
              ].join('\n'),
            click,
          );
    expect(got, `selection after click (T12.1 log):\n${why}`).toEqual(want);
  };
  expect(await pickAt(click), 'pick under the click point just before clicking').toMatchObject({
    kind: 'face',
    id: click.face,
  });
  await canvas.click({ position: { x: click.x, y: click.y } });
  await expectSelection([{ kind: 'face', id: click.face }]);
  await page.waitForTimeout(800); // longer than a double click: two separate clicks
  await canvas.click({ position: { x: click.x, y: click.y } });
  await expectSelection([]);

  // A click on empty space does nothing; a double click there clears (T2.6).
  const empty = { x: 8, y: box.height - 8 };
  expect(await pickAt(empty), 'canvas corner is empty').toBeUndefined();
  await canvas.click({ position: { x: click.x, y: click.y } });
  await page.waitForTimeout(800);
  await canvas.click({ position: empty });
  await expectSelection([{ kind: 'face', id: click.face }]);
  await page.waitForTimeout(800);
  await canvas.dblclick({ position: empty });
  await expectSelection([]);

  // Double click = the whole body, with the default filter (T2.3); again = removed (T2.6).
  await canvas.dblclick({ position: { x: click.x, y: click.y } });
  await expectSelection([{ kind: 'body', id: 0 }]);
  await page.waitForTimeout(800);
  await canvas.dblclick({ position: { x: click.x, y: click.y } });
  await expectSelection([]);

  // Filter: Face off + Body on → the same spot picks the body.
  const filterButton = (name: string) =>
    page.locator('#selection-filter button', { hasText: name });
  await filterButton('Body').click();
  await filterButton('Face').click();
  await expect(filterButton('Face')).toHaveAttribute('aria-pressed', 'false');
  expect(await pickAt(click)).toMatchObject({ kind: 'body', id: 0 });
  await filterButton('Body').click(); // Face and Body off: a face picks nothing
  expect(await pickAt(click)).toBeUndefined();

  // Double click adds the body even with Face and Body off; modifiers change nothing.
  await canvas.dblclick({ position: { x: click.x, y: click.y }, modifiers: ['Shift'] });
  await expectSelection([{ kind: 'body', id: 0 }]);

  // A double click on the view cube never selects, even right after a model click (review fix).
  await page.keyboard.press('Escape');
  await expectSelection([]);
  await filterButton('Face').click(); // back on
  await canvas.click({ position: { x: click.x, y: click.y } });
  await expectSelection([{ kind: 'face', id: click.face }]);
  await canvas.dblclick({ position: { x: box.width - 60, y: 60 } }); // view cube centre
  await expectSelection([{ kind: 'face', id: click.face }]);

  // Box select (T2.4, T2.6): in the Select tool (Fusion style) a left drag draws a box.
  // Left→right over the whole view adds exactly the visible faces (back faces never) plus
  // visible edges and vertices. The cube double-click turned the camera: back to Iso first.
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600); // 250 ms camera move
  const seen = await page.evaluate(() => {
    const hook = (window as HookWindow).__thirdWheelTest;
    const model = hook?.model();
    if (!hook || !model) throw new Error('test hook missing');
    const faces: number[] = [];
    let at: { x: number; y: number; face: number } | undefined;
    const faceCount = Math.max(...model.triangleFace) + 1;
    for (let f = 0; f < faceCount; f++) {
      const c = [0, 0, 0];
      let n = 0;
      model.triangleFace.forEach((tf, t) => {
        if (tf !== f) return;
        for (let k = 0; k < 3; k++) {
          const v = model.indices[t * 3 + k] ?? 0;
          for (let a = 0; a < 3; a++) c[a] = (c[a] ?? 0) + (model.positions[v * 3 + a] ?? 0);
          n++;
        }
      });
      const s = hook.viewport.projectToCanvas([(c[0] ?? 0) / n, (c[1] ?? 0) / n, (c[2] ?? 0) / n]);
      const hit = hook.viewport.pick(s.x, s.y);
      if (hit?.kind !== 'face' || hit.id !== f) continue;
      faces.push(f);
      at ??= { ...s, face: f };
    }
    return { faces, at };
  });
  expect(seen.faces.length).toBeGreaterThanOrEqual(2);
  const target = seen.at;
  if (!target) throw new Error('no visible face');
  /** Left drag; `held` keys are down from the press, `atEnd` keys only just before the release. */
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    { held = [], atEnd = [] }: { held?: string[]; atEnd?: string[] } = {},
  ): Promise<void> => {
    for (const m of held) await page.keyboard.down(m);
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 3 });
    for (const m of atEnd) await page.keyboard.down(m);
    await page.mouse.up();
    for (const m of [...atEnd, ...held]) await page.keyboard.up(m);
  };
  const faceIds = (list: { kind: string; id: number }[] | undefined): number[] =>
    (list ?? [])
      .filter((i) => i.kind === 'face')
      .map((i) => i.id)
      .sort((a, b) => a - b);
  const whole = { left: { x: 5, y: box.height - 5 }, right: { x: box.width - 5, y: 5 } };
  await drag(whole.left, whole.right);
  const all = (await selectedList()) ?? [];
  expect(faceIds(all)).toEqual(seen.faces);
  expect(all.some((i) => i.kind === 'edge')).toBe(true);
  expect(all.some((i) => i.kind === 'vertex')).toBe(true);
  // Right→left over the whole view removes everything visible again.
  await drag(whole.right, whole.left);
  await expectSelection([]);

  // A small box inside one face: inside (no Alt) adds nothing; crossing (Alt pressed during the
  // drag) adds just that face; right→left crossing removes it and leaves the rest.
  const small = {
    left: { x: target.x - 3, y: target.y - 3 },
    right: { x: target.x + 3, y: target.y + 3 },
  };
  await drag(small.left, small.right);
  await expectSelection([]);
  await canvas.dblclick({ position: { x: target.x, y: target.y } });
  await expectSelection([{ kind: 'body', id: 0 }]);
  await drag(small.left, small.right, { atEnd: ['Alt'] });
  expect(await selectedList()).toEqual([
    { kind: 'body', id: 0 },
    { kind: 'face', id: target.face },
  ]);
  await drag(small.right, small.left, { atEnd: ['Alt'] });
  await expectSelection([{ kind: 'body', id: 0 }]);

  // Slicer style: Shift + left drag from empty space draws a box instead of panning (T2.6).
  await page.keyboard.press('Escape');
  await page.locator('#nav-style').selectOption('slicer');
  await drag(whole.left, whole.right, { held: ['Shift'] });
  expect(faceIds(await selectedList())).toEqual(seen.faces);
  expect(await pickAt(target), 'camera did not move').toMatchObject({ id: target.face });
  await page.locator('#nav-style').selectOption('fusion');
});

test('Brush tools: circle cursor on the surface, crosshair for Smart fill, no selecting', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const hookEval = <T>(fn: () => T): Promise<T> => page.evaluate(fn);
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600); // 250 ms camera move
  // Canvas point over the centre of the +Z face (top, visible in Iso).
  const top = await hookEval(() => {
    const hook = (window as HookWindow).__thirdWheelTest;
    if (!hook) throw new Error('test hook missing');
    return hook.viewport.projectToCanvas([5, 10, 30]);
  });
  const cursorState = () =>
    hookEval(() => (window as HookWindow).__thirdWheelTest?.viewport.brushCursorState());
  const cssCursor = () => canvas.evaluate((c) => (c as HTMLCanvasElement).style.cursor);
  const tool = (name: string) => page.locator('#tools button', { hasText: name });

  // Select: no circle.
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await page.waitForTimeout(100);
  expect(await cursorState()).toBeUndefined();

  // B: a 3 mm brush circle lying on the top face, crosshair pointer; clicks don't select.
  await page.keyboard.press('b');
  await expect(tool('Brush')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + top.x + 1, box.y + top.y);
  await expect.poll(cursorState).toMatchObject({ radius: 3, style: 'brush' });
  const state = await cursorState();
  expect(state?.center[2]).toBeCloseTo(30, 3);
  expect(state?.normal[2]).toBeCloseTo(1, 5);
  expect(await cssCursor()).toBe('crosshair');
  await canvas.click({ position: top });
  expect(await hookEval(() => (window as HookWindow).__thirdWheelTest?.selection.list())).toEqual(
    [],
  );

  // Off the model: circle hidden, normal pointer.
  await page.mouse.move(box.x + 8, box.y + box.height - 8);
  await expect.poll(cursorState).toBeUndefined();
  expect(await cssCursor()).toBe('');

  // Shift in Brush: dashed red erase circle. E is no tool (removed). F: crosshair only.
  await page.keyboard.press('b');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await expect.poll(cursorState).toMatchObject({ style: 'erase' });
  await page.keyboard.up('Shift');
  await page.mouse.move(box.x + top.x + 2, box.y + top.y);
  await expect.poll(cursorState).toMatchObject({ style: 'brush' });
  await page.keyboard.press('e');
  await expect(tool('Brush')).toHaveAttribute('aria-pressed', 'true');
  await expect(tool('Erase')).toHaveCount(0);
  await tool('Smart fill').click();
  await page.mouse.move(box.x + top.x + 1, box.y + top.y);
  await expect.poll(cssCursor).toBe('crosshair');
  expect(await cursorState()).toBeUndefined();

  // Slicer style: a left drag starting on the model is the tool's (camera stays), not an orbit.
  await page.keyboard.press('b');
  await page.locator('#nav-style').selectOption('slicer');
  const corner = () =>
    hookEval(() => (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([0, 0, 0]));
  const before = await corner();
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await page.mouse.down();
  await page.mouse.move(box.x + top.x + 40, box.y + top.y + 10, { steps: 5 });
  await expect.poll(cursorState, 'circle follows the drag').toBeDefined();
  await page.mouse.up();
  const after = await corner();
  expect(after?.x).toBeCloseTo(before?.x ?? NaN, 3);
  expect(after?.y).toBeCloseTo(before?.y ?? NaN, 3);
  await page.locator('#nav-style').selectOption('fusion');

  await page.keyboard.press('v');
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await expect.poll(cursorState).toBeUndefined();
  expect(await cssCursor()).toBe('');
});

test('Sphere brush: paint, Shift erases, [ ] and Alt + scroll, hidden markers locked', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const painted = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.paint()?.count('m1') ?? -1);
  const shown = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.paintShownTriangles());
  const radius = () => page.evaluate(() => (window as HookWindow).__thirdWheelTest?.brushRadius());
  const cursorStyle = () =>
    page.evaluate(
      () => (window as HookWindow).__thirdWheelTest?.viewport.brushCursorState()?.style,
    );
  const info = page.locator('#brush-info');

  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');
  const strokeOnTop = async (held: string[] = []) => {
    for (const k of held) await page.keyboard.down(k);
    await page.mouse.move(box.x + top.x - 10, box.y + top.y);
    await page.mouse.down();
    await page.mouse.move(box.x + top.x + 10, box.y + top.y, { steps: 6 });
    await page.mouse.up();
    for (const k of held.reverse()) await page.keyboard.up(k);
  };

  // The earlier Brush test clicked the top face, so start from no paint.
  await page.keyboard.press('b');
  for (let i = 0; i < 25; i++) await page.keyboard.press(']');
  expect(await radius()).toBe(50);
  await expect(info).toHaveText(/^Brush 50 mm · \[ \] or Alt \+ scroll: size · Shift: erase \S/);
  await canvas.click({ position: top, modifiers: ['Shift'] });
  await expect.poll(painted).toBe(0);
  await expect.poll(shown).toBe(0);
  for (let i = 0; i < 12; i++) await page.keyboard.press('[');
  expect(await radius()).toBe(3);

  // Brush stroke on the top face paints its triangles with Marker 1, and they are drawn.
  await page.keyboard.press('b');
  await expect(info).toContainText('Brush 3 mm');
  await strokeOnTop();
  await expect.poll(painted).toBeGreaterThan(0);
  await expect.poll(shown).toBe(await painted());
  // T3.6: the 10 × 20 top face is 2 triangles; the 3 mm stroke cuts them and paints only a part.
  const area = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.paint()?.paintedArea('m1'),
  );
  expect(area).toBeGreaterThan(10);
  expect(area).toBeLessThan(190);
  await expect
    .poll(() =>
      page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.paintShownPieces()),
    )
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.isStroking()),
  ).toBe(false);

  // Shift + drag erases in Brush; the circle turns into the erase circle while Shift is held.
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await page.keyboard.down('Shift');
  await expect.poll(cursorStyle).toBe('erase');
  await page.keyboard.up('Shift');
  await expect.poll(cursorStyle).toBe('brush');
  // Shift pressed / let go during a stroke changes nothing: the mode is fixed at the press
  // (pressing it with the button still down used to erase the fresh paint).
  await page.mouse.move(box.x + top.x - 10, box.y + top.y);
  await page.mouse.down();
  await page.mouse.move(box.x + top.x + 10, box.y + top.y, { steps: 6 });
  const fresh = await painted();
  expect(fresh).toBeGreaterThan(0);
  await page.keyboard.down('Shift');
  await page.waitForTimeout(100);
  expect(await painted()).toBe(fresh);
  expect(await cursorStyle()).toBe('brush');
  await page.keyboard.up('Shift');
  await page.mouse.up();
  await strokeOnTop(['Shift']);
  await expect.poll(painted).toBe(0);

  // Alt + scroll up = larger, down = smaller.
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Alt');
  await expect.poll(radius).toBe(5);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Alt');
  await expect.poll(radius).toBe(3);

  // Hidden markers are locked: Shift-erase leaves their paint alone; Hide hides the paint.
  await strokeOnTop();
  const before = await painted();
  expect(before).toBeGreaterThan(0);
  const eye = page.locator('#markers li[data-marker]').first().locator('.marker-eye');
  await eye.click();
  await expect.poll(shown).toBe(0);
  await strokeOnTop(['Shift']);
  expect(await painted()).toBe(before);
  await eye.click();
  await expect.poll(shown).toBe(before);

  // Shift-erase removes only the active marker's paint; the readout under
  // the view names it, and says "Erasing …" while Shift is held (T10.1).
  const hint = info;
  await expect(hint).toHaveText(/Shift: erase Marker 1$/);
  await page.keyboard.down('Shift');
  await expect(hint).toHaveText('Erasing Marker 1 — release Shift to paint');
  await expect(hint).toHaveClass(/erasing/);
  await page.keyboard.up('Shift');
  await expect(hint).toHaveText(/Shift: erase Marker 1$/);
  const otherId = await page.evaluate(
    () => (window as HookWindow).__thirdWheelTest?.markers.add([], 'Other').id ?? '',
  );
  await page.evaluate((id) => {
    (window as HookWindow).__thirdWheelTest?.markers.setActive(id);
  }, otherId);
  await expect(hint).toHaveText(/Shift: erase Other$/);
  await strokeOnTop(['Shift']);
  expect(await painted()).toBe(before);
  await page.evaluate((id) => {
    const t = (window as HookWindow).__thirdWheelTest;
    t?.markers.remove(id);
    t?.markers.setActive('m1');
  }, otherId);
  await expect(hint).toHaveText(/Shift: erase Marker 1$/);
  await strokeOnTop(['Shift']);
  await expect.poll(painted).toBe(0);
  await page.keyboard.press('v');
  await expect(info).toHaveText('');
});

test('Smart fill: preview, click fills a face, angle, Shift erases, whole CAD face', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const painted = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.paint()?.count('m1') ?? -1);
  const preview = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.fillPreviewTriangles());
  const angle = () => page.evaluate(() => (window as HookWindow).__thirdWheelTest?.fillAngle());
  const info = page.locator('#brush-info');
  const options = page.locator('#fill-options');

  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');
  // Triangles of the top face (z = 30) and of the whole box.
  const { topTris, allTris } = await page.evaluate(() => {
    const m = (window as HookWindow).__thirdWheelTest?.model();
    if (!m) throw new Error('no model');
    const faces = new Set<number>();
    let all = 0;
    let onTop = 0;
    for (let t = 0; t < m.triangleFace.length; t++) {
      all++;
      const z = (k: number) => m.positions[(m.indices[t * 3 + k] ?? 0) * 3 + 2];
      if (z(0) === 30 && z(1) === 30 && z(2) === 30) {
        onTop++;
        faces.add(m.triangleFace[t] ?? -1);
      }
    }
    if (faces.size !== 1) throw new Error('top is not one face');
    return { topTris: onTop, allTris: all };
  });

  // Options appear only with Smart fill; hovering previews the face (90° edges stop the fill).
  await expect(options).toBeHidden();
  await page.keyboard.press('f');
  await expect(options).toBeVisible();
  for (let i = 0; i < 18; i++) await page.keyboard.press('['); // 0° whatever was saved
  for (let i = 0; i < 6; i++) await page.keyboard.press(']');
  await expect.poll(angle).toBe(30);
  await expect(info).toHaveText(
    /^Smart fill 30° · \[ \] or Alt \+ scroll: angle · Shift: erase \S/,
  );
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await expect.poll(preview).toBe(topTris);
  await canvas.click({ position: top });
  await expect.poll(painted).toBe(topTris);

  // 90° crosses the box edges: the whole box. Alt + scroll and the toolbar buttons change it.
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Alt');
  await expect.poll(angle).toBe(40);
  await page.locator('#fill-angle-down').click();
  await expect.poll(angle).toBe(35);
  for (let i = 0; i < 11; i++) await page.keyboard.press(']');
  await expect.poll(angle).toBe(90);
  await expect(page.locator('#fill-angle')).toHaveText('90°');
  await page.mouse.move(box.x + top.x + 1, box.y + top.y);
  await expect.poll(preview).toBe(allTris);
  await canvas.click({ position: top });
  await expect.poll(painted).toBe(allTris);

  // Shift + click erases the region.
  await page.keyboard.down('Shift');
  await canvas.click({ position: top });
  await page.keyboard.up('Shift');
  await expect.poll(painted).toBe(0);

  // Whole CAD face: exactly the clicked face, angle ignored (its buttons disabled).
  await page.locator('#fill-whole-face').check();
  await expect(info).toHaveText(/^Smart fill · whole CAD face · Shift: erase \S/);
  await expect(page.locator('#fill-angle-up')).toBeDisabled();
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await expect.poll(preview).toBe(topTris);
  await canvas.click({ position: top });
  await expect.poll(painted).toBe(topTris);

  // Clean up for later tests: no paint, default settings, Select.
  await page.keyboard.down('Shift');
  await canvas.click({ position: top });
  await page.keyboard.up('Shift');
  await expect.poll(painted).toBe(0);
  await page.locator('#fill-whole-face').uncheck();
  for (let i = 0; i < 12; i++) await page.keyboard.press('[');
  await expect.poll(angle).toBe(30);
  await page.keyboard.press('v');
  await expect(options).toBeHidden();
  await expect.poll(preview).toBe(0);
});

test('Markers: starts with Marker 1, add / rename / recolour / hide / delete, circle colour', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const section = page.locator('#markers');
  const rows = section.locator('li[data-marker]');
  const names = () => rows.locator('.marker-name').allTextContents();
  const cursorColor = async () =>
    (
      await page.evaluate(() =>
        (window as HookWindow).__thirdWheelTest?.viewport.brushCursorState(),
      )
    )?.color;

  await expect(rows).toHaveCount(1);
  expect(await names()).toEqual(['Marker 1']);
  await expect(rows.first()).toHaveClass(/active/);

  // Brush circle in the active marker's colour (Marker 1 = orange).
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');
  await page.keyboard.press('b');
  await page.mouse.move(box.x + top.x + 2, box.y + top.y); // must be a real move
  await expect.poll(cursorColor).toBe(0xff8a1f);

  // + Add: Marker 2, green, active; the circle follows.
  await section.locator('#marker-add').click();
  expect(await names()).toEqual(['Marker 1', 'Marker 2']);
  await expect(rows.nth(1)).toHaveClass(/active/);
  await page.mouse.move(box.x + top.x + 1, box.y + top.y);
  await expect.poll(cursorColor).toBe(0x2fbf71);

  // Click a row = active.
  await rows.first().locator('.marker-name').click();
  await expect(rows.first()).toHaveClass(/active/);

  // Double-click renames; Enter commits, Esc cancels (and keeps the selection logic out of it).
  await rows.first().locator('.marker-name').dblclick();
  const input = section.locator('.marker-name-input');
  await expect(input).toBeFocused();
  await input.fill('Too thin');
  await input.press('Enter');
  expect(await names()).toEqual(['Too thin', 'Marker 2']);
  await rows.first().locator('.marker-name').dblclick();
  await section.locator('.marker-name-input').fill('nope');
  await section.locator('.marker-name-input').press('Escape');
  expect(await names()).toEqual(['Too thin', 'Marker 2']);
  // Clicking another row while renaming keeps the name and activates that row in one click.
  await rows.first().locator('.marker-name').dblclick();
  await section.locator('.marker-name-input').fill('Too thin!');
  await rows.nth(1).locator('.marker-name').click();
  expect(await names()).toEqual(['Too thin!', 'Marker 2']);
  await expect(rows.nth(1)).toHaveClass(/active/);
  await rows.first().locator('.marker-name').dblclick();
  await section.locator('.marker-name-input').fill('Too thin');
  await section.locator('.marker-name-input').press('Enter');

  // Swatch → menu with 8 colours + Custom…; pick Purple.
  await rows.first().locator('.marker-swatch').click();
  const menu = section.locator('.color-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.color-choice')).toHaveCount(8);
  await expect(menu.locator('.color-custom')).toBeVisible();
  await menu.locator('.color-choice[title="Purple"]').click();
  await expect(menu).toBeHidden();
  await page.mouse.move(box.x + top.x, box.y + top.y);
  await expect.poll(cursorColor).toBe(0x8b5cf6);

  // Eye hides (row greyed, pressed=false).
  const eye = rows.first().locator('.marker-eye');
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expect(rows.first()).toHaveClass(/marker-hidden/);

  // Delete key on a focused row removes it (Backspace doesn't); focus moves to the next row.
  await rows.first().focus();
  await page.keyboard.press('Backspace');
  expect(await names()).toEqual(['Too thin', 'Marker 2']);
  await page.keyboard.press('Delete');
  expect(await names()).toEqual(['Marker 2']);
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await names()).toEqual(['Too thin', 'Marker 2']);

  // Delete the active marker → the other becomes active; delete the last → empty hint, grey circle.
  await rows.first().hover();
  await rows.first().locator('.marker-delete').click();
  expect(await names()).toEqual(['Marker 2']);
  await expect(rows.first()).toHaveClass(/active/);
  await rows.first().locator('.marker-delete').click();
  await expect(rows).toHaveCount(0);
  await expect(section.locator('.empty')).toBeVisible();
  await page.mouse.move(box.x + top.x + 1, box.y + top.y);
  await expect.poll(cursorColor).toBe(0x8d939d);
  await section.locator('#marker-add').click();
  expect(await names()).toEqual(['Marker 1']);
  await page.keyboard.press('v');
});

test('Undo / redo: a paint stroke, keys and buttons, marker delete brings its paint back', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const section = page.locator('#markers');
  const rows = section.locator('li[data-marker]');
  const undo = page.locator('#undo');
  const redo = page.locator('#redo');
  const activeId = await page.evaluate(
    () => (window as HookWindow).__thirdWheelTest?.markers.active()?.id ?? '',
  );
  expect(activeId).not.toBe('');
  const painted = () =>
    page.evaluate(
      (id) => (window as HookWindow).__thirdWheelTest?.paint()?.count(id) ?? -1,
      activeId,
    );

  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');
  await page.keyboard.press('b');
  await page.mouse.move(box.x + top.x - 10, box.y + top.y);
  await page.mouse.down();
  await page.mouse.move(box.x + top.x + 10, box.y + top.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(painted).toBeGreaterThan(0);
  const strokeCount = await painted();
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute('title', /^Undo Brush stroke \(/);
  await expect(redo).toBeDisabled();

  // Keys: Cmd/Ctrl+Z undoes the whole stroke, Cmd/Ctrl+Shift+Z redoes it.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(painted).toBe(0);
  await expect(redo).toBeEnabled();
  await expect(redo).toHaveAttribute('title', /^Redo Brush stroke \(/);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(painted).toBe(strokeCount);
  await expect(redo).toBeDisabled();

  // Delete doesn't ask; the undo button brings the marker and its paint back, redo drops them.
  const before = await rows.count();
  await rows.first().hover();
  await rows.first().locator('.marker-delete').click();
  await expect(rows).toHaveCount(before - 1);
  await expect(undo).toHaveAttribute('title', /^Undo Delete marker \(/);
  await undo.click();
  await expect(rows).toHaveCount(before);
  await expect.poll(painted).toBe(strokeCount);
  await redo.click();
  await expect(rows).toHaveCount(before - 1);
  await expect.poll(painted).toBe(0);
  await undo.click();
  await expect.poll(painted).toBe(strokeCount);

  // Undo the stroke, so later tests start from no paint.
  await undo.click();
  await expect.poll(painted).toBe(0);
  await page.keyboard.press('v');
});

test('Markers hold selections: right-click menu, + Selection, list, hide, undo', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const section = page.locator('#markers');
  const rows = section.locator('li[data-marker]');
  const menu = page.locator('.context-menu:not([hidden])');
  const undo = page.locator('#undo');
  const redo = page.locator('#redo');
  const stats = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.markerEntityStats());
  const selected = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.selection.list() ?? []);
  const clearSelection = () =>
    page.evaluate(() => {
      (window as HookWindow).__thirdWheelTest?.selection.clear();
    });

  await page.keyboard.press('v');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  await clearSelection();
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');
  const rowCount = await rows.count();

  // Right-click on the unselected top face selects it and opens the menu (like Fusion).
  await page.mouse.click(box.x + top.x, box.y + top.y, { button: 'right' });
  await expect(menu).toHaveCount(1);
  expect(await selected()).toEqual([expect.objectContaining({ kind: 'face' })]);
  await menu.locator('[data-action="add-to-marker"]').hover();
  await menu.locator('[data-action="new-marker"]').click();
  await expect(menu).toHaveCount(0);
  await expect(rows).toHaveCount(rowCount + 1);
  const newRow = rows.last();
  await expect(newRow).toHaveClass(/active/);
  await expect(newRow.locator('.marker-count')).toHaveText(/^1 item/);
  expect(await selected()).toEqual([]); // used up
  // Face = see-through tint (the 2 triangles of the box face) + its 4-sided outline.
  expect(await stats()).toEqual({ tris: 2, lines: 4, bodyLines: 0, dots: 0 });
  await expect(undo).toHaveAttribute('title', /^Undo New marker from selection \(/);

  // Undo / redo the new marker with its entity.
  await undo.click();
  await expect(rows).toHaveCount(rowCount);
  expect((await stats())?.tris).toBe(0);
  await redo.click();
  await expect(rows).toHaveCount(rowCount + 1);
  expect((await stats())?.tris).toBe(2);

  // Hiding the marker hides its entities.
  await newRow.locator('.marker-eye').click();
  expect((await stats())?.tris).toBe(0);
  await newRow.locator('.marker-eye').click();
  expect((await stats())?.tris).toBe(2);

  // "+ Selection" on the active row: greyed out with nothing selected, adds an edge.
  await clearSelection();
  const addSel = newRow.locator('.marker-add-selection');
  await expect(addSel).toBeDisabled();
  await page.evaluate(() => {
    (window as HookWindow).__thirdWheelTest?.selection.addAll([{ kind: 'edge', id: 0 }]);
  });
  await expect(addSel).toBeEnabled();
  await addSel.click();
  await expect(newRow.locator('.marker-count')).toHaveText(/^2 items/);
  expect(await selected()).toEqual([]);
  await expect(addSel).toBeDisabled();
  expect((await stats())?.lines).toBeGreaterThan(4);
  await expect(undo).toHaveAttribute('title', /^Undo Add to marker \(/);

  // The list under the row: closed by default; click selects, × removes.
  const list = section.locator('.marker-entities');
  await expect(list).toHaveCount(0);
  await newRow.locator('.marker-count').click();
  await expect(list.locator('.marker-entity')).toHaveCount(2);
  await expect(list.locator('.marker-entity').first()).toContainText('Face');
  await clearSelection();
  await list.locator('.marker-entity').first().locator('.marker-entity-label').click();
  expect(await selected()).toEqual([expect.objectContaining({ kind: 'face' })]);
  await list.locator('.marker-entity').nth(1).hover();
  await list.locator('.marker-entity').nth(1).locator('.marker-entity-remove').click();
  await expect(list.locator('.marker-entity')).toHaveCount(1);
  expect(await stats()).toEqual({ tris: 2, lines: 4, bodyLines: 0, dots: 0 });

  // Right-click on the background with nothing selected: everything greyed out; Esc closes.
  await clearSelection();
  await page.mouse.click(box.x + 8, box.y + box.height - 8, { button: 'right' });
  await expect(menu).toHaveCount(1);
  await expect(menu).toContainText('Select something first');
  await expect(menu.locator('[data-action="add-to-marker"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Right-click the face again → "Remove from marker ▸" lists only markers holding it.
  await page.mouse.click(box.x + top.x, box.y + top.y, { button: 'right' });
  await menu.locator('[data-action="remove-from-marker"]').hover();
  const removeItems = page.locator('.context-menu [data-action^="remove-from:"]');
  await expect(removeItems).toHaveCount(1);
  await removeItems.click();
  await expect(newRow.locator('.marker-count')).toHaveCount(0);
  expect((await stats())?.tris).toBe(0);

  // Leave the app as found: drop the marker, clear the selection.
  await newRow.hover();
  await newRow.locator('.marker-delete').click();
  await expect(rows).toHaveCount(rowCount);
  await clearSelection();
});

test('Toolbar second row follows the tool: Pick + Add to marker, marker + size / angle; fits 960 px', async () => {
  const page = await app.firstWindow();
  const rows = page.locator('#markers li[data-marker]');
  const menu = page.locator('.context-menu:not([hidden])');
  const filterRow = page.locator('#selection-filter');
  const addTo = page.locator('#add-to-marker');
  const paintMarker = page.locator('#paint-marker');
  const brushOptions = page.locator('#brush-options');
  const fillOptions = page.locator('#fill-options');
  const hint = page.locator('#brush-info'); // names the marker Shift erases (T10.1)
  const setSelection = (items: { kind: 'edge'; id: number }[]) =>
    page.evaluate((list) => {
      const sel = (window as HookWindow).__thirdWheelTest?.selection;
      sel?.clear();
      sel?.addAll(list);
    }, items);

  // Select: Pick filter + "Add to marker ▾" (greyed out with nothing selected).
  await page.keyboard.press('v');
  await setSelection([]);
  await expect(filterRow).toBeVisible();
  await expect(paintMarker).toBeHidden();
  await expect(brushOptions).toBeHidden();
  await expect(hint).toHaveText('');
  await expect(addTo).toBeDisabled();
  await setSelection([{ kind: 'edge', id: 0 }]);
  await expect(addTo).toBeEnabled();
  const rowCount = await rows.count();
  await addTo.click();
  await expect(menu).toHaveCount(1);
  await expect(menu.locator('[data-action^="add-to:"]')).toHaveCount(rowCount);
  await addTo.click(); // the button toggles the dropdown
  await expect(menu).toHaveCount(0);
  await addTo.click();
  await menu.locator('[data-action="new-marker"]').click();
  await expect(rows).toHaveCount(rowCount + 1);
  await expect(rows.last().locator('.marker-count')).toHaveText(/^1 item/);

  // Brush: the marker it paints with (the new one is active), size, Shift hint; no Pick.
  await page.keyboard.press('b');
  await expect(filterRow).toBeHidden();
  await expect(paintMarker).toBeVisible();
  await expect(brushOptions).toBeVisible();
  await expect(fillOptions).toBeHidden();
  const lastName = (await rows.last().locator('.marker-name').textContent()) ?? '';
  await expect(hint).toHaveText(new RegExp(`Shift: erase ${lastName}$`));
  await expect(page.locator('#active-marker-name')).toHaveText(lastName);
  const size = page.locator('#brush-size');
  const before = await size.textContent();
  await page.locator('#brush-size-up').click();
  await expect(size).not.toHaveText(before ?? '');
  await page.locator('#brush-size-down').click();
  await expect(size).toHaveText(before ?? '');
  // The dropdown switches the active marker (ticked) — same as clicking its row.
  await page.locator('#active-marker').click();
  const firstChoice = menu.locator('[data-action^="paint-with:"]').first();
  await expect(menu.locator('[aria-checked="true"]')).toHaveCount(1);
  await firstChoice.click();
  await expect(rows.first()).toHaveClass(/active/);
  const firstName = (await rows.first().locator('.marker-name').textContent()) ?? '';
  await expect(page.locator('#active-marker-name')).toHaveText(firstName);

  // Smart fill: marker + angle options; no brush size.
  await page.keyboard.press('f');
  await expect(paintMarker).toBeVisible();
  await expect(brushOptions).toBeHidden();
  await expect(fillOptions).toBeVisible();
  await expect(hint).toContainText('Shift: erase');

  // Leave the app as found.
  await page.keyboard.press('v');
  await rows.last().hover();
  await rows.last().locator('.marker-delete').click();
  await expect(rows).toHaveCount(rowCount);
  await setSelection([]);

  // T10.1: one row from the 960 px minimum window up — nothing cut off, no wrap, and the tool
  // options start at the same place for every tool (no jump on tool switch).
  const setWidth = (w: number) =>
    app.evaluate(({ BrowserWindow }, width) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [, h] = win?.getContentSize() ?? [0, 800];
      win?.setContentSize(width, h ?? 800);
    }, w);
  const original = await page.evaluate(() => window.innerWidth);
  for (const width of [960, 1100, 1440]) {
    await setWidth(width);
    // At 175 % display scaling Windows rounds the content size: 960 → innerWidth 961 (T11.1).
    await expect
      .poll(async () => Math.abs((await page.evaluate(() => window.innerWidth)) - width))
      .toBeLessThanOrEqual(1);
    const inner = await page.evaluate(() => window.innerWidth);
    // The toolbar refits on its ResizeObserver: let two frames pass before measuring.
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              done();
            });
          });
        }),
    );
    const starts: number[] = [];
    for (const key of ['v', 'b', 'f']) {
      await page.keyboard.press(key);
      const m = await page.evaluate(() => {
        const tb = document.querySelector<HTMLElement>('.toolbar');
        const opts = [...document.querySelectorAll<HTMLElement>('#selection-filter, #paint-marker')]
          .filter((e) => !e.hidden)
          .map((e) => e.getBoundingClientRect().left);
        return {
          over: (tb?.scrollWidth ?? 0) - (tb?.clientWidth ?? 0),
          h: tb?.getBoundingClientRect().height ?? 0,
          sendRight: document.getElementById('send-ai')?.getBoundingClientRect().right ?? 0,
          start: opts[0] ?? -1,
        };
      });
      expect(m.over, `toolbar overflows at ${String(width)} px (${key})`).toBeLessThanOrEqual(0);
      // Fractional display scaling (Windows 175 %) leaves float noise: 44.0000038 (T11.1).
      expect(m.h).toBeCloseTo(44, 2);
      expect(m.sendRight).toBeLessThanOrEqual(inner + 0.01);
      starts.push(Math.round(m.start * 100) / 100);
    }
    expect(new Set(starts).size, `tool options move at ${String(width)} px`).toBe(1);
  }
  await setWidth(original);
  await page.keyboard.press('v');
});

test('Comments: write on a marker, focus, click geometry, on selection, resolve, edit, delete', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const section = page.locator('#comments');
  const cards = section.locator('li[data-comment]');
  const composer = section.locator('.comment-box');
  const input = composer.locator('textarea');
  const markerRows = page.locator('#markers li[data-marker]');
  const undo = page.locator('#undo');
  const redo = page.locator('#redo');
  const focusStats = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.commentFocusStats());
  const clearSelection = () =>
    page.evaluate(() => {
      (window as HookWindow).__thirdWheelTest?.selection.clear();
    });

  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
  );
  if (!top) throw new Error('no projection');

  // A fresh marker painted on the top face with Smart fill.
  await page.locator('#marker-add').click();
  const markerId = await page.evaluate(
    () => (window as HookWindow).__thirdWheelTest?.markers.active()?.id ?? '',
  );
  await page.keyboard.press('f');
  await page.mouse.click(box.x + top.x, box.y + top.y);
  await page.keyboard.press('v');
  const markerName = (await markerRows.last().locator('.marker-name').textContent()) ?? '';

  // "+ Comment": the active marker is ticked; Cmd/Ctrl+Enter posts.
  await expect(composer).toBeHidden();
  await section.locator('#comment-add').click();
  await expect(composer).toBeVisible();
  await expect(input).toBeFocused();
  await expect(composer.locator('.comment-chip')).toHaveText(markerName);
  await expect(page.locator('#comment-post')).toBeDisabled();
  await input.fill('Top face: add a 1 mm chamfer');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(composer).toBeHidden();
  await expect(cards).toHaveCount(1);
  const card = cards.first();
  await expect(card.locator('.comment-text')).toHaveText('Top face: add a 1 mm chamfer');
  await expect(card.locator('.comment-chip')).toHaveText(markerName);
  await expect(card.locator('.comment-author')).toHaveText('You');
  await expect(undo).toHaveAttribute('title', /^Undo Add comment \(/);
  expect(await focusStats()).toEqual({ items: 0, markers: 0, faded: 0 });

  // Clicking the card highlights it: its marker keeps its colour, the others fade; the camera
  // doesn't move. ⌖ zooms; a double-click edits and leaves it highlighted.
  const cameraProbe = () =>
    page.evaluate(() =>
      (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
    );
  const before = await cameraProbe();
  await card.locator('.comment-text').click();
  await expect(card).toHaveClass(/focused/);
  const focused = await focusStats();
  expect(focused).toMatchObject({ items: 0, markers: 1 });
  expect(focused?.faded).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const after = await cameraProbe();
  expect(after?.x).toBeCloseTo(before?.x ?? NaN, 3);
  expect(after?.y).toBeCloseTo(before?.y ?? NaN, 3);
  await card.locator('.comment-text').click();
  await expect(card).not.toHaveClass(/focused/);
  expect((await focusStats())?.markers).toBe(0);
  await card.locator('[data-action="zoom"]').click();
  await expect(card).toHaveClass(/focused/);
  await page.waitForTimeout(600);
  const zoomed = await cameraProbe();
  expect(
    Math.hypot((zoomed?.x ?? 0) - (before?.x ?? 0), (zoomed?.y ?? 0) - (before?.y ?? 0)),
  ).toBeGreaterThan(5);
  await card.locator('.comment-text').click(); // unfocus
  await card.locator('.comment-text').dblclick();
  await expect(card).toHaveClass(/focused/);
  await expect(composer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  await card.locator('.comment-text').click(); // unfocus
  expect((await focusStats())?.markers).toBe(0);
  // Back to the whole box in the iso view for the clicks below.
  await clearSelection();
  await page.keyboard.press('z');
  await page.keyboard.press('0');
  await page.waitForTimeout(800);
  const topNow = await cameraProbe();
  if (!topNow) throw new Error('no projection');
  top.x = topNow.x;
  top.y = topNow.y;

  // Clicking the painted face in the view lists its comment; it still selects as before. Below
  // left of the face centre: the comment's 3D pin (T4.3) sits on the centre, reaching up-right.
  top.x -= 12;
  top.y += 8;
  await clearSelection();
  await page.mouse.click(box.x + top.x, box.y + top.y);
  await expect(card).toHaveClass(/here/);
  await expect(section.locator('.comment-here-bar')).toContainText('1 comment');
  expect(
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.selection.list().length),
  ).toBe(1);
  // A click on the background clears the list.
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(card).not.toHaveClass(/here/);

  // Comment on selection (right-click menu): a new marker "Comment 1" holding the selection,
  // made on post — one undo step together with the comment.
  const markerCount = await markerRows.count();
  await page.mouse.click(box.x + top.x, box.y + top.y, { button: 'right' });
  await page.locator('.context-menu [data-action="comment-on-selection"]').click();
  await expect(composer).toBeVisible();
  await expect(composer.locator('.comment-chip.pending')).toContainText('Comment 1');
  await expect(markerRows).toHaveCount(markerCount);
  await input.fill('Why is this face so thin?');
  await page.locator('#comment-post').click();
  await expect(cards).toHaveCount(2);
  await expect(markerRows).toHaveCount(markerCount + 1);
  await expect(markerRows.last().locator('.marker-name')).toHaveText('Comment 1');
  await expect(cards.nth(1).locator('.comment-chip')).toHaveText('Comment 1');
  await expect(undo).toHaveAttribute('title', /^Undo Comment on selection \(/);
  // Posting used the selection up: the next comment doesn't pick it up again.
  expect(
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.selection.list().length),
  ).toBe(0);
  await cards.nth(1).locator('.comment-text').click();
  expect((await focusStats())?.items).toBe(1);
  await undo.click();
  await expect(cards).toHaveCount(1);
  await expect(markerRows).toHaveCount(markerCount);
  expect(await focusStats()).toEqual({ items: 0, markers: 0, faded: 0 });
  await redo.click();
  await expect(cards).toHaveCount(2);
  await expect(markerRows).toHaveCount(markerCount + 1);
  await clearSelection();

  // Resolve hides the card; "Show resolved" brings it back dimmed; Reopen.
  const footer = section.locator('.comment-show-closed');
  await expect(footer).toBeHidden();
  await card.locator('[data-action="resolve"]').click();
  await expect(cards).toHaveCount(1);
  await expect(footer).toContainText('Show resolved (1)');
  await footer.locator('input').check();
  await expect(cards).toHaveCount(2);
  await expect(card).toHaveClass(/closed/);
  await expect(card.locator('.comment-status')).toHaveText('Resolved');
  await card.locator('[data-action="resolve"]').click(); // now "Reopen"
  await expect(card).not.toHaveClass(/closed/);
  await expect(footer).toBeHidden(); // nothing closed; "Show resolved" stays on (remembered)

  // ⋯ → Won't fix, then Edit (text + markers), then Delete; undo brings it back.
  const menu = page.locator('.context-menu:not([hidden])');
  await card.locator('[data-action="more"]').click();
  await menu.locator('[data-action="status:wontfix"]').click();
  await expect(cards).toHaveCount(2);
  await expect(card.locator('.comment-status')).toHaveText('Won’t fix');
  await card.locator('[data-action="more"]').click();
  await menu.locator('[data-action="edit"]').click();
  await expect(input).toHaveValue('Top face: add a 1 mm chamfer');
  await input.fill('Top face: 2 mm chamfer');
  await composer.locator('.comment-markers-btn').click();
  await menu.locator(`[data-action="attach:${markerId}"]`).click(); // untick
  await expect(composer.locator('.comment-chips-none')).toBeVisible();
  await page.locator('#comment-post').click();
  await expect(card.locator('.comment-text')).toHaveText('Top face: 2 mm chamfer');
  await expect(card.locator('.comment-chip')).toHaveCount(0);
  await card.locator('[data-action="more"]').click();
  await menu.locator('[data-action="delete"]').click();
  await expect(cards).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cards).toHaveCount(2);
  const texts = await page.evaluate(() =>
    (window as HookWindow).__thirdWheelTest?.comments.list().map((c) => c.text),
  );
  expect(texts).toEqual(['Top face: 2 mm chamfer', 'Why is this face so thin?']);

  // With a selection, "+ Comment" comments on it: a pending new marker, made on post;
  // Esc in the writing box cancels only (keeps the selection, no marker).
  await page.evaluate(() => {
    (window as HookWindow).__thirdWheelTest?.selection.addAll([{ kind: 'edge', id: 0 }]);
  });
  const markersBefore = await markerRows.count();
  await section.locator('#comment-add').click();
  await expect(composer.locator('.comment-chip.pending')).toContainText('Comment 2');
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  await expect(markerRows).toHaveCount(markersBefore);
  expect(
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.selection.list().length),
  ).toBe(1);
  await footer.locator('input').uncheck();
  await clearSelection();
});

test('Comment pins: numbered on the marker, fade behind, hide with it, click = card click', async () => {
  const page = await app.firstWindow();
  const canvas = page.locator('#viewport canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const section = page.locator('#comments');
  const pins = () =>
    page.evaluate(() => (window as HookWindow).__thirdWheelTest?.viewport.pinStats() ?? []);
  const project = (p: [number, number, number]) =>
    page.evaluate((q) => (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas(q), p);

  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const top = await project([5, 10, 30]);
  if (!top) throw new Error('no projection');

  // A new marker on the top face (Smart fill) + a comment on it → a pin numbered like its card.
  // (Below left of the centre: an earlier comment's pin sits on the centre.)
  await page.locator('#marker-add').click();
  await page.keyboard.press('f');
  await page.mouse.click(box.x + top.x - 12, box.y + top.y + 8);
  await page.keyboard.press('v');
  const markerRow = page.locator('#markers li[data-marker]').last();
  await section.locator('#comment-add').click();
  await section.locator('.comment-box textarea').fill('Pin me');
  await page.keyboard.press('ControlOrMeta+Enter');
  const id = await page.evaluate(
    () => (window as HookWindow).__thirdWheelTest?.comments.list().at(-1)?.id ?? '',
  );
  const card = section.locator(`li[data-comment="${id}"]`);
  const number = Number(((await card.locator('.comment-num').textContent()) ?? '').slice(1));
  await expect.poll(async () => (await pins()).find((p) => p.id === id)?.number).toBe(number);
  let pin = (await pins()).find((p) => p.id === id);
  // Anchored on the top face (z = 30): the pin's tip is where that face's centre projects.
  expect(pin?.behind).toBe(false);
  expect(Math.hypot((pin?.x ?? 0) - top.x, (pin?.y ?? 0) - top.y)).toBeLessThan(40);

  // From below the top face is behind the box: the pin fades but stays.
  await page.keyboard.press('5');
  await page.waitForTimeout(600);
  await expect.poll(async () => (await pins()).find((p) => p.id === id)?.behind).toBe(true);
  await page.keyboard.press('0');
  await page.waitForTimeout(600);

  // Hiding its only marker hides the pin.
  await markerRow.locator('.marker-eye').click();
  await expect.poll(async () => (await pins()).some((p) => p.id === id)).toBe(false);
  await markerRow.locator('.marker-eye').click();
  await expect.poll(async () => (await pins()).some((p) => p.id === id)).toBe(true);

  // Clicking the pin = clicking the card (highlight, again = off); double click edits.
  const pinEl = page.locator(`.comment-pin[data-pin="${id}"]`);
  await pinEl.click();
  await expect(card).toHaveClass(/focused/);
  await expect(pinEl).toHaveClass(/focused/);
  pin = (await pins()).find((p) => p.id === id);
  expect(pin?.focused).toBe(true);
  await pinEl.click();
  await expect(card).not.toHaveClass(/focused/);
  await pinEl.dblclick();
  await expect(card).toHaveClass(/focused/);
  await expect(section.locator('.comment-box')).toBeVisible();
  await page.keyboard.press('Escape');
  await pinEl.click(); // unfocus

  // Resolved → no pin (unless "Show resolved"); deleting the comment removes it too.
  await card.locator('[data-action="resolve"]').click();
  await expect.poll(async () => (await pins()).some((p) => p.id === id)).toBe(false);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await pins()).some((p) => p.id === id)).toBe(true);
  await card.locator('[data-action="more"]').click();
  await page.locator('.context-menu:not([hidden]) [data-action="delete"]').click();
  await expect.poll(async () => (await pins()).some((p) => p.id === id)).toBe(false);
  // A marker on the top and the bottom face: after the camera comes to rest the pin sits on the
  // face the camera can see (T4.3), not faded on the hidden one.
  const pickFace = async (p: [number, number, number]) => {
    const q = await project(p);
    return page.evaluate(
      (pt) => (window as HookWindow).__thirdWheelTest?.viewport.pick(pt.x, pt.y),
      q ?? { x: 0, y: 0 },
    );
  };
  const topFace = await pickFace([5, 10, 30]);
  await page.keyboard.press('5');
  await page.waitForTimeout(600);
  const bottomFace = await pickFace([5, 10, 0]);
  expect(topFace?.kind).toBe('face');
  expect(bottomFace?.kind).toBe('face');
  const two = await page.evaluate(
    (faces) => {
      const t = (window as HookWindow).__thirdWheelTest as unknown as {
        markers: { add(e: { kind: string; id: number }[]): { id: string } };
        comments: { add(text: string, ids: string[]): { id: string } | undefined };
      };
      const marker = t.markers.add(faces.map((id) => ({ kind: 'face', id })));
      return t.comments.add('Top and bottom', [marker.id])?.id ?? '';
    },
    [topFace?.id ?? -1, bottomFace?.id ?? -1],
  );
  const bottom = await project([5, 10, 0]);
  await expect
    .poll(async () => {
      const p = (await pins()).find((q) => q.id === two);
      return p && !p.behind && Math.hypot(p.x - (bottom?.x ?? 0), p.y - (bottom?.y ?? 0)) < 40;
    })
    .toBe(true);
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const topIso = await project([5, 10, 30]);
  await expect
    .poll(async () => {
      const p = (await pins()).find((q) => q.id === two);
      return p && !p.behind && Math.hypot(p.x - (topIso?.x ?? 0), p.y - (topIso?.y ?? 0)) < 40;
    })
    .toBe(true);
  await page.evaluate((cid) => {
    (
      (window as HookWindow).__thirdWheelTest as unknown as {
        comments: { remove(id: string): void };
      }
    ).comments.remove(cid);
  }, two);
});

test('Sidecar: annotations saved next to the model come back on reopen; other version → backup', async () => {
  const page = await app.firstWindow();
  const sidecar = join(dir, 'box.step.thirdwheel.json');
  const snapshot = () =>
    page.evaluate(() => {
      const hook = (window as HookWindow).__thirdWheelTest;
      const paint = hook?.paint();
      const markers = hook?.markers.list() ?? [];
      return {
        markers,
        comments: hook?.comments.list() ?? [],
        paint: markers.map((m) => [paint?.count(m.id), paint?.paintedArea(m.id)]),
        split: paint?.splitCount,
      };
    });
  // A marker with paint cut into pieces (a small brush stamp on the top face) and a comment.
  await page.evaluate(() => {
    type Setup = {
      markers: { add(): { id: string } };
      paint(): {
        paint(
          t: number[],
          id: string,
          locked: Set<string>,
          record: undefined,
          spheres: { center: number[]; radius: number }[],
        ): number;
      };
      comments: { add(text: string, markerIds: string[]): unknown };
      model(): { triangleFace: Uint32Array };
    };
    const hook = (window as unknown as { __thirdWheelTest: Setup }).__thirdWheelTest;
    const m = hook.markers.add();
    const all = [...hook.model().triangleFace.keys()];
    hook.paint().paint(all, m.id, new Set(), undefined, [{ center: [5, 10, 30], radius: 3 }]);
    hook.comments.add('Round this', [m.id]);
  });
  const before = await snapshot();
  expect(before.markers.length).toBeGreaterThan(1);
  expect(before.paint.at(-1)?.[0]).toBeGreaterThan(0);
  expect(before.comments.length).toBeGreaterThan(0);
  expect(before.split).toBeGreaterThan(0);
  await expect.poll(() => existsSync(sidecar), { timeout: 5000 }).toBe(true);
  const doc = JSON.parse(readFileSync(sidecar, 'utf8')) as {
    schemaVersion: number;
    model: { fileName: string; contentHash: string };
    markers: {
      name: string;
      entities: { fingerprint?: { type?: string; point?: number[] } }[];
      paint: { faces: { samples?: number[]; fingerprint?: { type?: string } }[] };
    }[];
    comments: { text: string }[];
    bodies?: { name: string; size: number[] }[];
  };
  expect(doc.schemaVersion).toBe(1);
  expect(doc.model.fileName).toBe('box.step');
  // Fingerprints for revision matching (T6.2): every body, every held entity.
  expect(doc.bodies?.length).toBeGreaterThan(0);
  expect(doc.bodies?.[0]?.size).toHaveLength(3);
  // Paint points and fingerprints per painted face (T8.2).
  const painted = doc.markers.flatMap((m) => m.paint.faces);
  expect(painted.length).toBeGreaterThan(0);
  for (const f of painted) {
    expect(f.samples?.length).toBeGreaterThan(0);
    expect(f.fingerprint?.type).toBeTruthy();
  }
  for (const e of doc.markers.flatMap((m) => m.entities)) expect(e.fingerprint).toBeDefined();
  expect(doc.model.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await expect(page.locator('#save-status')).toHaveAttribute(
    'title',
    /box\.step\.thirdwheel\.json/,
  );

  // Reopen: the same markers, paint and comments; nothing to undo.
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen());
  expect(await snapshot()).toEqual(before);
  expect(
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.history.canUndo()),
  ).toBe(false);
  expect(await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.notice())).toBe(
    undefined,
  );

  // A change not saved yet when the same file is opened again: saved before the sidecar is read.
  await page.evaluate(() => {
    const hook = (
      window as unknown as {
        __thirdWheelTest: { comments: { add(text: string, markerIds: string[]): unknown } };
      }
    ).__thirdWheelTest;
    hook.comments.add('Unsaved yet', []);
  });
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen(false));
  const after = await snapshot();
  expect(after.comments.at(-1)?.text).toBe('Unsaved yet');
  expect(after.paint).toEqual(before.paint);
  const saved = JSON.parse(readFileSync(sidecar, 'utf8')) as typeof doc;

  // Fields this version doesn't know (a newer writer): loaded, pop-up says they'd be dropped.
  writeFileSync(
    sidecar,
    JSON.stringify({
      ...saved,
      futureField: 1,
      markers: (saved as unknown as { markers: object[] }).markers.map((m) => ({ ...m, tag: 'x' })),
    }),
  );
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen(false));
  await expect(page.locator('#alert-dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.alert())).toMatch(
    /will be removed.*has 2 fields this version of Third Wheel doesn't know \((markers\[\]\.tag, futureField|futureField, markers\[\]\.tag)\)/,
  );
  expect((await snapshot()).paint).toEqual(before.paint);
  const toolBefore = await page.locator('html').getAttribute('data-tool');
  await page.keyboard.press(toolBefore === 'brush' ? 'v' : 'b'); // keys stay in the pop-up
  expect(await page.locator('html').getAttribute('data-tool')).toBe(toolBefore);
  await page.locator('#alert-ok').click();
  await expect(page.locator('#alert-dialog')).toBeHidden();
  // The first save after such a load keeps a copy of the old file; later saves don't add more.
  const addComment = (text: string): Promise<unknown> =>
    page.evaluate((t) => {
      const hook = (
        window as unknown as {
          __thirdWheelTest: { comments: { add(text: string, markerIds: string[]): unknown } };
        }
      ).__thirdWheelTest;
      hook.comments.add(t, []);
    }, text);
  const backups = (): string[] => readdirSync(dir).filter((f) => f.endsWith('.bak.json'));
  expect(backups()).toEqual([]);
  await addComment('After dropped fields');
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  expect(backups()).toHaveLength(1);
  const kept = readFileSync(join(dir, backups()[0] ?? ''), 'utf8');
  expect(kept).toContain('futureField');
  expect(readFileSync(sidecar, 'utf8')).not.toContain('futureField');
  await expect(page.locator('#notice')).toContainText(backups()[0] ?? '-');
  await addComment('Second change');
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  expect(backups()).toHaveLength(1);
  rmSync(join(dir, backups()[0] ?? ''));
  await page.locator('#notice-close').click();
  writeFileSync(sidecar, JSON.stringify(saved));

  // A sidecar of another file version (geometry not known to match): moved to a backup, and its
  // annotations moved onto the model by geometry (T8.2) and saved at once; a notice says so.
  writeFileSync(
    sidecar,
    JSON.stringify({
      ...saved,
      // No mesh hash (as before T8.1), so it can't be carried over as the same geometry.
      model: { ...saved.model, contentHash: `sha256:${'0'.repeat(64)}`, meshHash: undefined },
    }),
  );
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen());
  await expect(page.locator('#notice-text')).toContainText(
    /box\.step changed on disk: \d+ markers? moved onto the new geometry, all found\. The old file was kept as .*\.bak\.json/,
  );
  await expect(page.locator('#alert-dialog')).toBeHidden();
  expect(readdirSync(dir).filter((f) => f.endsWith('.bak.json'))).toHaveLength(1);
  const moved = await snapshot();
  expect(moved.markers).toHaveLength(saved.markers.length);
  expect(moved.comments.map((c) => c.text)).toEqual(saved.comments.map((c) => c.text));
  // Paint lands on the same faces (whole triangles: cut pieces become whole ones).
  expect(moved.paint.every(([n]) => (n ?? 0) > 0)).toBe(before.paint.every(([n]) => (n ?? 0) > 0));
  await expect // saved at once with this file's hash; the old contents listed as overwritten (T8.6)
    .poll(() => {
      if (!existsSync(sidecar)) return false;
      const doc = JSON.parse(readFileSync(sidecar, 'utf8')) as {
        model: { contentHash: string };
        versions?: { earlier?: { contentHash: string; overwritten?: boolean }[] };
      };
      const [old] = doc.versions?.earlier ?? [];
      return (
        doc.model.contentHash !== `sha256:${'0'.repeat(64)}` &&
        old?.contentHash === `sha256:${'0'.repeat(64)}` &&
        old.overwritten === true
      );
    })
    .toBe(true);
  // Leave box.step without annotations for the tests after this one.
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.bak.json'))) rmSync(join(dir, f));
  writeFileSync(sidecar, JSON.stringify({ ...saved, markers: [], comments: [] }));
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen());
  expect((await snapshot()).comments).toEqual([]);
});

test('Body folders: move to new folder, rename, saved, drag out, undo, delete', async () => {
  const page = await app.firstWindow();
  const sidecar = join(dir, 'box.step.thirdwheel.json');
  const body = page.locator('li[data-row="b0"]');
  const depth = () => body.evaluate((li) => (li as HTMLElement).style.getPropertyValue('--depth'));
  const folder = page.locator('li[data-row="un1"]');

  // Right-click the body → "Move to new folder": the folder starts in rename mode.
  await body.locator('.body-row').click({ button: 'right' });
  await page.locator('[data-action="move-to-new-folder"]').click();
  const input = page.locator('input.folder-name-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Folder 1');
  await input.fill('Brackets');
  await input.press('Enter');
  await expect(folder.locator('.body-name')).toHaveText('Brackets');
  expect(await depth()).toBe('1');

  // Saved in the sidecar and back after reopening.
  await expect
    .poll(
      () =>
        existsSync(sidecar) &&
        (
          JSON.parse(readFileSync(sidecar, 'utf8')) as {
            bodyTree?: { folders: { name: string }[] };
          }
        ).bodyTree?.folders[0]?.name,
      { timeout: 5000 },
    )
    .toBe('Brackets');
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen());
  await expect(folder.locator('.body-name')).toHaveText('Brackets');
  expect(await depth()).toBe('1');

  // Drag the body onto empty panel space = top level; undo puts it back.
  const panel = page.locator('.panel-left');
  const box = await panel.boundingBox();
  await body.dragTo(panel, { targetPosition: { x: 40, y: (box?.height ?? 400) - 30 } });
  expect(await depth()).toBe('0');
  await page.locator('#undo').click();
  expect(await depth()).toBe('1');

  // Double-click renames; right-click → Delete folder moves the body out.
  await folder.locator('.folder-row').dblclick();
  await page.locator('input.folder-name-input').fill('Parts');
  await page.locator('input.folder-name-input').press('Enter');
  await expect(folder.locator('.body-name')).toHaveText('Parts');
  await folder.locator('.folder-row').click({ button: 'right' });
  await page.locator('[data-action="delete-folder"]').click();
  await expect(folder).toHaveCount(0);
  expect(await depth()).toBe('0');
  await page.locator('#undo').click();
  await expect(folder.locator('.body-name')).toHaveText('Parts');
  await page.locator('#redo').click();
  await expect(folder).toHaveCount(0);

  // "+ Folder" in the heading: an empty folder at the top level, ready to name; undo removes it.
  await page.locator('[data-action="add-folder"]').click();
  await expect(page.locator('input.folder-name-input')).toBeFocused();
  await page.locator('input.folder-name-input').press('Enter');
  const added = page.locator('li[data-row^="u"]');
  await expect(added.locator('.body-name')).toHaveText('Folder 1');
  await expect(added.locator('.folder-count')).toHaveText('0');
  expect(await depth()).toBe('0');
  await page.locator('#undo').click();
  await expect(added).toHaveCount(0);
  await page.evaluate(() => {
    (window as HookWindow).__thirdWheelTest?.selection.clear();
  });
});

test('Region render: paint and held faces, camera along the normal, view untouched', async () => {
  const page = await app.firstWindow();
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.waitForTimeout(600);
  const project = () =>
    page.evaluate(() =>
      (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
    );
  const viewBefore = await project();
  const result = await page.evaluate(async () => {
    const t = (window as HookWindow).__thirdWheelTest as unknown as {
      model(): { positions: Float32Array; indices: Uint32Array; triangleFace: Uint32Array };
      markers: {
        add(e: { kind: string; id: number }[]): { id: string; color: string };
      };
      paint(): { paint(tris: number[], id: string, locked: ReadonlySet<string>): number };
      viewport: { paintChanged(): void };
      renderRegion(
        ids: string[],
        size?: number,
      ): Promise<
        | {
            png: Uint8Array;
            size: number;
            viewDir: number[];
            up: number[];
            mmPerPx: number;
            ghosted: unknown[];
            renderMs: number;
            encodeMs: number;
          }
        | undefined
      >;
    };
    const m = t.model();
    // Triangles of the +X side (x = 10) and the top face (z = 30).
    const side: number[] = [];
    let topFace = -1;
    for (let tri = 0; tri < m.triangleFace.length; tri++) {
      const c = (k: number, d: number) => m.positions[(m.indices[tri * 3 + k] ?? 0) * 3 + d];
      if ([0, 1, 2].every((k) => c(k, 0) === 10)) side.push(tri);
      if ([0, 1, 2].every((k) => c(k, 2) === 30)) topFace = m.triangleFace[tri] ?? -1;
    }
    const painted = t.markers.add([]);
    t.paint().paint(side, painted.id, new Set());
    t.viewport.paintChanged();
    const held = t.markers.add([{ kind: 'face', id: topFace }]);

    const pixels = async (png: Uint8Array, size: number) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(png)], { type: 'image/png' }),
      );
      const c = new OffscreenCanvas(size, size);
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d');
      ctx.drawImage(bitmap, 0, 0);
      const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
      return { w: bitmap.width, centre: at(size / 2, size / 2), corner: at(1, 1) };
    };
    const first = await t.renderRegion([painted.id]);
    const a = await t.renderRegion([painted.id]); // warm
    const b = await t.renderRegion([held.id], 200);
    const none = await t.renderRegion(['nope']);
    if (!a || !b) throw new Error('no picture');
    return {
      colors: [painted.color, held.color],
      a: { ...a, png: undefined, px: await pixels(a.png, a.size) },
      b: { ...b, png: undefined, px: await pixels(b.png, b.size) },
      none: none === undefined,
      firstMs: (first?.renderMs ?? 0) + (first?.encodeMs ?? 0),
    };
  });
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const dominant = (c: number[]) => c.indexOf(Math.max(...c));

  // Paint on the +X side (20 × 30 mm): seen from +X, Z up, 30 mm fill 60 % of 384 px.
  expect(result.a.size).toBe(384);
  expect(result.a.px.w).toBe(384);
  expect(result.a.viewDir.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0]);
  expect(result.a.up.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
  expect(result.a.mmPerPx).toBeCloseTo(30 / 0.6 / 384, 4);
  // < 100 ms once warm; the first picture also compiles its shaders.
  expect(result.a.renderMs + result.a.encodeMs).toBeLessThan(100);
  expect(result.b.renderMs + result.b.encodeMs).toBeLessThan(100);
  expect(result.firstMs).toBeLessThan(1000);
  expect(result.a.px.corner).toEqual([255, 255, 255]); // white background
  const centre = result.a.px.centre;
  expect(Math.max(...centre) - Math.min(...centre)).toBeGreaterThan(40); // coloured, not grey
  expect(dominant(centre)).toBe(dominant(rgb(result.colors[0] ?? '')));

  // A held face (top): seen from above, its marker's tint at the centre; size as asked.
  expect(result.b.size).toBe(200);
  expect(result.b.viewDir.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
  expect(result.b.ghosted).toEqual([]); // one body: nothing in front (T6.5)
  expect(dominant(result.b.px.centre)).toBe(dominant(rgb(result.colors[1] ?? '')));
  expect(result.none).toBe(true);

  // The user's view did not move.
  const viewAfter = await project();
  expect(viewAfter?.x).toBeCloseTo(viewBefore?.x ?? -1, 6);
  expect(viewAfter?.y).toBeCloseTo(viewBefore?.y ?? -1, 6);
});

test('Contact sheet: two regions side by side, numbered, each with its own camera', async () => {
  const page = await app.firstWindow();
  const result = await page.evaluate(async () => {
    const t = (window as HookWindow).__thirdWheelTest as unknown as {
      markers: { list(): { id: string; color: string }[] };
      renderContactSheet(regions: string[][]): Promise<
        | {
            png: Uint8Array;
            width: number;
            height: number;
            skipped: number[];
            renderMs: number;
            encodeMs: number;
            tiles: {
              number: number;
              region: number;
              x: number;
              y: number;
              size: number;
              viewDir: number[];
              mmPerPx: number;
            }[];
          }
        | undefined
      >;
    };
    // The two markers from the Region render test: paint on +X, held top face.
    const [painted, held] = t.markers.list().slice(-2);
    if (!painted || !held) throw new Error('no markers');
    const sheet = await t.renderContactSheet([[painted.id], ['nope'], [held.id]]);
    const none = await t.renderContactSheet([['nope']]);
    let tooMany = false;
    try {
      await t.renderContactSheet([[], [], [], [], []]);
    } catch {
      tooMany = true;
    }
    if (!sheet) throw new Error('no sheet');
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(sheet.png)], { type: 'image/png' }),
    );
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d');
    ctx.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    // Label box: dark pixels inside the top-left corner of each tile.
    const darkIn = (x0: number, y0: number) => {
      const d = ctx.getImageData(x0, y0, 30, 30).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 255) < 80) n++;
      return n;
    };
    return {
      colors: [painted.color, held.color],
      w: bitmap.width,
      h: bitmap.height,
      sheet: { ...sheet, png: undefined },
      left: at(192, 192),
      right: at(576, 192),
      divider: at(384, 300),
      labels: [darkIn(0, 0), darkIn(384, 0)],
      none: none === undefined,
      tooMany,
    };
  });
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const dominant = (c: number[]) => c.indexOf(Math.max(...c));
  const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000);

  // Two regions shown (the unknown one skipped) → 768 × 384.
  expect([result.w, result.h]).toEqual([768, 384]);
  expect([result.sheet.width, result.sheet.height]).toEqual([768, 384]);
  expect(result.sheet.skipped).toEqual([1]);
  const [a, b] = result.sheet.tiles;
  expect([a?.number, a?.region, a?.x, a?.y, a?.size]).toEqual([1, 0, 0, 0, 384]);
  expect([b?.number, b?.region, b?.x, b?.y, b?.size]).toEqual([2, 2, 384, 0, 384]);
  // Each tile has its own camera, as in the single pictures.
  expect(round(a?.viewDir ?? [])).toEqual([1, 0, 0]);
  expect(round(b?.viewDir ?? [])).toEqual([0, 0, 1]);
  expect(a?.mmPerPx).toBeCloseTo(30 / 0.6 / 384, 4);
  expect(dominant(result.left)).toBe(dominant(rgb(result.colors[0] ?? '')));
  expect(dominant(result.right)).toBe(dominant(rgb(result.colors[1] ?? '')));
  expect(result.divider).toEqual([150, 155, 165]);
  for (const n of result.labels) expect(n).toBeGreaterThan(10); // number + box border
  expect(result.sheet.renderMs + result.sheet.encodeMs).toBeLessThan(1000);
  expect(result.none).toBe(true);
  expect(result.tooMany).toBe(true);
});

test('Display name "Third Wheel": window, toolbar, start view; settings folder kept (T13.0)', async () => {
  const page = await loadedWindow();
  await expect(page).toHaveTitle('Third Wheel');
  await expect(page.locator('.brand-name')).toHaveText('Third Wheel');
  await expect(page.locator('.empty-title')).toHaveText('Third Wheel');
  const main = await app.evaluate(({ app: a }) => ({
    name: a.getName(),
    userData: a.getPath('userData'),
  }));
  // setName must not move the settings folder (here: the test's --user-data-dir).
  expect(main).toEqual({ name: 'Third Wheel', userData: join(dir, 'profile') });
  const winTitle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getTitle(),
  );
  expect(winTitle).toBe('Third Wheel');
});

test('About Third Wheel: menu item opens the dialog; third-party licences (T13.1)', async () => {
  const page = await loadedWindow();
  const version = await app.evaluate(({ app: a }) => a.getVersion());
  // macOS: first item of the app menu; Windows: Help → About. Click it the way the menu does.
  const where = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const item = menu?.getMenuItemById('about-third-wheel');
    const top = item && menu?.items.find((m) => m.submenu?.items.includes(item));
    item?.click();
    return { label: item?.label, top: top?.role === 'help' ? 'help' : top?.label };
  });
  expect(where).toEqual({
    label: 'About Third Wheel',
    top: process.platform === 'darwin' ? 'Third Wheel' : 'help',
  });
  const dialog = page.locator('#about-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#about-title')).toHaveText('Third Wheel');
  await expect(dialog.locator('#about-version')).toHaveText(`Version ${version}`);
  await expect(dialog).toContainText('© 2026 XiLaoTr · Apache License 2.0');
  await expect(dialog.locator('#about-link')).toHaveAttribute(
    'href',
    'https://github.com/XiLaoTr/third-wheel',
  );
  await expect(dialog).toContainText('Designed by XiLaoTr, built with Claude Code (Anthropic).');
  await expect(dialog.locator('svg.about-logo')).toBeVisible();
  // No Electron default About role left (it would open Electron's own panel).
  expect(
    await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).some((m) =>
        m.submenu?.items.some((i) => i.role === 'about'),
      ),
    ),
  ).toBe(false);

  await expect(dialog.locator('#about-notices')).toBeHidden();
  await dialog.locator('#about-licences').click();
  const notices = dialog.locator('#about-notices-text');
  await expect(notices).toContainText('occt-wasm 5.15.0');
  await expect(notices).toContainText('GNU LESSER GENERAL PUBLIC LICENSE');
  await expect(notices).toContainText(/^three \S+ — MIT$/m);
  await expect(dialog.locator('#about-licences')).toHaveText('Hide licences');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('App menu: small real menu; items run once, Undo is the app’s or the text’s (T13.2)', async () => {
  const page = await loadedWindow();
  const click = (id: string) =>
    app.evaluate(({ Menu }, menuId) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
      if (!item) throw new Error(`no menu item ${menuId}`);
      (item.click as (this: typeof item) => void).call(item);
    }, id);
  const tops = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((m) => m.label),
  );
  // Tests run unpackaged: the dev-only Developer menu is there; no View menu.
  expect(tops).toEqual(
    process.platform === 'darwin'
      ? ['Third Wheel', 'File', 'Edit', 'Window', 'Developer', 'Help']
      : ['&File', '&Edit', 'Developer', '&Help'],
  );

  // Open…: one dialog per click, and one for a key press that also reached the menu.
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { dialogCount?: number };
    g.dialogCount = 0;
    dialog.showOpenDialog = () => {
      g.dialogCount = (g.dialogCount ?? 0) + 1;
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
  });
  const dialogs = () =>
    app.evaluate(() => (globalThis as { dialogCount?: number }).dialogCount ?? 0);
  await click('menu-open');
  await expect.poll(dialogs).toBe(1);
  await page.keyboard.press('ControlOrMeta+o');
  await click('menu-open'); // the same press, as the macOS menu would send it
  await expect.poll(dialogs).toBe(2);
  await page.waitForTimeout(400);
  expect(await dialogs()).toBe(2);
  await click('menu-import');
  await expect.poll(dialogs).toBe(3);

  // Undo / Redo outside a text field = the app's history, one step per press.
  const rows = page.locator('#markers li[data-marker]');
  const before = await rows.count();
  await page.locator('#marker-add').click();
  await page.locator('#marker-add').click();
  await expect(rows).toHaveCount(before + 2);
  await click('menu-undo');
  await expect(rows).toHaveCount(before + 1);
  await click('menu-redo');
  await expect(rows).toHaveCount(before + 2);
  await page
    .locator('#viewport canvas')
    .first()
    .click({ position: { x: 5, y: 5 } }); // focus off
  await page.keyboard.press('ControlOrMeta+z');
  await click('menu-undo'); // same press
  await expect(rows).toHaveCount(before + 1);
  await page.waitForTimeout(400);
  await expect(rows).toHaveCount(before + 1);
  await click('menu-undo');
  await expect(rows).toHaveCount(before);

  // In a text field: Undo undoes typing, not a marker step.
  await page.locator('#marker-add').click();
  await expect(rows).toHaveCount(before + 1);
  await page.evaluate(() => {
    const t = document.createElement('textarea');
    t.id = 'menu-undo-probe';
    document.body.append(t);
  });
  const probe = page.locator('#menu-undo-probe');
  await probe.click();
  await page.keyboard.type('abc');
  await click('menu-undo');
  await expect(probe).toHaveValue('');
  await click('menu-redo');
  await expect(probe).toHaveValue('abc');
  await expect(rows).toHaveCount(before + 1);
  await page.evaluate(() => document.getElementById('menu-undo-probe')?.remove());
  await click('menu-undo');
  await expect(rows).toHaveCount(before);

  // Help: Keyboard shortcuts = the cheat sheet; Connect an AI agent… = the pop-up.
  await click('menu-shortcuts');
  await expect(page.locator('#help-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-sheet')).toBeHidden();
  await click('menu-connect');
  await expect(page.locator('#connect-dialog')).toBeVisible();
  // Behind an open pop-up, Open… does nothing (the keys don't reach the app there either).
  await click('menu-open');
  await page.waitForTimeout(400);
  expect(await dialogs()).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('#connect-dialog')).toBeHidden();
});

test('App bridge: a token-holding client asks the running app; the window answers status', async () => {
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.model() !== undefined);
  await expect.poll(() => existsSync(bridgeFile)).toBe(true);
  const client = await connectBridge({ filePath: bridgeFile });
  try {
    expect(await client.call('ping')).toMatchObject({ app: 'third-wheel', protocol: 1 });
    // Main → window → main: the window reports the open model.
    const status = (await client.call('status')) as {
      model: { path: string; name: string; contentHash: string } | null;
    };
    expect(status.model).toMatchObject({ path: join(dir, 'box.step'), name: 'box.step' });
    expect(status.model?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(client.call('nope')).rejects.toMatchObject({ code: 'unknown_method' });
    // AI status (T7.6): ping / status are no MCP tool calls → still grey "no calls yet".
    await expect(page.locator('#ai-status')).toHaveAttribute('data-dot', 'idle');
    await expect(page.locator('#ai-status')).toHaveText('AI: ready · no calls yet');
  } finally {
    client.close();
  }
});

test('MCP tools: the built server drives the app (load, review, annotations, picture, status)', async () => {
  const page = await app.firstWindow();
  // The same file .mcp.json starts; relative paths start from its working folder.
  const client = new Client({ name: 'e2e', version: '1' });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(appDir, '../../packages/mcp-server/build/third-wheel-mcp.js')],
      cwd: dir,
      env: { ...env, THIRD_WHEEL_BRIDGE_FILE: bridgeFile },
      stderr: 'ignore',
    }),
  );
  type Content = { type: string; text?: string; data?: string; mimeType?: string }[];
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: Content;
      isError?: boolean;
    };
    return { ...r, json: (): unknown => JSON.parse(r.content.at(-1)?.text ?? 'null') };
  };
  try {
    const loaded = (await tool('load_model', { path: 'box.step' })).json() as {
      modelId: string;
      name: string;
      bodies: number;
    };
    expect(loaded).toMatchObject({ name: 'box.step', bodies: 1 });
    expect(loaded.modelId).toMatch(/^[0-9a-f]{12}$/);
    const { modelId } = loaded;
    // AI status (T7.6): green after a tool call; the pop-up names it and the server path.
    await expect(page.locator('#ai-status')).toHaveAttribute('data-dot', 'active');
    await expect(page.locator('#ai-status')).toHaveText('AI: ready · last call just now');
    await page.locator('#ai-status').click();
    await expect(page.locator('#connect-dialog')).toBeVisible();
    await expect(page.locator('#connect-last')).toContainText('Last AI call: load_model');
    const serverPath = resolve(appDir, '../../packages/mcp-server/build/third-wheel-mcp.js');
    await expect(page.locator('#connect-command')).toHaveText(
      `claude mcp add third-wheel -- node "${serverPath}"`,
    );
    await expect(page.locator('#connect-missing')).toBeHidden();
    await page.locator('input[name="connect-scope"][value="user"]').check();
    await expect(page.locator('#connect-command')).toHaveText(
      `claude mcp add --scope user third-wheel -- node "${serverPath}"`,
    );
    expect(JSON.parse((await page.locator('#connect-json').textContent()) ?? '')).toEqual({
      mcpServers: { 'third-wheel': { command: 'node', args: [serverPath] } },
    });
    // Copy feedback on the button (a notice would sit behind the backdrop).
    await page.locator('#connect-copy-command').click();
    await expect(page.locator('#connect-copy-command')).toHaveText('Copied ✓');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      `claude mcp add --scope user third-wheel -- node "${serverPath}"`,
    );
    await expect(page.locator('#connect-copy-command')).toHaveText('Copy', { timeout: 4000 });
    // One-click Connect (R4): runs `claude mcp remove` (old entry) then `add --scope user`.
    const connect = page.locator('#connect-claude');
    await expect(connect).toHaveText('Connect to Claude Code');
    await connect.click();
    await expect(page.locator('#connect-result')).toContainText('Connected ✓');
    await expect(connect).toHaveText('Connect again');
    const calls = readFileSync(claudeLog, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim().replaceAll('"', ''))
      .filter(Boolean);
    expect(calls).toEqual([
      'mcp remove --scope user third-wheel',
      `mcp add --scope user third-wheel -- node ${serverPath}`,
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#connect-dialog')).toBeHidden();
    const wrongFile = await tool('load_model', { path: 'notes.txt' });
    expect(wrongFile.isError).toBe(true);

    // No comments yet (T12.3): no "0" badge, and Send to AI copies nothing but says why.
    await expect(page.locator('#send-ai')).toBeEnabled();
    await expect(page.locator('#send-ai-count')).toBeHidden();
    await app.evaluate(({ clipboard }) => {
      void clipboard.writeText('untouched');
    });
    await page.locator('#send-ai').click();
    await expect(page.locator('#notice-text')).toHaveText(
      'Nothing to send yet: add a comment first.',
    );
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('untouched');
    // The AI asked: 0 comments is still an answer ("looks fine") and goes out.
    const empty = (await tool('request_review', { modelId })).json() as { reviewId: string };
    await expect(page.locator('#send-ai')).toHaveClass(/asking/);
    await expect(page.locator('#send-ai-count')).toBeHidden();
    await page.locator('#send-ai').click();
    expect(
      (await tool('wait_for_review', { reviewId: empty.reviewId, timeoutSec: 5 })).json(),
    ).toMatchObject({ state: 'sent', openComments: 0 });
    await expect(page.locator('#notice-text')).toHaveText('Sent: no open comments.');

    // The user marks the top face and comments on it.
    const { markerId, commentId } = await page.evaluate(() => {
      const t = (window as HookWindow).__thirdWheelTest as unknown as {
        model(): { faceGeometry: Float32Array };
        markers: { add(e: { kind: string; id: number }[]): { id: string } };
        comments: { add(text: string, ids: string[]): { id: string } | undefined };
      };
      const g = t.model().faceGeometry;
      let top = -1;
      for (let f = 0; f < g.length / 8; f++) if ((g[f * 8 + 2] ?? 0) > 0.5) top = f;
      const m = t.markers.add([{ kind: 'face', id: top }]);
      return { markerId: m.id, commentId: t.comments.add('Fillet this edge', [m.id])?.id ?? '' };
    });

    // No AI request yet: the toolbar's "Send to AI" copies a message naming the model's path.
    const openCount = Number(await page.locator('#send-ai-count').textContent());
    expect(openCount).toBeGreaterThan(0);
    await expect(page.locator('#send-ai')).not.toHaveClass(/asking/);
    await page.locator('#send-ai').click();
    await expect(page.locator('#notice-text')).toContainText('copied');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toContain(`I reviewed box.step in Third Wheel (${String(openCount)} open`);
    // The Windows clipboard turns \n into \r\n (T11.1).
    expect(copied).toMatch(/\r?\nPath: .*box\.step\r?\n/);

    // Review: the banner shows the AI's message and the toolbar button turns rainbow; a short
    // wait times out, "Send to AI" (banner or toolbar) ends it.
    const { reviewId } = (
      await tool('request_review', { modelId, message: 'Check the top' })
    ).json() as {
      reviewId: string;
    };
    await expect(page.locator('#ai-banner')).toBeVisible();
    await expect(page.locator('#ai-banner-text')).toHaveText('Check the top');
    await expect(page.locator('#send-ai')).toHaveClass(/asking/);
    expect((await tool('wait_for_review', { reviewId, timeoutSec: 1 })).json()).toMatchObject({
      state: 'waiting',
    });
    const waiting = tool('wait_for_review', { reviewId, timeoutSec: 30 });
    await page.waitForTimeout(300);
    // Typed but not posted: Send posts it first, so the AI sees it.
    await page.locator('#comment-add').click();
    await page.locator('.comment-input').fill('Typed but not posted');
    await page.locator('#ai-banner-send').click();
    expect((await waiting).json()).toMatchObject({
      state: 'sent',
      modelId,
      openComments: openCount + 1,
    });
    await expect(page.locator('#notice-text')).toHaveText('Posted your comment and sent.');
    await expect(page.locator('#ai-banner')).toBeHidden();
    await expect(page.locator('#send-ai')).not.toHaveClass(/asking/);
    // The toolbar button answers a request too; × tells the AI "cancelled".
    const second = (await tool('request_review', { modelId })).json() as { reviewId: string };
    await page.locator('#send-ai').click();
    expect(
      (await tool('wait_for_review', { reviewId: second.reviewId, timeoutSec: 5 })).json(),
    ).toMatchObject({ state: 'sent' });
    const third = (await tool('request_review', { modelId })).json() as { reviewId: string };
    await page.locator('#ai-banner-dismiss').click();
    expect(
      (await tool('wait_for_review', { reviewId: third.reviewId, timeoutSec: 5 })).json(),
    ).toMatchObject({ state: 'cancelled' });

    const payload = (await tool('get_annotations', { modelId })).json() as {
      comments: { id: string; text: string }[];
      markers: { id: string; entities?: { kind: string; type?: string }[] }[];
    };
    expect(payload.comments.map((c) => c.text)).toContain('Fillet this edge');
    expect(payload.comments.map((c) => c.text)).toContain('Typed but not posted');
    expect(payload.markers.find((m) => m.id === markerId)?.entities?.[0]).toMatchObject({
      kind: 'face',
      type: 'plane',
    });

    const picture = await tool('render_region', { modelId, markerIds: [markerId] });
    expect(picture.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(
      Buffer.from(picture.content[0]?.data ?? '', 'base64')
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    expect(picture.json()).toMatchObject({ width: 384, height: 384, view: { viewDir: [0, 0, 1] } });
    const sheet = await tool('render_region', { modelId, groups: [[markerId], [markerId]] });
    expect(sheet.json()).toMatchObject({
      width: 768,
      height: 384,
      tiles: [{ number: 1 }, { number: 2 }],
    });
    expect((await tool('render_region', { modelId, markerIds: ['nope'] })).isError).toBe(true);

    // The AI resolves the comment: the app shows it, default annotations leave it out.
    expect(
      (
        await tool('set_comment_status', {
          modelId,
          commentId,
          status: 'resolved',
          note: 'added 2 mm fillet',
        })
      ).json(),
    ).toMatchObject({ status: 'resolved', changed: true });
    type ThreadComment = {
      status: string;
      replies?: { author: string; text: string; status?: string }[];
    };
    const commentNow = (): Promise<ThreadComment | undefined> =>
      page.evaluate(
        (id) =>
          (
            (window as HookWindow).__thirdWheelTest as unknown as {
              comments: { get(id: string): ThreadComment | undefined };
            }
          ).comments.get(id),
        commentId,
      );
    // T7.5: the note is the AI's reply in the thread, tagged with the status.
    expect(await commentNow()).toMatchObject({
      status: 'resolved',
      replies: [{ author: 'ai', text: 'added 2 mm fillet', status: 'resolved' }],
      awaitingConfirm: true,
    });
    // T8.3: the AI's "resolved" stays in the list until the user confirms it.
    const aiClosed = page.locator(`li[data-comment="${commentId}"]`);
    await expect(aiClosed.locator('.comment-confirm-text')).toHaveText('AI says it’s fixed');
    // T10.2: not "Resolved" (nor counted under "Show resolved") until the user confirms.
    await expect(aiClosed.locator('.comment-head .comment-status').first()).toHaveText(
      'Waiting for you',
    );
    // Earlier tests may have left closed comments on this box: count only the user-closed ones.
    const userClosed = await page.evaluate(
      () =>
        (
          (window as HookWindow).__thirdWheelTest as unknown as {
            comments: { list(): { status: string; awaitingConfirm?: true }[] };
          }
        ).comments
          .list()
          .filter((c) => c.status !== 'open' && !c.awaitingConfirm).length,
    );
    if (userClosed === 0) await expect(page.locator('.comment-show-closed')).toBeHidden();
    else
      await expect(page.locator('.comment-show-closed')).toContainText(
        `Show resolved (${String(userClosed)})`,
      );
    // T10.2: the AI's edits are not on the user's undo history — Cmd/Ctrl+Z after a brush stroke
    // undoes only the stroke, and the next step offered is the user's own.
    const activeId = await page.evaluate(
      () => (window as HookWindow).__thirdWheelTest?.markers.active()?.id ?? '',
    );
    const strokePaint = () =>
      page.evaluate(
        (id) => (window as HookWindow).__thirdWheelTest?.paint()?.count(id) ?? -1,
        activeId,
      );
    const canvasBox = await page.locator('#viewport canvas').first().boundingBox();
    if (!canvasBox) throw new Error('no canvas box');
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    const top = await page.evaluate(() =>
      (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
    );
    if (!top) throw new Error('no projection');
    const paintBefore = await strokePaint();
    await page.keyboard.press('b');
    await page.mouse.move(canvasBox.x + top.x - 10, canvasBox.y + top.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + top.x + 10, canvasBox.y + top.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(strokePaint).toBeGreaterThan(paintBefore);
    await expect(page.locator('#undo')).toHaveAttribute('title', /^Undo Brush stroke \(/);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(strokePaint).toBe(paintBefore);
    await expect(page.locator('#undo')).toHaveAttribute('title', /^Undo Add comment \(/);
    expect(await commentNow()).toMatchObject({
      status: 'resolved',
      replies: [{ author: 'ai', text: 'added 2 mm fillet' }],
      awaitingConfirm: true,
    });
    await page.keyboard.press('v');
    await aiClosed.locator('.comment-confirm').click();
    await expect(aiClosed).toHaveCount(0); // closed for good: hidden unless "Show resolved"
    expect(await commentNow()).not.toHaveProperty('awaitingConfirm');
    const open = (await tool('get_annotations', { modelId })).json() as {
      comments: { id: string }[];
    };
    expect(open.comments.map((c) => c.id)).not.toContain(commentId);
    const all = (
      await tool('get_annotations', { modelId, statuses: ['open', 'resolved', 'wontfix'] })
    ).json() as { comments: { id: string; replies?: unknown[] }[] };
    expect(all.comments.find((c) => c.id === commentId)?.replies).toEqual([
      { by: 'ai', text: 'added 2 mm fillet', status: 'resolved' },
    ]);

    // The AI replies without changing the status; the reply shows under the card.
    expect(
      (await tool('reply_to_comment', { modelId, commentId, text: 'Is 2 mm enough?' })).json(),
    ).toMatchObject({ commentId, replyId: 'r2', status: 'resolved' });
    expect((await commentNow())?.status).toBe('resolved');
    expect(
      (await tool('reply_to_comment', { modelId, commentId: 'nope', text: 'x' })).isError,
    ).toBe(true);
    // The user answers in the reply box of the highlighted card: the comment reopens.
    await page.locator('#comment-show-closed').check();
    const card = page.locator(`li[data-comment="${commentId}"]`);
    await card.locator('.comment-text').first().click();
    await expect(card.locator('.comment-reply')).toHaveCount(2);
    // The highlighted card stays shown; reopening hides the checkbox (no closed comments left).
    await page.locator('#comment-show-closed').uncheck();
    await card.locator('.reply-input').fill('Make it 3 mm');
    await card.locator('#reply-post').click();
    await expect(card.locator('.comment-reply')).toHaveCount(3);
    expect(await commentNow()).toMatchObject({
      status: 'open',
      replies: [{}, {}, { author: 'human', text: 'Make it 3 mm', status: 'open' }],
    });

    // Comment ids repeat across models: another model's id must not touch this one's comment.
    const wrongComment = await tool('set_comment_status', {
      modelId: 'ffffffffffff',
      commentId,
      status: 'open',
    });
    expect(wrongComment.isError).toBe(true);
    const wrongModel = await tool('get_annotations', { modelId: 'ffffffffffff' });
    expect(wrongModel.isError).toBe(true);
    expect(wrongModel.content[0]?.text).toContain('load_model');

    // T7.4: one review of two models. The AI loads the lid, then the box, and asks about both.
    const lid = (await tool('load_model', { path: 'lid.step' })).json() as { modelId: string };
    await page.evaluate(() => {
      (
        (window as HookWindow).__thirdWheelTest as unknown as {
          comments: { add(t: string, ids: string[], by: string, linked: string[]): unknown };
        }
      ).comments.add('Lid must fit the box', [], 'human', ['box.step']);
    });
    expect((await tool('load_model', { path: 'box.step' })).json()).toMatchObject({ modelId });
    const both = (
      await tool('request_review', {
        modelId,
        alsoModelIds: [lid.modelId],
        message: 'Do they fit?',
      })
    ).json() as { reviewId: string };
    const models = page.locator('.ai-banner-model');
    await expect(models).toHaveCount(2);
    await expect(models.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(models.nth(1)).toHaveText('lid.step · 1');
    // The lid isn't shown, yet its comments (with the linked file) can be read.
    const lidPayload = (await tool('get_annotations', { modelId: lid.modelId })).json() as {
      comments: { text: string; linkedModels?: string[] }[];
    };
    expect(lidPayload.comments).toEqual([
      expect.objectContaining({ text: 'Lid must fit the box', linkedModels: ['box.step'] }),
    ]);
    // Switching to the lid keeps the request; the box is no longer shown.
    await models.nth(1).click();
    await expect(models.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#ai-banner')).toBeVisible();
    const notShown = await tool('render_region', { modelId, markerIds: [markerId] });
    expect(notShown.content[0]?.text).toContain('get_annotations still reads it');
    expect((await tool('get_annotations', { modelId })).isError).toBeFalsy();
    await page.locator('#ai-banner-send').click();
    const sent = (
      await tool('wait_for_review', { reviewId: both.reviewId, timeoutSec: 5 })
    ).json() as { state: string; models: { modelId: string; openComments: number }[] };
    expect(sent.state).toBe('sent');
    expect(sent.models.map((m) => m.modelId)).toEqual([modelId, lid.modelId]);
    expect(sent.models[1]?.openComments).toBe(1);
    // The card's "↔ box.step" chip opens the box again.
    await page.locator('button.comment-chip.linked').click();
    await expect
      .poll(async () => (await tool('render_region', { modelId, markerIds: [markerId] })).isError)
      .toBeFalsy();
  } finally {
    await client.close();
  }
});

test('Connect pop-up: one tab per agent, one-click for Codex / Gemini / Cursor / VS Code, remembered (T14.2)', async () => {
  const page = await loadedWindow();
  const serverPath = resolve(appDir, '../../packages/mcp-server/build/third-wheel-mcp.js');
  await app.evaluate(({ shell }) => {
    const g = globalThis as { opened?: string[] };
    g.opened = [];
    shell.openExternal = (url: string) => {
      g.opened?.push(url);
      return Promise.resolve();
    };
  });
  const tab = (id: string) => page.locator(`input[name="connect-agent"][value="${id}"]`);
  const button = page.locator('#connect-agent-button');
  const result = page.locator('#connect-agent-result');
  const text = page.locator('#connect-agent-text');
  await page.locator('#ai-status').click();
  await expect(page.locator('#connect-dialog')).toBeVisible();
  await expect(tab('claude')).toBeChecked();
  await expect(page.locator('#connect-panel-claude')).toBeVisible();
  await expect(page.locator('#connect-panel-agent')).toBeHidden();

  // Codex: writes config.toml (with the timeout `codex mcp add` can't set), keeps a backup.
  mkdirSync(codexHome, { recursive: true });
  const codexFile = join(codexHome, 'config.toml');
  writeFileSync(codexFile, 'model = "gpt-5"\n');
  await page.locator('#connect-agents label', { hasText: 'Codex' }).click();
  await expect(page.locator('#connect-panel-claude')).toBeHidden();
  await expect(text).toContainText('[mcp_servers.third-wheel]');
  await expect(text).toContainText('tool_timeout_sec = 600');
  await expect(page.locator('#connect-agent-hint')).toContainText(codexFile);
  await expect(button).toHaveText('Add to Codex');
  await button.click();
  await expect(result).toContainText(`Added ✓ to ${codexFile}`);
  const toml = readFileSync(codexFile, 'utf8');
  expect(toml.startsWith('model = "gpt-5"')).toBe(true);
  // Windows paths go in TOML literal strings (single quotes, no escaping), like the app writes them.
  const tomlPath = process.platform === 'win32' ? `'${serverPath}'` : JSON.stringify(serverPath);
  expect(toml).toContain(`args = [${tomlPath}]`);
  expect(toml).toContain('tool_timeout_sec = 600');
  expect(readFileSync(`${codexFile}.bak`, 'utf8')).toBe('model = "gpt-5"\n');
  // Copy gives exactly what is shown.
  await page.locator('#connect-copy-agent').click();
  await expect(page.locator('#connect-copy-agent')).toHaveText('Copied ✓');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    (await text.textContent()) ?? '',
  );

  // Gemini CLI: the fake program gets `mcp remove` then `mcp add -s user`.
  await page.locator('#connect-agents label', { hasText: 'Gemini CLI' }).click();
  await expect(text).toHaveText(`gemini mcp add -s user third-wheel node "${serverPath}"`);
  await expect(button).toHaveText('Connect to Gemini CLI');
  await button.click();
  await expect(result).toContainText('Connected ✓');
  await expect
    .poll(() =>
      existsSync(geminiLog)
        ? readFileSync(geminiLog, 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim().replaceAll('"', ''))
            .filter(Boolean)
        : [],
    )
    .toEqual(['mcp remove -s user third-wheel', `mcp add -s user third-wheel node ${serverPath}`]);

  // Cursor / VS Code: their install links (opened by main, stubbed here).
  await page.locator('#connect-agents label', { hasText: 'Cursor' }).click();
  expect(JSON.parse((await text.textContent()) ?? '')).toEqual({
    mcpServers: { 'third-wheel': { command: 'node', args: [serverPath] } },
  });
  await button.click();
  await expect(result).toContainText('Cursor should open');
  await page.locator('#connect-agents label', { hasText: 'VS Code' }).click();
  await expect(text).toContainText('"type": "stdio"');
  await expect(text).toContainText('"tools"');
  await button.click();
  await expect(result).toContainText('VS Code should open');
  const opened = await app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);
  expect(opened).toHaveLength(2);
  expect(opened[0]).toMatch(
    /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=third-wheel&config=/,
  );
  expect(opened[1]).toMatch(/^vscode:mcp\/install\?/);

  // Other: copy only.
  await page.locator('#connect-agents label', { hasText: 'Other' }).click();
  await expect(button).toBeHidden();
  await expect(page.locator('#connect-agent-where')).toContainText('Cline');

  // The last choice is remembered.
  await page.keyboard.press('Escape');
  await page.locator('#ai-status').click();
  await expect(tab('other')).toBeChecked();
  await expect(page.locator('#connect-panel-agent')).toBeVisible();
  await expect(result).toBeHidden(); // results don't outlive the pop-up
  await page.locator('#connect-agents label', { hasText: 'Claude Code' }).click();
  await expect(page.locator('#connect-panel-claude')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#connect-dialog')).toBeHidden();
});

test('Info panel: one face, two opposite faces, an edge; sections collapse', async () => {
  const page = await app.firstWindow();
  const info = page.locator('#info');
  const ids = await page.evaluate(() => {
    const m = (window as HookWindow).__thirdWheelTest?.model();
    if (!m) throw new Error('no model');
    const normalX = (f: number): number => m.faceGeometry[f * 8] ?? 0;
    const faces = m.faceGeometry.length / 8;
    const range = Array.from({ length: faces }, (_, f) => f);
    return {
      left: range.find((f) => normalX(f) < -0.5) ?? -1,
      right: range.find((f) => normalX(f) > 0.5) ?? -1,
      edge30: m.edgeTypes.findIndex(
        (_, e) => Math.abs((m.edgeGeometry[e * 9 + 6] ?? 0) - 30) < 1e-6,
      ),
    };
  });
  const select = (items: { kind: string; id: number }[]): Promise<void> =>
    page.evaluate((list) => {
      const hook = (window as HookWindow).__thirdWheelTest;
      hook?.selection.clear();
      hook?.selection.addAll(list);
    }, items);

  await select([]);
  await expect(info).toContainText('Select something');
  await select([{ kind: 'face', id: ids.left }]);
  await expect(info).toContainText(`Face ${String(ids.left)} · Plane`);
  await expect(info).toContainText('(-1, 0, 0)');
  await expect(info).toContainText('≈ 600 mm²');
  await select([
    { kind: 'face', id: ids.left },
    { kind: 'face', id: ids.right },
  ]);
  await expect(info.locator('.info-block')).toHaveCount(3);
  await expect(info).toContainText('Perpendicular to plane');
  await expect(info).toContainText('10 mm');
  await expect(info).toContainText('0°');
  await select([{ kind: 'edge', id: ids.edge30 }]);
  await expect(info).toContainText('30 mm');
  const exactButton = page.locator('#info-exact');
  await expect(exactButton).toHaveCount(0); // nothing "≈" for an edge

  // Exact values (T2.8): the kernel was kept (small model), so the ≈ values are replaced.
  await select([
    { kind: 'face', id: ids.left },
    { kind: 'face', id: ids.right },
  ]);
  await expect(info).toContainText('≈');
  await exactButton.click();
  await expect(exactButton).toHaveCount(0);
  await expect(info).not.toContainText('≈');
  await expect(info).toContainText('600 mm²');
  await expect(info).toContainText(/Shortest distance\s*10 mm/);

  // Collapse: content hidden, remembered across a reload; expand again.
  const toggle = info.locator('.section-toggle');
  await toggle.click();
  await expect(info).toHaveClass(/collapsed/);
  await expect(page.locator('#info-body')).toBeHidden();
  await page.reload();
  await expect(page.locator('#info')).toHaveClass(/collapsed/);
  await page.locator('#info .section-toggle').click();
  await expect(page.locator('#info-body')).toBeVisible();
  await expect(page.locator('#bodies .section-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('Revision: Reload from disk carries same geometry over, moves changed (T8.2); load_model revisionOf', async () => {
  const page = await app.firstWindow();
  const revisions = resolve(appDir, '../../packages/geometry/test-data/revisions');
  const bracket = join(dir, 'bracket.step');
  const sidecar = `${bracket}.thirdwheel.json`;
  copyFileSync(join(revisions, 'base.step'), bracket);
  const client = new Client({ name: 'e2e', version: '1' });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(appDir, '../../packages/mcp-server/build/third-wheel-mcp.js')],
      cwd: dir,
      env: { ...env, THIRD_WHEEL_BRIDGE_FILE: bridgeFile },
      stderr: 'ignore',
    }),
  );
  type Loaded = {
    modelId: string;
    name: string;
    comments: { open: number };
    revision?: { of: string; annotations: string; markers: number; comments: number };
  };
  const load = async (args: Record<string, unknown>) => {
    const r = (await client.callTool({ name: 'load_model', arguments: args })) as {
      content: { text?: string }[];
      isError?: boolean;
    };
    return { isError: r.isError, text: r.content.at(-1)?.text ?? '' };
  };
  const loadJson = async (args: Record<string, unknown>): Promise<Loaded> =>
    JSON.parse((await load(args)).text) as Loaded;
  const hook = () =>
    page.evaluate(() => {
      const t = (window as HookWindow).__thirdWheelTest as unknown as {
        markers: { list(): { id: string; entities: unknown[] }[] };
        comments: { list(): { text: string }[] };
        previousVersion(): Record<string, unknown> | undefined;
      };
      return {
        markers: t.markers.list().map((m) => m.entities.length),
        comments: t.comments.list().map((c) => c.text),
        previous: t.previousVersion(),
      };
    });
  const addComment = (text: string, faces = [0]) =>
    page.evaluate(
      ([t, ids]) => {
        const h = (window as HookWindow).__thirdWheelTest as unknown as {
          markers: { add(e: { kind: string; id: number }[]): { id: string } };
          comments: { add(text: string, ids: string[]): unknown };
        };
        h.comments.add(t, [h.markers.add(ids.map((id) => ({ kind: 'face', id }))).id]);
      },
      [text, faces] as const,
    );
  const flush = () => page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  const backups = (): string[] =>
    readdirSync(dir).filter((f) => f.startsWith('bracket.step.') && f.endsWith('.bak.json'));
  try {
    const first = await loadJson({ path: bracket });
    expect(first.revision).toBeUndefined();
    await expect(page.locator('#reload-model')).toBeEnabled();
    await addComment('Thicker here');
    await flush();
    const saved = JSON.parse(readFileSync(sidecar, 'utf8')) as {
      model: { contentHash: string; meshHash?: string };
    };
    expect(saved.model.meshHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const before = await hook();

    // Unchanged file: Reload says so and keeps everything.
    await page.locator('#reload-model').click();
    await expect(page.locator('#notice-text')).toHaveText("bracket.step hasn't changed on disk.");

    // Re-export with the same geometry (only ids inside the file differ): carried over exactly.
    copyFileSync(join(revisions, '00-unchanged.step'), bracket);
    await page.locator('#reload-model').click();
    await expect(page.locator('#notice-text')).toContainText(
      'bracket.step changed on disk, but its geometry is the same',
    );
    const carried = await hook();
    expect(carried.markers).toEqual(before.markers);
    expect(carried.comments).toEqual(['Thicker here']);
    expect(carried.previous).toMatchObject({ carried: true, comments: 1, inMemory: true });
    // Saved at once with the new file's hash; nothing lost, so no backup copy.
    await expect
      .poll(
        () =>
          (JSON.parse(readFileSync(sidecar, 'utf8')) as typeof saved).model.contentHash !==
          saved.model.contentHash,
      )
      .toBe(true);
    expect(backups()).toEqual([]);
    await expect(page.locator('#notice-text')).toContainText('carried over');
    // Same geometry: nothing to compare with the previous version.
    await page.locator('#versions-menu').click();
    await expect(page.locator('[data-action="import-version"]')).toBeVisible();
    await expect(page.locator('[data-action="compare-previous"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Changed geometry (right-click → Reload from disk): the bracket moved and got a rib. T8.2
    // moves the annotations over (the face is found on the moved body), saves, keeps a backup.
    copyFileSync(join(revisions, '07-moved.step'), bracket);
    const box = await page.locator('#viewport canvas').first().boundingBox();
    await page.mouse.click((box?.x ?? 0) + 5, (box?.y ?? 0) + 5, { button: 'right' });
    await page.locator('[data-action="reload-from-disk"]').click();
    await expect(page.locator('#notice-text')).toContainText(
      /bracket\.step changed on disk: \d+ markers? moved onto the new geometry, all found\. The old file was kept as .*\.bak\.json/,
    );
    await expect(page.locator('#alert-dialog')).toBeHidden();
    const moved = await hook();
    expect(moved.comments).toEqual(['Thicker here']);
    expect(moved.markers).toEqual(before.markers);
    expect(moved.previous).toMatchObject({ carried: false, comments: 1, inMemory: true });
    expect(backups()).toHaveLength(1);
    await expect(page.locator('.marker-transfer')).toHaveCount(0);
    // T8.3: compare with the previous version (its mesh is still in memory).
    const revisionStats = () =>
      page.evaluate(() =>
        (
          (window as HookWindow).__thirdWheelTest as unknown as {
            viewport: { revisionStats(): { ghosts: number; comparing: boolean } };
          }
        ).viewport.revisionStats(),
      );
    const compare = page.locator('#versions-menu');
    await compare.click();
    await page.locator('[data-action="compare-previous"]').click();
    await expect(compare).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#compare-legend')).toContainText(
      'Comparing with bracket.step before reload',
    );
    await expect(page.locator('#compare-key-old')).toHaveText('Previous version');
    expect((await revisionStats()).comparing).toBe(true);
    await page.locator('#compare-end').click();
    await expect(page.locator('#compare-legend')).toBeHidden();
    expect(await revisionStats()).toEqual({ ghosts: 0, comparing: false });

    // load_model with another file name: revisionOf names the previous version.
    // Most of the bracket's faces (with the off-centre hole): enough to tell a mirror from a turn.
    await addComment(
      'On the moved part',
      Array.from({ length: 14 }, (_, i) => i),
    );
    await flush();
    const shown = await loadJson({ path: bracket });
    expect(shown.revision).toBeUndefined(); // its own sidecar fits: a plain reopen
    // A mirrored bracket: its markers are not moved ("? Check"), comments kept.
    copyFileSync(join(revisions, '09-mirrored.step'), join(dir, 'bracket-v2.step'));
    const v2 = await loadJson({ path: 'bracket-v2.step', revisionOf: shown.modelId });
    expect(v2.revision).toMatchObject({ of: 'bracket.step', annotations: 'moved', comments: 2 });
    const sum = (v2.revision as { transfer?: { check: number; flagged: { status: string }[] } })
      .transfer;
    expect(sum?.check).toBeGreaterThan(0);
    expect(sum?.flagged.map((f) => f.status)).toContain('check');
    expect(v2.comments.open).toBe(2);
    await expect(page.locator('#notice-text')).toContainText(
      /bracket-v2\.step is a new version of bracket\.step: \d+ markers moved over — .* to check \(mirrored\)\. Look for ⚠ in Markers\./,
    );
    const badges = page.locator('.marker-transfer.check');
    const flagged = await badges.count();
    expect(flagged).toBe(sum?.check);
    await expect(badges.first()).toHaveAttribute('title', /mirrored.*bracket\.step/);
    // T8.3: "? Check" markers are drawn as ghosts at their old place until "Looks right".
    expect((await revisionStats()).ghosts).toBe(flagged);
    // "✓ Place here" paints / holds the ghost where it is drawn; undo takes it back.
    const checkRow = page
      .locator('.marker-row', { has: page.locator('.marker-transfer.check') })
      .first();
    const checkId = await checkRow.getAttribute('data-marker');
    const painted = (id: string | null) =>
      page.evaluate(
        (m) =>
          (
            (window as HookWindow).__thirdWheelTest as unknown as {
              paint(): { count(id: string): number } | undefined;
            }
          )
            .paint()
            ?.count(m ?? '') ?? 0,
        id,
      );
    const held = (id: string | null) =>
      page.evaluate(
        (m) =>
          (
            (window as HookWindow).__thirdWheelTest as unknown as {
              markers: { get(id: string): { entities: unknown[] } | undefined };
            }
          ).markers.get(m ?? '')?.entities.length ?? 0,
        id,
      );
    const paintBefore = await painted(checkId);
    const heldBefore = await held(checkId);
    const checkBadge = checkRow.locator('.marker-transfer');
    await checkBadge.hover();
    await expect(checkBadge).toContainText('✓ Place here');
    await expect(checkRow.locator('.transfer-drop')).toBeVisible();
    await checkBadge.click();
    await expect(badges).toHaveCount(flagged - 1);
    expect((await revisionStats()).ghosts).toBe(flagged - 1);
    expect((await painted(checkId)) + (await held(checkId))).toBeGreaterThan(
      paintBefore + heldBefore,
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(badges).toHaveCount(flagged);
    expect(await painted(checkId)).toBe(paintBefore);
    expect(await held(checkId)).toBe(heldBefore);
    // "✕ Drop" removes the unplaced part instead; undo brings it back.
    await checkRow.hover();
    await checkRow.locator('.transfer-drop').click();
    await expect(badges).toHaveCount(flagged - 1);
    expect(await painted(checkId)).toBe(paintBefore);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(badges).toHaveCount(flagged);
    expect(existsSync(sidecar)).toBe(true); // the previous version's sidecar is left alone
    // Same contents under another name (same modelId, so this goes last).
    copyFileSync(bracket, join(dir, 'bracket-copy.step'));
    const same = await loadJson({ path: 'bracket-copy.step', revisionOf: shown.modelId });
    expect(same.revision).toMatchObject({
      of: 'bracket.step',
      annotations: 'carried',
      comments: 2,
    });
    expect(same.comments.open).toBe(2);
    // A file with its own sidecar for an older version of itself, loaded with revisionOf: the
    // named file's annotations are used, its own stale one is backed up (never overwritten).
    const v3 = join(dir, 'bracket-v3.step');
    copyFileSync(join(revisions, 'base.step'), v3);
    writeFileSync(
      `${v3}.thirdwheel.json`,
      readFileSync(sidecar, 'utf8').replace(
        /"contentHash": "sha256:[0-9a-f]+"/,
        `"contentHash": "sha256:${'0'.repeat(64)}"`,
      ),
    );
    const v3Loaded = await loadJson({ path: v3, revisionOf: shown.modelId });
    // Same modelId as bracket.step, opened last (see the copy above).
    expect(v3Loaded.revision).toMatchObject({ of: 'bracket-copy.step', annotations: 'moved' });
    await expect(page.locator('#notice-text')).toContainText(
      /Its own older annotations were moved to bracket-v3\.step\.thirdwheel\..*\.bak\.json/,
    );
    expect(
      readdirSync(dir).filter((f) => f.startsWith('bracket-v3.step.') && f.endsWith('.bak.json')),
    ).toHaveLength(1);
    const unknown = await load({ path: 'bracket-v2.step', revisionOf: 'ffffffffffff' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/revisionOf: no model ffffffffffff/);
    // T8.4: a versioned name without revisionOf → hint naming the latest earlier version.
    copyFileSync(join(revisions, '01-fillet.step'), join(dir, 'bracket-v4.step'));
    const hinted = (await loadJson({ path: 'bracket-v4.step' })) as Loaded & { hint?: string };
    expect(hinted.revision).toBeUndefined();
    expect(hinted.hint).toMatch(/new version of bracket-v3\.step .*revisionOf: "[0-9a-f]{12}"/);
    // Overwritten in place (same path, new contents) → warning with the next name.
    copyFileSync(join(revisions, '02-hole-bigger.step'), join(dir, 'bracket-v2.step'));
    const over = (await loadJson({ path: 'bracket-v2.step' })) as Loaded & { warning?: string };
    expect(over.revision).toMatchObject({ of: 'bracket-v2.step' });
    // bracket-v3 and -v4 exist: the next free name is suggested.
    expect(over.warning).toContain('Next time export as bracket-v5.step');
  } finally {
    await client.close();
  }
});

test('Versions under new names: Open asks to bring notes from the earlier version (T8.4)', async () => {
  const page = await app.firstWindow();
  const revisions = resolve(appDir, '../../packages/geometry/test-data/revisions');
  const folder = join(dir, 'versions');
  mkdirSync(folder);
  const open = async (name: string): Promise<void> => {
    const path = join(folder, name);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
    }, path);
    await page.locator('#open-model').click();
  };
  // "widget.step · 2 bodies · …" once shown ("Loading widget.step…" before).
  const loadedName = (name: string) =>
    expect(page.locator('#model-info')).toHaveText(
      new RegExp(`^${name.replace(/[.()]/g, '\\$&')} · `),
      { timeout: 60_000 },
    );
  const comments = () =>
    page.evaluate(() =>
      (
        (window as HookWindow).__thirdWheelTest as unknown as {
          comments: { list(): { text: string }[] };
        }
      ).comments
        .list()
        .map((c) => c.text),
    );
  const question = page.locator('#version-dialog');
  copyFileSync(join(revisions, 'base.step'), join(folder, 'widget.step'));
  await open('widget.step');
  // After the Revision test this session holds bracket files with the same body names (Bracket,
  // Pin): then it asks about those (a renamed file); run alone, nothing fits and it is silent.
  const info = page.locator('#model-info');
  await expect
    .poll(
      async () => (await question.isVisible()) || /^widget\.step · /.test(await info.innerText()),
      {
        timeout: 60_000,
      },
    )
    .toBe(true);
  if (await question.isVisible()) {
    await expect(page.locator('#version-title')).toHaveText(
      /^Is widget\.step a new version of bracket/,
    );
    await page.locator('#version-separate').click();
  }
  await loadedName('widget.step');
  await expect(question).toBeHidden();
  await page.evaluate(() => {
    const h = (window as HookWindow).__thirdWheelTest as unknown as {
      markers: { add(e: { kind: string; id: number }[]): { id: string } };
      comments: { add(text: string, ids: string[]): unknown };
    };
    h.comments.add('Round this', [h.markers.add([{ kind: 'face', id: 0 }]).id]);
  });
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  const v1Sidecar = readFileSync(join(folder, 'widget.step.thirdwheel.json'), 'utf8');

  // A versioned name next to it, opened by the user: asked, "Bring my notes over" moves them.
  copyFileSync(join(revisions, '01-fillet.step'), join(folder, 'widget_v2.step'));
  await open('widget_v2.step');
  await expect(question).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#version-title')).toHaveText(
    'Is widget_v2.step a new version of widget.step?',
  );
  await expect(page.locator('#version-text')).toContainText('2 markers and 1 comment');
  await page.locator('#version-bring').click();
  await loadedName('widget_v2.step');
  await expect(page.locator('#notice-text')).toContainText(
    'widget_v2.step is a new version of widget.step',
  );
  expect(await comments()).toEqual(['Round this']);
  // v1 was shown just before: its mesh is in memory to compare with.
  await page.locator('#versions-menu').click();
  await expect(page.locator('[data-action="compare-previous"]')).toContainText('widget.step');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  expect(existsSync(join(folder, 'widget_v2.step.thirdwheel.json'))).toBe(true);
  // v1's notes only get a "newer version" line (T8.6); markers and comments stay as they were.
  const v1Now = JSON.parse(
    readFileSync(join(folder, 'widget.step.thirdwheel.json'), 'utf8'),
  ) as Record<string, unknown> & { versions?: { newer?: { name: string }[] } };
  expect(v1Now.versions?.newer?.map((l) => l.name)).toEqual(['widget_v2.step']);
  delete v1Now.versions;
  expect(v1Now).toEqual(JSON.parse(v1Sidecar));
  const v2Notes = JSON.parse(
    readFileSync(join(folder, 'widget_v2.step.thirdwheel.json'), 'utf8'),
  ) as { versions?: { earlier?: { name: string }[] } };
  expect(v2Notes.versions?.earlier?.map((l) => l.name)).toEqual(['widget.step']);

  // v3: the newest earlier version with notes (v2) is named; "Separate part" keeps it empty and
  // isn't asked again this session.
  copyFileSync(join(revisions, '05-rib.step'), join(folder, 'widget-rev3.step'));
  await open('widget-rev3.step');
  await expect(page.locator('#version-title')).toHaveText(
    'Is widget-rev3.step a new version of widget_v2.step?',
    { timeout: 60_000 },
  );
  await page.locator('#version-separate').click();
  await loadedName('widget-rev3.step');
  expect(await comments()).toEqual([]);
  await open('widget_v2.step'); // own notes: never asked
  await loadedName('widget_v2.step');
  await open('widget-rev3.step');
  await loadedName('widget-rev3.step');
  await expect(question).toBeHidden();
  expect(await comments()).toEqual([]);
  // Opening an older version after a newer one (v0 < v2, rev3): silent.
  copyFileSync(join(revisions, 'base.step'), join(folder, 'widget_v0.step'));
  await open('widget_v0.step');
  await loadedName('widget_v0.step');
  await expect(question).toBeHidden();
});

test('Version history: import, list, compare and open versions (T8.5, chain T8.6)', async () => {
  const page = await app.firstWindow();
  const revisions = resolve(appDir, '../../packages/geometry/test-data/revisions');
  const folder = join(dir, 'history');
  mkdirSync(folder);
  const pick = async (name: string): Promise<void> => {
    const path = join(folder, name);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
    }, path);
  };
  const loadedName = (name: string) =>
    expect(page.locator('#model-info')).toHaveText(
      new RegExp(`^${name.replace(/[.()]/g, '\\$&')} · `),
      { timeout: 60_000 },
    );
  const comments = () =>
    page.evaluate(() =>
      (
        (window as HookWindow).__thirdWheelTest as unknown as {
          comments: { list(): { text: string }[] };
        }
      ).comments
        .list()
        .map((c) => c.text),
    );
  copyFileSync(join(revisions, 'base.step'), join(folder, 'hist.step'));
  await pick('hist.step');
  await page.locator('#open-model').click();
  // Earlier tests leave files with the same body names in this session: a question may come.
  const question = page.locator('#version-dialog');
  await expect
    .poll(
      async () =>
        (await question.isVisible()) ||
        /^hist\.step · /.test(await page.locator('#model-info').innerText()),
      { timeout: 60_000 },
    )
    .toBe(true);
  if (await question.isVisible()) await page.locator('#version-separate').click();
  await loadedName('hist.step');
  await page.evaluate(() => {
    const h = (window as HookWindow).__thirdWheelTest as unknown as {
      markers: { add(e: { kind: string; id: number }[]): { id: string } };
      comments: { add(text: string, ids: string[]): unknown };
    };
    h.comments.add('Keep this', [h.markers.add([{ kind: 'face', id: 0 }]).id]);
  });
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());

  // Cmd/Ctrl+I: Import new version… → the notes come over (T8.1 / T8.2 path).
  copyFileSync(join(revisions, '01-fillet.step'), join(folder, 'hist_v2.step'));
  await pick('hist_v2.step');
  await page.keyboard.press('ControlOrMeta+i');
  await loadedName('hist_v2.step');
  await expect(page.locator('#notice-text')).toContainText('hist_v2.step');
  expect(await comments()).toEqual(['Keep this']);

  // The list (the version chain, T8.6): the earlier file under the shown one, ticked.
  const menu = page.locator('#versions-menu');
  await menu.click();
  const rows = page.locator('.context-menu-item[data-action="version-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('hist.step');
  await expect(page.locator('.context-menu-item[aria-checked="true"]')).toContainText(
    'hist_v2.step',
  );
  // A file with a versioned name but no link is not listed (no folder scan any more).
  await page.keyboard.press('Escape');
  copyFileSync(join(revisions, '05-rib.step'), join(folder, 'hist_v9.step'));
  await menu.click();
  await expect(rows).toHaveCount(1);
  // Compare with the file (read from disk, not the in-memory previous version).
  await rows.first().click();
  await page.locator('[data-action="compare-version"]').click();
  await expect(page.locator('#compare-legend')).toContainText('Comparing with hist.step', {
    timeout: 60_000,
  });
  await expect(page.locator('#compare-key-old')).toHaveText('Only in hist.step');
  await expect(page.locator('#compare-key-new')).toHaveText('Only in hist_v2.step (shown)');
  await expect(menu).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#compare-end').click();
  await expect(page.locator('#compare-legend')).toBeHidden();

  // Open the older version from the list: its own notes, nothing asked; it knows the newer one.
  await menu.click();
  await rows.first().click();
  await page.locator('[data-action="open-version"]').click();
  await loadedName('hist.step');
  await expect(question).toBeHidden();
  expect(await comments()).toEqual(['Keep this']);
  await expect(page.locator('#notice-text')).toContainText("There's a newer version: hist_v2.step");
  await menu.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('hist_v2.step');
  await page.keyboard.press('Escape');

  // Moved away: "not found" + Locate… (content hash checked: a wrong file is refused).
  mkdirSync(join(folder, 'moved'));
  renameSync(join(folder, 'hist_v2.step'), join(folder, 'moved', 'renamed.step'));
  await menu.click();
  await expect(rows.first()).toContainText('not found');
  await rows.first().click();
  await pick('hist_v9.step');
  await page.locator('[data-action="locate-version"]').click();
  await expect(page.locator('#notice-text')).toContainText('its contents are different');
  await menu.click();
  await rows.first().click();
  await pick(join('moved', 'renamed.step'));
  await page.locator('[data-action="locate-version"]').click();
  await expect(page.locator('#notice-text')).toContainText('Found hist_v2.step');
  await menu.click();
  await expect(rows.first()).toContainText('renamed.step');
  await expect(rows.first()).not.toContainText('not found');
  await page.keyboard.press('Escape');

  // Overwritten in place (Reload with changes): the old contents stay listed, greyed.
  await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  copyFileSync(join(revisions, '05-rib.step'), join(folder, 'hist.step'));
  await page.locator('#reload-model').click();
  await expect(page.locator('#notice-text')).toContainText('hist.step', { timeout: 60_000 });
  await menu.click();
  // T13.4: still listed (greyed text "overwritten"); its only action is Remove from versions….
  await expect(
    page.locator('.context-menu-item', { hasText: 'earlier contents of hist.step' }),
  ).toContainText('overwritten');
  await expect(rows.first()).toContainText('renamed.step'); // newer versions kept
  await page.keyboard.press('Escape');
});

test('Remove a version: unlinked in the notes, left out of guesses; one parent, no circles (T13.4)', async () => {
  const page = await app.firstWindow();
  const revisions = resolve(appDir, '../../packages/geometry/test-data/revisions');
  const folder = join(dir, 'remove-version');
  mkdirSync(folder);
  const pick = async (name: string): Promise<void> => {
    const path = join(folder, name);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
    }, path);
  };
  const loadedName = (name: string) =>
    expect(page.locator('#model-info')).toHaveText(
      new RegExp(`^${name.replace(/[.()]/g, '\\$&')} · `),
      { timeout: 60_000 },
    );
  const notes = (name: string): { versions?: Record<string, unknown> } =>
    JSON.parse(readFileSync(join(folder, `${name}.thirdwheel.json`), 'utf8')) as {
      versions?: Record<string, unknown>;
    };
  const names = (list: unknown): string[] =>
    ((list as { name: string }[] | undefined) ?? []).map((l) => l.name);
  const flush = () => page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  const menu = page.locator('#versions-menu');
  const rows = page.locator('.context-menu-item[data-action="version-row"]');
  const question = page.locator('#version-dialog');
  const choice = page.locator('#choice-dialog');

  // A with a comment; B = a wrong file imported as its new version (highest version number).
  copyFileSync(join(revisions, 'base.step'), join(folder, 'rm.step'));
  await pick('rm.step');
  await page.locator('#open-model').click();
  await expect
    .poll(
      async () =>
        (await question.isVisible()) ||
        /^rm\.step · /.test(await page.locator('#model-info').innerText()),
      { timeout: 60_000 },
    )
    .toBe(true);
  if (await question.isVisible()) await page.locator('#version-separate').click();
  await loadedName('rm.step');
  await page.evaluate(() => {
    const h = (window as HookWindow).__thirdWheelTest as unknown as {
      markers: { add(e: { kind: string; id: number }[]): { id: string } };
      comments: { add(text: string, ids: string[]): unknown };
    };
    h.comments.add('Keep this', [h.markers.add([{ kind: 'face', id: 0 }]).id]);
  });
  await flush();
  copyFileSync(join(revisions, '01-fillet.step'), join(folder, 'rm_v9.step'));
  await pick('rm_v9.step');
  await page.keyboard.press('ControlOrMeta+i');
  await loadedName('rm_v9.step');
  await flush();

  // Back on A: Remove B (confirm pop-up; the file stays).
  await menu.click();
  await rows.first().click();
  await page.locator('[data-action="open-version"]').click();
  await loadedName('rm.step');
  await menu.click();
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await page.locator('[data-action="remove-version"]').click();
  await expect(choice).toBeVisible();
  await expect(page.locator('#choice-title')).toHaveText('Remove rm_v9.step from the versions?');
  await page.locator('#choice-first').click();
  await expect(page.locator('#notice-text')).toContainText('Removed rm_v9.step');
  await flush();
  await menu.click();
  await expect(rows).toHaveCount(0);
  await expect(
    page.locator('.context-menu-item', { hasText: 'No other versions linked yet' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect(notes('rm.step').versions).toBeUndefined();
  expect(Object.keys(notes('rm_v9.step').versions ?? {})).toEqual(['unlinked']);
  expect(existsSync(join(folder, 'rm_v9.step'))).toBe(true);

  // The T8.4 guess leaves B out: a new file asks about A, not B (higher number).
  copyFileSync(join(revisions, '05-rib.step'), join(folder, 'rm_v10.step'));
  await pick('rm_v10.step');
  await page.locator('#open-model').click();
  await expect(question).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#version-title')).toHaveText(
    'Is rm_v10.step a new version of rm.step?',
  );
  await page.locator('#version-bring').click();
  await loadedName('rm_v10.step');
  await flush();

  // No circle: A is an earlier version of the shown file, so it can't be imported as newer.
  await pick('rm.step');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(page.locator('#alert-dialog')).toContainText('is an earlier version of rm_v10.step');
  await page.locator('#alert-ok').click();
  await loadedName('rm_v10.step');

  // One parent: importing rm_v10 (parent A) onto B asks; "keep" leaves the link as it was.
  await pick('rm_v9.step');
  await page.locator('#open-model').click();
  await loadedName('rm_v9.step');
  await pick('rm_v10.step');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(choice).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#choice-title')).toHaveText(
    'Which file is rm_v10.step a newer version of?',
  );
  await page.locator('#choice-second').click();
  await loadedName('rm_v10.step');
  await flush();
  expect(names(notes('rm_v10.step').versions?.earlier)).toEqual(['rm.step']);
  // … and picking B moves it: A's signpost goes, B's "unlinked" mark goes (linked again).
  await pick('rm_v9.step');
  await page.locator('#open-model').click();
  await loadedName('rm_v9.step');
  await pick('rm_v10.step');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(choice).toBeVisible({ timeout: 60_000 });
  await page.locator('#choice-first').click();
  // T15.2: rm_v10 has notes of its own → Keep / Replace (Esc = keep).
  await expect(page.locator('#choice-title')).toHaveText('rm_v10.step already has its own notes');
  await page.keyboard.press('Escape');
  await loadedName('rm_v10.step');
  await flush();
  expect(names(notes('rm_v10.step').versions?.earlier)).toEqual(['rm_v9.step']);
  expect(names(notes('rm.step').versions?.newer)).toEqual([]);
  expect(notes('rm_v9.step').versions?.unlinked).toBeUndefined();
  expect(names(notes('rm_v9.step').versions?.newer)).toEqual(['rm_v10.step']);
  await menu.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('rm_v9.step');
  await page.keyboard.press('Escape');
});

/** T13.5: a folder of copied revision files and helpers for the version tests. */
async function versionFolder(name: string) {
  const page = await app.firstWindow();
  const revisions = resolve(appDir, '../../packages/geometry/test-data/revisions');
  const folder = join(dir, name);
  mkdirSync(folder);
  const pick = (file: string) =>
    app.evaluate(
      ({ dialog }, p) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
      },
      join(folder, file),
    );
  const loadedName = (file: string) =>
    expect(page.locator('#model-info')).toHaveText(
      new RegExp(`^${file.replace(/[.()]/g, '\\$&')} · `),
      { timeout: 60_000 },
    );
  type Notes = {
    versions?: { earlier?: { name: string }[]; newer?: { name: string }[] };
    comments?: { text: string }[];
  };
  const notes = (file: string): Notes =>
    JSON.parse(readFileSync(join(folder, `${file}.thirdwheel.json`), 'utf8')) as Notes;
  const flush = () => page.evaluate(() => (window as HookWindow).__thirdWheelTest?.flush());
  const question = page.locator('#version-dialog');
  /** Open… a file; a T8.4 "new version of …?" question is answered "separate part". */
  const open = async (file: string) => {
    await pick(file);
    await page.locator('#open-model').click();
    await expect
      .poll(
        async () =>
          (await question.isVisible()) ||
          new RegExp(`^${file.replace(/[.()]/g, '\\$&')} · `).test(
            await page.locator('#model-info').innerText(),
          ),
        { timeout: 60_000 },
      )
      .toBe(true);
    if (await question.isVisible()) await page.locator('#version-separate').click();
    await loadedName(file);
    await flush();
  };
  /** Import new version… onto the shown file. */
  const importNew = async (file: string) => {
    await pick(file);
    await page.keyboard.press('ControlOrMeta+i');
    await loadedName(file);
    await flush();
  };
  const comment = (text: string) =>
    page.evaluate((t) => {
      const h = (window as HookWindow).__thirdWheelTest as unknown as {
        markers: { add(e: { kind: string; id: number }[]): { id: string } };
        comments: { add(text: string, ids: string[]): unknown };
      };
      h.comments.add(t, [h.markers.add([{ kind: 'face', id: 0 }]).id]);
    }, text);
  const copy = (from: string, to: string): void => {
    copyFileSync(join(revisions, from), join(folder, to));
  };
  return { page, folder, pick, loadedName, notes, flush, open, importNew, comment, copy };
}

test('Import onto a file with stale notes: "keep" moves no markers of the named file (T13.5)', async () => {
  const { page, notes, flush, open, importNew, comment, copy, pick, loadedName } =
    await versionFolder('keep-parent');
  const names = (list: { name: string }[] | undefined) => (list ?? []).map((l) => l.name);
  // X = k_v2 linked as a newer version of k, with k's comment brought over.
  copy('base.step', 'k.step');
  await open('k.step');
  await comment('From k');
  await flush();
  copy('01-fillet.step', 'k_v2.step');
  await importNew('k_v2.step');
  expect(names(notes('k_v2.step').versions?.earlier)).toEqual(['k.step']);
  // k_v2 changes outside the app: its notes are now for older contents of it.
  copy('05-rib.step', 'k_v2.step');
  // Another file q with its own comment; Import k_v2 onto it → "keep" k.
  copy('base.step', 'q.step');
  await open('q.step');
  await comment('From q');
  await flush();
  await pick('k_v2.step');
  await page.keyboard.press('ControlOrMeta+i');
  const choice = page.locator('#choice-dialog');
  await expect(choice).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#choice-title')).toHaveText(
    'Which file is k_v2.step a newer version of?',
  );
  await page.locator('#choice-second').click();
  await loadedName('k_v2.step');
  await flush();
  // Like Open…: its own notes moved onto its new contents; nothing of q.
  const texts = (notes('k_v2.step').comments ?? []).map((c) => c.text);
  expect(texts).toEqual(['From k']);
  expect(names(notes('k_v2.step').versions?.earlier)).not.toContain('q.step');
  expect(names(notes('k_v2.step').versions?.earlier)).toContain('k.step');
  expect(names(notes('q.step').versions?.newer)).toEqual([]);
  // The AI hears where the notes came from: its own older contents, not q.
  const revision = await page.evaluate(() =>
    (
      (window as HookWindow).__thirdWheelTest as unknown as {
        revisionInfo(): { of: string; annotations: string } | undefined;
      }
    ).revisionInfo(),
  );
  expect(revision?.of).toBe('k_v2.step');
  expect(revision?.annotations).not.toBe('own');
});

test('Import onto a file with its own notes: empty = none, else Keep / Replace (T15.2)', async () => {
  const { page, folder, notes, flush, open, importNew, comment, copy, pick, loadedName } =
    await versionFolder('own-notes');
  const texts = (file: string) => (notes(file).comments ?? []).map((c) => c.text);
  const names = (list: { name: string }[] | undefined) => (list ?? []).map((l) => l.name);
  const hook = () =>
    page.evaluate(() => {
      const h = (window as HookWindow).__thirdWheelTest as unknown as {
        notice(): string | undefined;
        revisionInfo(): { annotations: string } | undefined;
      };
      return { notice: h.notice(), annotations: h.revisionInfo()?.annotations };
    });
  // An empty notes file (here: written by T8.6 when b got a newer version) counts as none.
  copy('base.step', 'a.step');
  copy('01-fillet.step', 'b.step');
  copy('05-rib.step', 'c.step');
  await open('b.step');
  await importNew('c.step');
  expect(texts('b.step')).toEqual([]);
  await open('a.step');
  await comment('From a');
  await flush();
  await importNew('b.step');
  expect(texts('b.step')).toEqual(['From a']);
  expect(names(notes('b.step').versions?.earlier)).toEqual(['a.step']);
  expect(names(notes('b.step').versions?.newer)).toEqual(['c.step']);
  // Notes of its own: asked. Keep → its notes stay, a notice says nothing was moved.
  copy('base.step', 'd.step');
  copy('01-fillet.step', 'e.step');
  await open('e.step');
  await comment('From e');
  await flush();
  await open('d.step');
  await comment('From d');
  await flush();
  const choice = page.locator('#choice-dialog');
  await pick('e.step');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(choice).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#choice-title')).toHaveText('e.step already has its own notes');
  await expect(page.locator('#choice-text')).toContainText('e.step has 2 markers and 1 comment');
  await page.keyboard.press('Escape'); // Esc = keep
  await loadedName('e.step');
  await flush();
  expect(texts('e.step')).toEqual(['From e']);
  expect(names(notes('e.step').versions?.earlier)).toEqual(['d.step']);
  let state = await hook();
  expect(state.notice).toBe('e.step kept its own notes; nothing was moved from d.step.');
  expect(state.annotations).toBe('own');
  // Replace → d's notes moved over, e's own kept in a backup copy.
  await open('d.step');
  await pick('e.step');
  await page.keyboard.press('ControlOrMeta+i');
  await expect(choice).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#choice-second')).toHaveText('Replace with notes from d.step');
  await page.locator('#choice-second').click();
  await loadedName('e.step');
  await flush();
  expect(texts('e.step')).toEqual(['From d']);
  expect(texts('d.step')).toEqual(['From d']);
  const backups = readdirSync(folder).filter((f) =>
    /^e\.step\.thirdwheel\..*\.bak(-\d+)?\.json$/.test(f),
  );
  expect(backups).toHaveLength(1);
  const backup = JSON.parse(readFileSync(join(folder, backups[0] ?? ''), 'utf8')) as {
    comments: { text: string }[];
  };
  expect(backup.comments.map((c) => c.text)).toEqual(['From e']);
  state = await hook();
  expect(state.annotations).not.toBe('own');
});

test('Removed version behind a moved file: remove it from the newer file too (T13.5)', async () => {
  const { page, folder, notes, open, importNew, flush, copy } =
    await versionFolder('removed-moved');
  const names = (list: { name: string }[] | undefined) => (list ?? []).map((l) => l.name);
  const menu = page.locator('#versions-menu');
  const rows = page.locator('.context-menu-item[data-action="version-row"]');
  copy('base.step', 'ch.step');
  await open('ch.step');
  copy('01-fillet.step', 'ch_v2.step');
  await importNew('ch_v2.step');
  copy('05-rib.step', 'ch_v3.step');
  await importNew('ch_v3.step');
  expect(names(notes('ch_v3.step').versions?.earlier)[0]).toBe('ch_v2.step');
  // B is moved away: from A, its newer version C can't be found.
  mkdirSync(join(folder, 'elsewhere'));
  renameSync(join(folder, 'ch_v2.step'), join(folder, 'elsewhere', 'ch_v2.step'));
  await open('ch.step');
  await menu.click();
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await page.locator('[data-action="remove-version"]').click();
  await page.locator('#choice-first').click();
  await expect(page.locator('#notice-text')).toContainText(
    'Removed ch_v2.step from the versions of ch.step',
  );
  await flush();
  // C still names B; its menu shows B as missing, with the hint and Remove.
  expect(names(notes('ch_v3.step').versions?.earlier)[0]).toBe('ch_v2.step');
  await open('ch_v3.step');
  await menu.click();
  const b = rows.filter({ hasText: 'ch_v2.step' });
  await expect(b).toHaveAttribute('title', /remove it here too/);
  await b.click();
  await page.locator('[data-action="remove-version"]').click();
  await page.locator('#choice-first').click();
  await expect(page.locator('#notice-text')).toContainText(
    'Removed ch_v2.step from the versions of ch_v3.step',
  );
  await flush();
  expect(names(notes('ch_v3.step').versions?.earlier)).toEqual(['ch.step']);
  expect(names(notes('ch.step').versions?.newer)).toEqual(['ch_v3.step']);
  await menu.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('ch.step');
  await page.keyboard.press('Escape');
});

test('File dialogs start in the shown model folder; none with no model (T12.8)', async () => {
  const page = await app.firstWindow();
  await loadedWindow();
  // Stub: remember the options, answer "cancelled" or a file.
  const stub = (answer?: string) =>
    app.evaluate(({ dialog }, p) => {
      const g = globalThis as { dialogOptions?: unknown[] };
      g.dialogOptions = [];
      const record = (...args: unknown[]) => {
        g.dialogOptions?.push(args.at(-1));
        return Promise.resolve(
          p === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p] },
        );
      };
      dialog.showOpenDialog = record;
    }, answer);
  const lastDefaultPath = async () => {
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { dialogOptions?: unknown[] }).dialogOptions?.length),
      )
      .toBe(1);
    return app.evaluate(
      () =>
        ((globalThis as { dialogOptions?: { defaultPath?: string }[] }).dialogOptions?.[0] ?? {})
          .defaultPath ?? null,
    );
  };
  const shown = await page.evaluate(
    () =>
      (
        (window as HookWindow).__thirdWheelTest as unknown as { shownPath(): string | undefined }
      ).shownPath() ?? '',
  );
  expect(shown).not.toBe('');

  // Import new version (Cmd/Ctrl+I) and Open… start in the shown model's folder.
  await stub();
  await page.keyboard.press('ControlOrMeta+i');
  expect(await lastDefaultPath()).toBe(dirname(shown));
  await stub();
  await page.locator('#open-model').click();
  expect(await lastDefaultPath()).toBe(dirname(shown));

  // No model (a fresh window): the OS default folder.
  await page.reload();
  await expect(page.locator('#open-model')).toBeVisible();
  await stub(shown);
  await page.locator('#open-model').click();
  expect(await lastDefaultPath()).toBeNull();
  // …and that Open… brought the model back for the next tests.
  await loadedWindow();
});

test('Mesh-only mode: an STL opens with a banner, paints, saves its notes, no entity picks', async () => {
  const page = await app.firstWindow();
  const hook = <T>(fn: () => T) => page.evaluate(fn);
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.model() !== undefined);
  const client = await connectBridge({ filePath: bridgeFile });
  const stl = join(dir, 'box.stl');
  try {
    const loaded = (await client.call('load', { path: stl })) as { mesh?: string; bodies: number };
    expect(loaded).toMatchObject({ mesh: 'stl', bodies: 1 });
    await expect(page.locator('#mesh-banner')).toBeVisible();
    await expect(page.locator('#mesh-banner-text')).toContainText('Entity selection needs STEP');
    await expect(page.locator('#filter-buttons button').first()).toBeDisabled();
    // T12.4: the active marker row has no "+ Selection" (a mesh has no entities).
    await expect(page.locator('#markers .marker-row.active')).toHaveCount(1);
    await expect(page.locator('.marker-add-selection')).toHaveCount(0);
    await expect(client.call('load', { path: stl, revisionOf: 'abcdef123456' })).rejects.toThrow(
      /needs a STEP file/,
    );

    await page.keyboard.press('Escape');
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    const top = await hook(() =>
      (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
    );
    if (!top) throw new Error('no projection');
    // Select tool: nothing is picked, a click selects nothing.
    expect(
      await page.evaluate(
        (q) => (window as HookWindow).__thirdWheelTest?.viewport.pick(q.x, q.y),
        top,
      ),
    ).toBeUndefined();
    const canvas = page.locator('#viewport canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await canvas.click({ position: top });
    expect(await hook(() => (window as HookWindow).__thirdWheelTest?.selection.list())).toEqual([]);

    // Brush works.
    const active = await hook(() => (window as HookWindow).__thirdWheelTest?.markers.active()?.id);
    if (!active) throw new Error('no active marker');
    const painted = () =>
      page.evaluate(
        (id) => (window as HookWindow).__thirdWheelTest?.paint()?.count(id) ?? -1,
        active,
      );
    await page.keyboard.press('b');
    await page.mouse.move(box.x + top.x - 10, box.y + top.y);
    await page.mouse.down();
    await page.mouse.move(box.x + top.x + 10, box.y + top.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(painted).toBeGreaterThan(0);
    const before = await painted();

    // Notes next to the STL: format stl, no tessellation; reopening brings the paint back.
    await hook(() => (window as HookWindow).__thirdWheelTest?.flush());
    const doc = JSON.parse(readFileSync(`${stl}.thirdwheel.json`, 'utf8')) as {
      model: { format: string };
      tessellation?: unknown;
    };
    expect(doc.model.format).toBe('stl');
    expect(doc.tessellation).toBeUndefined();
    await page.evaluate(() => (window as HookWindow).__thirdWheelTest?.reopen(true));
    await expect.poll(painted).toBe(before);
    await page.keyboard.press('Escape');

    // Back to STEP: banner gone, picking back.
    await client.call('load', { path: join(dir, 'box.step') });
    await expect(page.locator('#mesh-banner')).toBeHidden();
    await expect(page.locator('#filter-buttons button').first()).toBeEnabled();
    await expect(page.locator('.marker-add-selection')).toHaveCount(1);
  } finally {
    client.close();
  }
});

test('Mesh paint → STEP: revisionOf, Open asks (same size), Import a STEP (T9.2)', async () => {
  const page = await app.firstWindow();
  const hook = <T>(fn: () => T) => page.evaluate(fn);
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.model() !== undefined);
  const folder = join(dir, 'mesh-to-step');
  mkdirSync(folder);
  copyFileSync(join(dir, 'box.stl'), join(folder, 'cover.stl'));
  for (const n of ['cover-cad.step', 'cover-open.step', 'cover-import.step'])
    copyFileSync(join(dir, 'box.step'), join(folder, n));
  const stl = join(folder, 'cover.stl');
  const pick = async (name: string): Promise<void> => {
    const path = join(folder, name);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
    }, path);
  };
  const loadedName = (name: string) =>
    expect(page.locator('#model-info')).toHaveText(
      new RegExp(`^${name.replace(/[.()]/g, '\\$&')} · `),
      { timeout: 60_000 },
    );
  const paintedCount = () =>
    page.evaluate(() => {
      const h = (window as HookWindow).__thirdWheelTest;
      const id = h?.markers.list()[0]?.id;
      return id ? (h.paint()?.count(id) ?? 0) : 0;
    });
  const client = await connectBridge({ filePath: bridgeFile });
  try {
    const mesh = (await client.call('load', { path: stl })) as { modelId: string; mesh?: string };
    expect(mesh.mesh).toBe('stl');
    // Paint the top (z = 30) with the brush.
    await page.keyboard.press('Escape');
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    const top = await hook(() =>
      (window as HookWindow).__thirdWheelTest?.viewport.projectToCanvas([5, 10, 30]),
    );
    if (!top) throw new Error('no projection');
    const box = await page.locator('#viewport canvas').first().boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.keyboard.press('b');
    await page.mouse.move(box.x + top.x - 10, box.y + top.y);
    await page.mouse.down();
    await page.mouse.move(box.x + top.x + 10, box.y + top.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(paintedCount).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await hook(() => (window as HookWindow).__thirdWheelTest?.flush());

    // 1. The AI: load_model revisionOf = the mesh. Paint lands on the STEP's faces, report given.
    const loaded = (await client.call('load', {
      path: join(folder, 'cover-cad.step'),
      revisionOf: mesh.modelId,
    })) as {
      modelId: string;
      markers: number;
      revision?: {
        annotations: string;
        transfer?: { found: number; fromMesh?: { points: number; matched: number } };
      };
    };
    expect(loaded.markers).toBe(1);
    expect(loaded.revision?.annotations).toBe('moved');
    expect(loaded.revision?.transfer?.found).toBe(1);
    const cov = loaded.revision?.transfer?.fromMesh;
    expect(cov?.points).toBeGreaterThan(0);
    expect(cov?.matched).toBe(cov?.points);
    await expect.poll(paintedCount).toBeGreaterThan(0);
    await expect(page.locator('#notice-text')).toContainText(
      'Notes from cover.stl moved onto cover-cad.step: 1 marker, 100 % of the paint matched',
    );
    // Painted triangles of the STEP are on its top (z = 30), not anywhere else.
    const zs = await hook(() => {
      const h = (window as HookWindow).__thirdWheelTest;
      const m = h?.model();
      const id = h?.markers.list()[0]?.id;
      if (!m || !id) return [];
      const out: number[] = [];
      for (let t = 0; t < m.triangleFace.length; t++)
        if (
          (h.paint() as unknown as { markersAt(t: number): string[] } | undefined)
            ?.markersAt(t)
            .includes(id)
        )
          for (let k = 0; k < 3; k++)
            out.push(m.positions[(m.indices[t * 3 + k] ?? 0) * 3 + 2] ?? 0);
      return out;
    });
    expect(zs.length).toBeGreaterThan(0);
    for (const z of zs) expect(z).toBeCloseTo(30, 3);
    await hook(() => (window as HookWindow).__thirdWheelTest?.flush());
    const stepDoc = JSON.parse(
      readFileSync(join(folder, 'cover-cad.step.thirdwheel.json'), 'utf8'),
    ) as {
      model: { format: string };
      markers: unknown[];
      versions?: { earlier?: { name: string }[] };
    };
    expect(stepDoc.model.format).toBe('step');
    expect(stepDoc.markers).toHaveLength(1);
    expect(stepDoc.versions?.earlier?.[0]?.name).toBe('cover.stl');
    const stlDoc = JSON.parse(readFileSync(`${stl}.thirdwheel.json`, 'utf8')) as {
      model: { format: string };
      versions?: { newer?: { name: string }[] };
    };
    expect(stlDoc.model.format).toBe('stl');
    expect(stlDoc.versions?.newer?.[0]?.name).toBe('cover-cad.step');
    // Never onto a mesh.
    await expect(client.call('load', { path: stl, revisionOf: loaded.modelId })).rejects.toThrow(
      /needs a STEP file/,
    );

    // 2. Reopening the STL names the newer STEP; opening a same-size STEP asks.
    await pick('cover.stl');
    await page.locator('#open-model').click();
    await loadedName('cover.stl');
    await expect(page.locator('#notice-text')).toContainText(
      "There's a newer version: cover-cad.step",
    );
    await pick('cover-open.step');
    await page.locator('#open-model').click();
    await expect(page.locator('#version-title')).toHaveText(
      'Is cover-open.step the same part as cover.stl?',
      { timeout: 60_000 },
    );
    await page.locator('#version-bring').click();
    await loadedName('cover-open.step');
    await expect(page.locator('#notice-text')).toContainText(
      'Notes from cover.stl moved onto cover-open.step',
    );
    await expect.poll(paintedCount).toBeGreaterThan(0);

    // 3. Versions ▾ → Import new version… while the mesh is shown.
    await pick('cover.stl');
    await page.locator('#open-model').click();
    await loadedName('cover.stl');
    await expect(page.locator('#versions-menu')).toBeEnabled();
    await page.locator('#versions-menu').click();
    await pick('cover-import.step');
    await page.locator('[data-action="import-version"]').click();
    await loadedName('cover-import.step');
    await expect(page.locator('#notice-text')).toContainText(
      'Notes from cover.stl moved onto cover-import.step',
    );
    await expect.poll(paintedCount).toBeGreaterThan(0);

    // 4. T11.2: the STL in Versions ▾ is found (not "not found"); Compare greyed; Locate… works.
    const menu = page.locator('#versions-menu');
    const rows = page.locator('.context-menu-item[data-action="version-row"]');
    await menu.click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('cover.stl');
    await expect(rows.first()).not.toContainText('not found');
    await rows.first().click();
    await expect(page.locator('[data-action="compare-version"]')).toBeDisabled();
    await expect(page.locator('[data-action="open-version"]')).toBeEnabled();
    await page.keyboard.press('Escape'); // the submenu
    await page.keyboard.press('Escape'); // the menu
    await expect(rows).toHaveCount(0);
    mkdirSync(join(folder, 'moved'));
    renameSync(stl, join(folder, 'moved', 'cover-moved.stl'));
    await menu.click();
    await expect(rows.first()).toContainText('not found');
    await rows.first().click();
    await pick(join('moved', 'cover-moved.stl'));
    await page.locator('[data-action="locate-version"]').click();
    await expect(page.locator('#notice-text')).toContainText('Found cover.stl');
    await menu.click();
    await expect(rows.first()).toContainText('cover-moved.stl');
    await expect(rows.first()).not.toContainText('not found');
    await page.keyboard.press('Escape');
  } finally {
    client.close();
  }
});

test('STL without notes → newer STEP: reopening the STL gives no warning, no .bak (T15.1)', async () => {
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as HookWindow).__thirdWheelTest?.model() !== undefined);
  const folder = join(dir, 'mesh-no-notes');
  mkdirSync(folder);
  const stl = join(folder, 'plain.stl');
  copyFileSync(join(dir, 'box.stl'), stl);
  copyFileSync(join(dir, 'box.step'), join(folder, 'plain-cad.step'));
  const client = await connectBridge({ filePath: bridgeFile });
  try {
    const mesh = (await client.call('load', { path: stl })) as { modelId: string };
    expect(existsSync(`${stl}.thirdwheel.json`), 'no notes yet').toBe(false);
    await client.call('load', { path: join(folder, 'plain-cad.step'), revisionOf: mesh.modelId });
    // The STL got a notes file just for the "newer version" line — in its own format.
    const doc = JSON.parse(readFileSync(`${stl}.thirdwheel.json`, 'utf8')) as {
      model: { format: string };
      tessellation?: unknown;
      versions?: { newer?: { name: string }[] };
    };
    expect(doc.model.format).toBe('stl');
    expect(doc.tessellation).toBeUndefined();
    expect(doc.versions?.newer?.[0]?.name).toBe('plain-cad.step');

    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] });
    }, stl);
    await page.locator('#open-model').click();
    await expect(page.locator('#model-info')).toHaveText(/^plain\.stl · /, { timeout: 60_000 });
    await expect(page.locator('#notice-text')).toContainText(
      "There's a newer version: plain-cad.step",
    );
    await expect(page.locator('#alert-dialog')).not.toBeVisible();
    expect(readdirSync(folder).filter((n) => n.includes('.bak'))).toEqual([]);
  } finally {
    client.close();
  }
});

test('AI status: red when the bridge cannot start; start view links to the Connect pop-up (T7.6); version line (T13.3)', async () => {
  // The bridge file path is a folder → writing it fails, as a real start failure would.
  const blocked = join(dir, 'bridge-blocked');
  mkdirSync(blocked, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_RENDERER_URL'];
  delete env['THIRD_WHEEL_OPEN'];
  const second = await electron.launch({
    args: [appDir, `--user-data-dir=${join(dir, 'profile-blocked')}`, ...scaleArgs],
    env: { ...env, THIRD_WHEEL_TEST: '1', THIRD_WHEEL_BRIDGE_FILE: blocked },
  });
  try {
    const page = await second.firstWindow();
    await expect(page.locator('#ai-status')).toHaveAttribute('data-dot', 'error');
    await expect(page.locator('#ai-status')).toHaveText("AI: off — couldn't start");
    await expect(page.locator('#empty-view')).toBeVisible();
    await page.locator('#empty-connect').click();
    await expect(page.locator('#connect-dialog')).toBeVisible();
    await expect(page.locator('#connect-last')).toContainText("AI agents can't reach the app");
    await expect(page.locator('#connect-command')).toContainText('claude mcp add third-wheel');
    await page.keyboard.press('Escape');
    await expect(page.locator('#connect-dialog')).toBeHidden();

    // T13.3: version line at the bottom of the start card; "Open source" opens the browser.
    const version = await second.evaluate(({ app: a }) => a.getVersion());
    expect(version).toBe('0.1.0');
    const line = page.locator('#empty-version');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('v0.1.0 · Open source (Apache 2.0)', { useInnerText: true });
    await second.evaluate(({ shell }) => {
      const g = globalThis as { opened?: string[] };
      g.opened = [];
      shell.openExternal = (url: string) => {
        g.opened?.push(url);
        return Promise.resolve();
      };
    });
    await page.locator('#empty-version-link').click();
    await expect
      .poll(() => second.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['https://github.com/XiLaoTr/third-wheel']);
    expect(second.windows()).toHaveLength(1); // not opened inside the app
  } finally {
    await second.close();
  }
});

test('One app copy: a second launch hands its file to the open window and quits (T11.3)', async () => {
  const page = await loadedWindow();
  const execPath = await app.evaluate(() => process.execPath);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_RENDERER_URL'];
  delete env['THIRD_WHEEL_OPEN'];
  // Its own bridge file: had it started, it would have written this one.
  const secondBridge = join(dir, 'bridge-second.json');
  const lid = join(dir, 'lid.step');
  // Same profile folder as the open app = the same "app copy".
  const second = spawn(execPath, [appDir, `--user-data-dir=${join(dir, 'profile')}`, lid], {
    env: { ...env, THIRD_WHEEL_TEST: '1', THIRD_WHEEL_BRIDGE_FILE: secondBridge },
    stdio: 'ignore',
  });
  const code = await new Promise<number | null>((done, fail) => {
    const timer = setTimeout(() => {
      second.kill();
      fail(new Error('the second launch did not quit'));
    }, 30_000);
    second.on('exit', (exitCode) => {
      clearTimeout(timer);
      done(exitCode);
    });
  });
  expect(code).toBe(0);
  await expect(page.locator('#model-info')).toHaveText(/^lid\.step · /, { timeout: 60_000 });
  expect(existsSync(secondBridge), 'the second launch never started its bridge').toBe(false);
  expect(existsSync(bridgeFile), 'the first app keeps its bridge').toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});
