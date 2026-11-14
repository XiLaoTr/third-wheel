# Third Wheel user guide

Back to the [README](../README.md). Shortcuts below say Cmd (Mac) / Ctrl (Windows).

## Connect Claude Code

The app comes with an **MCP server**: the small program your AI agent uses to talk to the app. Set it up once; after
that, Claude Code starts it by itself and it finds the open app. Click **AI: ready** (bottom left) or **Connect an AI
agent…** on the start page.

**The button: Connect to Claude Code.** One click adds Third Wheel to Claude Code for all your folders (it runs the
`claude mcp add --scope user …` command below for you, replacing an older Third Wheel entry). It finds Claude Code
installed for the terminal and the copy inside the Claude Code extension for VS Code / Cursor. Then start a **new**
Claude Code session (or restart it). Mac: move Third Wheel to **Applications** first — the setup points to where the
app is, and a copy opened from the downloaded `.dmg` disappears when it is closed.

The installed app runs its MCP server itself: you don't need Node.js. Built from source, the server runs with `node`.

If the button isn't there (Claude Code wasn't found) or you want the tools in one folder only, the pop-up also shows the
two options below with the paths of your copy filled in, each with **Copy**.

**Option 1: one command in a terminal** (needs the `claude` command in your terminal). For the installed Mac app:

```sh
claude mcp add third-wheel --env ELECTRON_RUN_AS_NODE=1 -- "/Applications/Third Wheel.app/Contents/MacOS/Third Wheel" "/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js"
```

Built from source it is `claude mcp add third-wheel -- node "/path/to/third-wheel/packages/mcp-server/build/third-wheel-mcp.js"`.
Run it in your CAD project folder: the tools then show up when Claude Code starts in that folder. To have them in every
folder, pick **All my folders** in the pop-up (adds `--scope user`). Keep the quotes around the paths.

**Option 2: a `.mcp.json` file**, if the terminal says "claude: command not found" or "is not recognized" (for example,
you use Claude Code only inside VS Code). Put a file named `.mcp.json` in your CAD project folder, e.g. for the
installed Windows app:

```json
{
  "mcpServers": {
    "third-wheel": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\Third Wheel\\Third Wheel.exe",
      "args": [
        "C:\\Users\\you\\AppData\\Local\\Programs\\Third Wheel\\resources\\mcp\\third-wheel-mcp.js"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Copy it from the pop-up rather than typing it: on Windows every `\` in the path must be written `\\`, and the pop-up does
that. Finder and Windows Explorer refuse names that start with a dot: create the file in VS Code (New File → `.mcp.json`)
or in a terminal.

**Check:** start Claude Code in that folder and type `/mcp`: `third-wheel` should be listed. The status dot in the app
turns green when the agent calls it.

## Other AI agents

Third Wheel's MCP server is a standard local MCP server, so any agent app that can start one can use it. The formats
below follow each tool's own docs as of **2026-11-11**. **Not tested yet** with any tool except Claude Code: if one
doesn't work for you, please tell us what it printed.

**Not supported:**

- **ChatGPT (app or website)** can only reach MCP servers on the internet, not a program on your computer.
  (OpenAI's **Codex** can: see below.)
- **Local models** work only through an agent app that supports MCP: LM Studio, Cline, Continue or Goose. Ollama alone
  has no MCP. Small models often lose track of the review loop (open → wait → read → edit → answer each comment); use
  the largest model your computer runs well.

**Easiest: the app's Connect pop-up.** Click **AI: ready** (bottom left) or **Connect an AI agent…** on the start
page and pick your agent: Claude Code, Codex, Gemini CLI, Cursor, VS Code or Other. Each tab shows the setup with the
paths of your copy filled in, ready to copy, and most have a button that does it for you: **Add to Codex** writes the
entry below into `~/.codex/config.toml` (the old file is kept as `config.toml.bak`), **Connect to Gemini CLI** runs
the `gemini mcp add` command, **Add to Cursor** / **Install in VS Code** open that app, which asks you to confirm. The
sections below say the same by hand.

**The two paths you need.** Every setup below starts the app's own program with `ELECTRON_RUN_AS_NODE=1` and gives it
the server file. For the installed app they are:

|         | Program (`command`)                                               | Server file (first `args` entry)                                                   |
| ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| macOS   | `/Applications/Third Wheel.app/Contents/MacOS/Third Wheel`        | `/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js`          |
| Windows | `C:\Users\you\AppData\Local\Programs\Third Wheel\Third Wheel.exe` | `C:\Users\you\AppData\Local\Programs\Third Wheel\resources\mcp\third-wheel-mcp.js` |

On Windows, replace `you` with your user name, or copy the setup from the app's Connect pop-up (see above), which has
the paths of your copy filled in. Mac: move the app to
**Applications** first. Built from source, the program is `node` and the server file is
`packages/mcp-server/build/third-wheel-mcp.js` in your third-wheel folder; leave out `ELECTRON_RUN_AS_NODE`.

### Codex (OpenAI: CLI, IDE extension, desktop app)

The three share one settings file, `~/.codex/config.toml` (Windows: `C:\Users\you\.codex\config.toml`). Add this to it
(create the file if it isn't there):

```toml
[mcp_servers.third-wheel]
command = "/Applications/Third Wheel.app/Contents/MacOS/Third Wheel"
args = ["/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js"]
tool_timeout_sec = 600

[mcp_servers.third-wheel.env]
ELECTRON_RUN_AS_NODE = "1"
```

On Windows, put the paths in **single** quotes so the `\` stay as they are:
`command = 'C:\Users\you\AppData\Local\Programs\Third Wheel\Third Wheel.exe'` and
`args = ['C:\Users\you\AppData\Local\Programs\Third Wheel\resources\mcp\third-wheel-mcp.js']`.

**`tool_timeout_sec = 600` matters:** Codex stops a tool after 60 seconds by default, but waiting for your review and
opening a big file take longer. The command `codex mcp add third-wheel --env ELECTRON_RUN_AS_NODE=1 -- "<program>"
"<server file>"` adds the same entry without that line, so add it to the file afterwards.

**Check:** `codex mcp list` in a terminal, or `/mcp` inside Codex.

### Gemini CLI

One command in a terminal (adds it for all your folders; leave out `-s user` for the current folder only):

```sh
gemini mcp add -s user -e ELECTRON_RUN_AS_NODE=1 third-wheel "/Applications/Third Wheel.app/Contents/MacOS/Third Wheel" "/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js"
```

On Windows, use the two Windows paths from the table (normal `\`, keep the quotes). Or edit `~/.gemini/settings.json`
(all folders) or `.gemini/settings.json` in your project folder: add the `third-wheel` entry from the
[JSON below](#cursor-cline-lm-studio) under its `"mcpServers"`. **Check:** `/mcp` inside Gemini CLI.

### Cursor, Cline, LM Studio

They use the same JSON as Claude Code's `.mcp.json`. On Windows, copy it from the Connect pop-up: there every `\` must
be written `\\`. For the Mac app:

```json
{
  "mcpServers": {
    "third-wheel": {
      "command": "/Applications/Third Wheel.app/Contents/MacOS/Third Wheel",
      "args": ["/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Where it goes:

- **Cursor:** `~/.cursor/mcp.json` (Windows: `C:\Users\you\.cursor\mcp.json`) for all folders, or `.cursor/mcp.json`
  in your project folder. Check in Cursor Settings → MCP.
- **Cline** (VS Code extension): click the MCP Servers icon in Cline → **Configure** → **Configure MCP Servers**. That
  opens its settings file. Paste the `"third-wheel": { … }` part inside its `"mcpServers"`.
- **LM Studio** (0.3.17 or newer): **Program** tab on the right → **Install** → **Edit mcp.json**. Paste the
  `"third-wheel": { … }` part inside its `"mcpServers"`. Pick a model that supports tool use.

### VS Code (GitHub Copilot)

Copilot reads a workspace-root `.mcp.json` (the same file name Claude Code uses) or, for all folders,
`~/.copilot/mcp-config.json` (Windows: `C:\Users\you\.copilot\mcp-config.json`). Its format needs two extra lines,
`"type"` and `"tools"`:

```json
{
  "mcpServers": {
    "third-wheel": {
      "type": "stdio",
      "command": "/Applications/Third Wheel.app/Contents/MacOS/Third Wheel",
      "args": ["/Applications/Third Wheel.app/Contents/Resources/mcp/third-wheel-mcp.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" },
      "tools": ["*"]
    }
  }
}
```

Older VS Code versions read `.vscode/mcp.json` instead. That file uses `"servers"` in place of `"mcpServers"` and has
no `"tools"` line (VS Code drops that format in February 2027). Or run **MCP: Add Server** from the Command Palette
(Cmd/Ctrl+Shift+P), choose **Command (stdio)** and fill in the program, server file and `ELECTRON_RUN_AS_NODE=1`. VS Code
asks you to trust the server the first time it starts.

### Differences you may notice

- **Pictures:** `render_region` sends small pictures of the marked area. Some apps don't pass them to the model, or the
  model can't see images. The AI still gets every comment, marker and face as text; the pictures are optional.
- **Time limits:** `wait_for_review` gives up after about 2 minutes and answers "waiting", and the AI calls it again.
  An app that stops tool calls sooner (Codex by default, see above) can break this: raise its time limit. Cline may
  have a per-server time limit too (not checked yet): if its MCP settings show one for third-wheel, set it to the
  longest.

## Tools

- **Open…** (Cmd+O) a `.step` / `.stp` file, or let the AI open it.
- **Select** (V): hover highlights vertices, edges and faces; click to select, double-click for the whole body, drag a box
  to select many. Right-click → add the selection to a marker.
- **Brush** (B): paint a marker on the surface. **Smart fill** (F): fill a whole face or a smooth area in one click.
  Hold **Shift** to erase. `[` and `]` change the brush size.
- **Markers** (right panel) are named colours; **+ Comment** writes a comment about the active marker.
- **Send to AI**: when the AI asked for a review (rainbow banner), this sends your comments to it. Otherwise it copies a
  short message to paste into the AI chat.
- The AI answers in each comment's thread. When it says something is fixed, you **Confirm** or **Reopen**.
- Press `?` for all keyboard shortcuts. Mouse buttons (Fusion, Onshape or Slicer style) are set in the status bar.

**STL and 3MF** open in mesh-only mode: paint and comments work, selecting faces or edges doesn't (a mesh has none).
OpenSCAD exports meshes only, so its parts open this way. Open the STEP version later and your paint is moved onto it.

## Versions

Export each CAD revision under a **new file name** (`part.step` → `part_v2.step` → `part_v3.step`), never over the old one:
the app keeps no copies, so an overwritten version can't be compared.

- **You:** open the old version, then **Versions ▾ → Import new version…** (Cmd+I) and pick the new file. Your markers and
  comments move over; markers on geometry that changed are flagged ⚠ Changed or Lost. Versions ▾ also lists earlier
  versions, and **Compare** shows what changed. If the new file already has notes of its own, you're asked whether to
  **keep** them or **replace** them with the old version's (the replaced ones go to a `….bak.json` backup).
- **The AI:** calls `load_model` with the new file and `revisionOf` = the old version; same result. Its instructions tell
  it to use new file names.
- **Wrong file imported?** In **Versions ▾**, point at that version and pick **Remove from versions…**. The file and
  its notes stay on disk; the versions on either side of it are linked to each other, and Third Wheel stops suggesting
  that file as a version until you import it again. Each file has one earlier version: if you import a file that is
  already linked to another one, Third Wheel asks which one is right.

Notes are saved next to the model as `<model>.thirdwheel.json`. The AI doesn't need that file: it reads your notes
through the app.

## Two-part fit check

Do two printed parts fit together? Example: a lid that clips onto a box. Ask the AI:
_"Check how `lid.step` fits on `box.step`."_ It opens both and asks for one review. The banner has
a button per part: switch between them and paint the matching areas on each (the clip and its slot, the mating faces),
with a comment like "these must slide together". One **Send to AI** answers for both. The AI lines the parts up,
compares the faces you marked, reports the gap per feature (walls, radii, depth) and what that means for FDM / resin /
machining, and asks before changing anything.

## Troubleshooting

- **The AI says the app isn't running** — start Third Wheel and keep it open; the agent can't start it for you.
- **"claude: command not found"** — use the `.mcp.json` option above.
- **Another agent (Codex, Cursor …) says a tool timed out** — raise its tool time limit: see
  [Other AI agents](#other-ai-agents).
- **Moved or reinstalled the app somewhere else** — click **Connect to Claude Code** again (or copy the command again):
  the setup points to where the app was.
- **The first start shows a security warning** — expected for now: see the [README](../README.md#download).
- **Starting the app a second time** brings the open window to the front: it runs once at a time.
- Building from source went wrong → [Development: if something goes wrong](development.md#if-something-goes-wrong).
