# Third Wheel — beta tester guide

Thanks for trying Third Wheel! It's an app for **talking about a 3D part with an AI**: you open the part, paint on it,
write comments, and your AI agent reads them, changes the part and shows you the new version.

This is an early test version. Something will go wrong — that's what the beta is for. Please tell me.

Plan **30–60 minutes**: 10 to install and connect, 15 for the first try, the rest to explore and write to me. You are also welcome to use it to the full extent.

You need:

- A Mac (macOS 12 or newer) or a Windows 10 / 11 PC.
- An **AI agent that can use tools on your computer**: Claude Code, Codex, Gemini CLI, Cursor or VS Code with Copilot. The ChatGPT app or website **won't work** (see [What doesn't work yet](#4-what-doesnt-work-yet)).
- The installer from **[Releases](https://github.com/XiLaoTr/third-wheel/releases/latest)** (`.dmg` for Mac, `.exe` for Windows) and the test part **[`bracket.step`](https://github.com/XiLaoTr/third-wheel/blob/main/docs/beta/bracket.step)** (on its page, click the download button ↓ at the top right).

## 1. Install

**Mac**

1. Open `Third-Wheel-…-mac.dmg` and drag **Third Wheel** into **Applications**. Start it from Applications (not from the open `.dmg` window).
2. The first start shows **"Apple could not verify “Third Wheel”…"**. That's expected: the app isn't signed with a paid Apple certificate yet. Click **Done** (not Move to Bin).
3. Open **System Settings → Privacy & Security**, scroll down to **"“Third Wheel” was blocked…"** and click **Open Anyway**, then **Open Anyway** again (it may ask for your password). On macOS 14 or older: right-click the app in Applications → **Open** → **Open**.
4. You only do this once.

**Windows**

1. Run `Third-Wheel-…-win-x64.exe`.
2. **"Windows protected your PC"** appears. That's expected: the app isn't signed with a paid certificate yet. Click **More info** → **Run anyway**.
3. Follow the installer. Third Wheel is then in the Start menu.

You should see the start page with **Open…** and **Connect an AI agent…**.

## 2. Connect your AI agent

Once, in the app: click **Connect an AI agent…** on the start page (or **AI: ready** at the bottom left later). Pick your agent's tab: **Claude Code, Codex, Gemini CLI, Cursor, VS Code** or **Other**.

- Most tabs have **one button** that sets it up for you (Connect to Claude Code, Add to Codex, Connect to Gemini CLI, Add to Cursor, Install in VS Code). Click it, then **start a new session / restart** your agent.
- If there's no button, the tab shows what to copy, with the paths of your computer filled in. Use **Copy** — don't type paths by hand.
- **Codex users:** the setup includes `tool_timeout_sec = 600`. Keep it, or Codex gives up while it waits for you.

**Check it worked:** ask your agent _"Which Third Wheel tools do you have?"_ It should list tools such as `load_model` and `get_annotations`. In Claude Code you can also type `/mcp` and look for `third-wheel`.

More detail per agent: [user guide → Other AI agents](user-guide.md#other-ai-agents) and [Connect Claude Code](user-guide.md#connect-claude-code).

**Keep Third Wheel open** while you work: your agent talks to the open app and can't start it for you.

## 3. First try (15 minutes)

This is a tutorial to walk you through most of the tools.

**Get ready.** Make a new folder, e.g. `Third Wheel test` in your Documents, and put `bracket.step` in it. Start your agent in that folder (Claude Code / Codex / Gemini: open a terminal there; Cursor / VS Code: open the folder).

**1. Ask the AI to open the part.** Type to your agent:

> _Open bracket.step in Third Wheel and ask me for a review. When I send my comments, change the part, export it as bracket_v2.step and open it as a new version of bracket.step._

The part appears in Third Wheel: an L-shaped bracket with a round boss on top, two holes and a separate pin. A coloured banner at the top says the AI is waiting for your review.

**2. Look around.** The mouse works like Fusion 360 at first: **Shift + middle-drag** turns the view, **middle-drag**
moves it, the **wheel** zooms (trackpad: Shift + swipe turns, swipe moves, pinch zooms). Used to Onshape or a slicer (PrusaSlicer, OrcaSlicer: left-drag turns)? Switch to their mouse buttons in the status bar at the bottom. Press `?` any time for all shortcuts.

**3. Paint a spot and comment on it.**

- Click **Brush** in the toolbar (or press `B`). Paint around the **hole in the flat plate** (the one that is _not_ in the round boss). `[` and `]` make the brush smaller / bigger; hold **Shift** to erase.
- In the right panel, click **+ Comment** and write: _Make this hole 8 mm wide._

**4. Select an edge and comment on it.**

- Click **Select** in the toolbar (or press `V`). Move the mouse over the part: vertices, edges and faces light up. Click the **top edge along the far end of the plate** (the end away from the tall wall).
- Right-click → **Add to marker ▸ New marker**. A second marker (new colour) now holds that edge.
- Click **+ Comment** and write: _Round this edge, 5 mm._

Tip: **Smart fill** (`F`) paints a whole face in one click.

**5. Send it.** Click **Send to AI**. Your agent now reads your comments and changes the part. This can take a few minutes. You can watch what it does in your agent's window.

**6. Look at the new version.** When the agent is done, Third Wheel shows `bracket_v2.step`. Check:

- Your two markers **moved over** onto the new version. Because the AI changed exactly the spots you marked, they get a badge. That's expected:
- The hole marker may show **⚠ Changed** (the hole got bigger). Check where it landed, then click **✓ Looks right**.
- The edge marker shows **✕ Lost**: the sharp edge is now a rounded face, so the old edge is gone. Dots show where it was, and its comment is kept. Click **✕ Dismiss**.
- Each comment has an **answer from the AI** in its thread.
- **Versions ▾ → Compare with previous version** shows what changed between the two versions.

**7. Confirm or reopen.** For each comment the AI says it fixed: if it's right, click **✓ Confirm**. If not, click
**Reopen**, click the comment card, write why in the **Reply…** box at its bottom, and **Send to AI** again.

That's the whole loop. 🎉

**Optional: let the AI build a part from scratch.**

Use Third Wheel with an AI and CAD to build a real part!

Your agent needs to be able to make CAD for this (usually with FreeCAD, Fusion, CadQuery or build123d). If it can't, that's useful to know too: tell me which agent and model.

**More to try if you like:** open one of your own STEP files (**Open…**), or an STL / 3MF from your slicer (paint and comments only: a mesh has no faces or edges to select).

## 4. What doesn't work yet

- **ChatGPT (app or website):** it can't reach programs on your computer. OpenAI's **Codex** can.
- **Ollama on its own** and other chat apps without "MCP" tool support. Local models work only through an agent app that supports MCP (LM Studio, Cline, Continue, Goose), and small models often lose track of the review loop.
- **Agents other than Claude Code are untested.** Codex, Gemini CLI, Cursor and VS Code are set up from their docs. If yours fails, what it printed is the most useful thing you can send me.
- **Some agents don't see pictures.** The AI still gets every comment and marked face as text, so it should work.

**Known issues** (no need to report these):

- **Saving a new version over the old file** loses the comparison: the app keeps no copies. Always use a new name (`bracket_v2.step`, `bracket_v3.step` …). The prompt above asks the AI to do that.
- **No "Close" menu item** yet. To get back to the start page, quit and restart Third Wheel. **Open…** works any time.
- **After many versions**, painted spots can get a bit ragged at the edges. Paint over them again if needed.
- **Very large or detailed parts** can make a big brush stutter, freeze the app for a second when a new version opens, and freeze it for 5–15 seconds when you turn on **Compare**.
- **Compare works between STEP files only.** It is greyed out between an STL / 3MF and a STEP version.

## 5. Tell me what happened

Send me a message: anything is welcome, good or bad. Short is fine. Most useful:

1. **What you tried** and **what happened** (and what you expected instead).
2. **Your computer:** Mac or Windows, and its version.
3. **Your AI agent and model**, e.g. "Codex, GPT-5" or "Claude Code, Opus".
4. **A screenshot** of the app or the agent window when something looked wrong. Mac: Shift-Cmd-4. Windows: Win+Shift+S.
5. **If your markers or comments looked wrong** (missing, in the wrong place): the notes file. It sits next to the part and is called like the part plus `.thirdwheel.json`, e.g. `bracket_v2.step.thirdwheel.json`. Please send the `.step` file too, if you can share it.
6. Anything that was **confusing**: a word you didn't understand, a button you couldn't find, a step in this guide that didn't match what you saw.

**If you'd like to think bigger** (all optional, answer any or none, or just tell me what you think in your own words):

- Would you use this on a real part? Why or why not?
- Where would you want this: its own app, inside your AI chat, or talking to the AI inside Third Wheel?
- Who else in your team or lab would need it?

Thank you!
