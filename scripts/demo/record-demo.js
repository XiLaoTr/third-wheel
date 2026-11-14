/* global window, document */
// Records the README demo GIF's frames (R2): drives the built app (`pnpm build` first) and the
// built MCP server through the core loop on the revision test bracket (base → 01-fillet), with a
// caption pill drawn into the page. Only the app's page is captured, never the screen.
//   node scripts/demo/record-demo.js <framesDir>
//   then: node scripts/demo/encode-gif.js <framesDir> docs/images/demo.gif <helpersDir>
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = resolve(process.argv[2] ?? join(repo, 'node_modules', '.cache', 'demo-frames'));
const appDir = resolve(repo, 'apps/desktop');
const req = createRequire(join(appDir, 'package.json'));
const { _electron: electron } = req('@playwright/test');
const { Client } = await import(req.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(
  req.resolve('@modelcontextprotocol/sdk/client/stdio.js')
);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'tw-demo-')));
const revs = join(repo, 'packages/geometry/test-data/revisions');
copyFileSync(join(revs, 'base.step'), join(dir, 'bracket.step'));
copyFileSync(join(revs, '01-fillet.step'), join(dir, 'bracket_v2.step'));
const bridgeFile = join(dir, 'bridge.json');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [appDir, `--user-data-dir=${join(dir, 'profile')}`, '--force-device-scale-factor=1'],
  env: { ...env, THIRD_WHEEL_TEST: '1', THIRD_WHEEL_BRIDGE_FILE: bridgeFile },
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(1120, 700);
  w.center();
});
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(1500);

const client = new Client({ name: 'demo', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(repo, 'packages/mcp-server/build/third-wheel-mcp.js')],
    cwd: dir,
    env: { ...env, THIRD_WHEEL_BRIDGE_FILE: bridgeFile },
    stderr: 'ignore',
  }),
);
const tool = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content.at(-1)?.text ?? 'null');
};

// Caption pill drawn into the page for the recording only.
await page.addStyleTag({
  content: `#demo-cap{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:99999;
  font:600 17px/1.3 system-ui,-apple-system,sans-serif;padding:9px 18px;border-radius:999px;
  background:rgba(20,22,28,.88);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;pointer-events:none}
  #demo-cap b{display:inline-block;margin-right:10px;padding:1px 9px;border-radius:999px;font-size:14px}
  #demo-cap b.ai{background:#8b5cf6}#demo-cap b.you{background:#2f7cf6}`,
});
const caption = (who, text) =>
  page.evaluate(
    ([w, t]) => {
      let el = document.getElementById('demo-cap');
      if (!el) {
        el = document.createElement('div');
        el.id = 'demo-cap';
        document.body.append(el);
      }
      el.innerHTML = `<b class="${w === 'AI' ? 'ai' : 'you'}">${w === 'AI' ? 'AI agent' : 'You'}</b>`;
      el.append(t);
    },
    [who, text],
  );

let n = 0;
const frames = [];
const snap = async (holdMs) => {
  const file = join(outDir, `f${String(n++).padStart(4, '0')}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, delay: holdMs });
};
const hook = (fn, arg) => page.evaluate(fn, arg);
const loaded = () =>
  page.waitForFunction(() => window.__thirdWheelTest?.loaded() === true, null, { timeout: 60000 });

const zoomIn = async () => {
  const c0 = await page.locator('#viewport canvas').first().boundingBox();
  const mid = await page.evaluate(
    (q) => window.__thirdWheelTest.viewport.projectToCanvas(q),
    [45, 20, 3],
  );
  await page.mouse.move(c0.x + mid.x, c0.y + mid.y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }
  await page.mouse.move(c0.x + 30, c0.y + c0.height - 140);
  await page.waitForTimeout(500);
};

// 1. Start view.
await caption('AI', 'Claude Code built a bracket and exports bracket.step');
await snap(1600);

// 2. AI opens the model and asks for a review.
const { modelId } = await tool('load_model', { path: 'bracket.step' });
await loaded();
await page.waitForTimeout(800);
await zoomIn();
await caption('AI', 'load_model + request_review: "Please check the bracket"');
await tool('request_review', { modelId, message: 'Please check the bracket.' });
await page.waitForTimeout(500);
await snap(2200);

// 3. Paint the plate's end edge with the brush.
const canvas = page.locator('#viewport canvas').first();
const box = await canvas.boundingBox();
const at = (p) => hook((q) => window.__thirdWheelTest.viewport.projectToCanvas(q), p);
await page.keyboard.press('b');
await caption('You', 'Brush: paint the edge you mean');
const pts = [];
for (let y = 3; y <= 37; y += 1.7) pts.push(await at([79.5, y, 5.6]));
await page.mouse.move(box.x + pts[0].x, box.y + pts[0].y);
await snap(700);
await page.mouse.down();
for (let i = 1; i < pts.length; i++) {
  await page.mouse.move(box.x + pts[i].x, box.y + pts[i].y, { steps: 3 });
  if (i % 2 === 0) await snap(110);
}
await page.mouse.up();
await snap(800);

// 4. Comment on it.
await page.keyboard.press('v');
await caption('You', 'Comment on the marker');
await page.locator('#comment-add').click();
const input = page.locator('#comments .comment-box textarea');
const text = 'Round this edge, about R3. It cuts my hand.';
for (let i = 4; i <= text.length; i += 4) {
  await input.fill(text.slice(0, i));
  if (i % 8 === 0) await snap(90);
}
await input.fill(text);
await snap(700);
await page.keyboard.press('ControlOrMeta+Enter');
await page.waitForTimeout(300);
await snap(1200);

// 5. Send to AI.
await caption('You', 'Send to AI');
await page.locator('#ai-banner-send').hover();
await snap(900);
await page.locator('#ai-banner-send').click();
await page.waitForTimeout(400);
await snap(1200);

// 6. AI reads, edits the CAD, loads v2 as a revision, marks the comment fixed.
const ann = await tool('get_annotations', { modelId });
await caption('AI', 'get_annotations → "Round this edge, about R3" on the end edge');
await snap(2200);
const v2 = await tool('load_model', { path: 'bracket_v2.step', revisionOf: modelId });
await loaded();
await page.waitForTimeout(800);
await zoomIn();
await caption('AI', 'Exports bracket_v2.step: your marker and comment move over');
await snap(2200);
await tool('set_comment_status', {
  modelId: v2.modelId,
  commentId: ann.comments[0].id,
  status: 'resolved',
  note: 'Added an R3 fillet on the end edge.',
});
await page.waitForTimeout(500);
await caption('AI', 'set_comment_status: "Added an R3 fillet on the end edge."');
await snap(2600);

// 7. User confirms.
await caption('You', 'Check it and confirm');
await page.locator('.comment-confirm').first().hover();
await snap(1000);
await page.locator('.comment-confirm').first().click();
await page.waitForTimeout(1200);
await caption('You', 'Done. Next comment → next round');
await snap(2600);

writeFileSync(join(outDir, 'frames.json'), JSON.stringify(frames));
await client.close();
await app.close();
rmSync(dir, { recursive: true, force: true });
console.log(`${frames.length} frames`);
