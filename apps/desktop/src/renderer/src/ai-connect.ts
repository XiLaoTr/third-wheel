/**
 * AI status in the status bar + the "Connect an AI agent" pop-up (T7.6; one tab per agent, T14.2).
 * Texts come from `shared/ai-status.ts` / `shared/agents.ts` (tested); this file only wires them
 * to the DOM.
 */
import {
  agentPanel,
  agentResultText,
  isAgentId,
  type AgentId,
  type OtherAgentId,
} from '../../shared/agents.js';
import {
  ago,
  aiStatusView,
  claudeAddCommand,
  mcpJsonSnippet,
  type AiActivity,
  type ConnectResult,
  type McpScope,
  type McpSetup,
} from '../../shared/ai-status.js';

/** The label says "N min ago": refresh it this often. */
const REFRESH_MS = 30_000;

/** The last agent chosen in the pop-up (T14.2). */
const AGENT_KEY = 'connect-agent';

function loadAgent(): AgentId {
  try {
    const v = localStorage.getItem(AGENT_KEY);
    return isAgentId(v) ? v : 'claude';
  } catch {
    return 'claude'; // storage unavailable: start on Claude Code
  }
}

const SCOPE_HINT: Readonly<Record<McpScope, string>> = {
  folder:
    'Run it in your CAD project folder. The Third Wheel tools show up only when Claude Code starts in that folder.',
  user: 'The Third Wheel tools show up in every Claude Code session, in any folder.',
};

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing from index.html`);
  return found;
}

export interface AiConnect {
  /** Open the pop-up (status item, start view link). */
  open(): void;
  /** For tests: the current activity. */
  activity(): AiActivity;
}

export function setupAiConnect(): AiConnect {
  const api = window.thirdWheel;
  const item = el('ai-status');
  const label = el('ai-status-label');
  const dialog = el('connect-dialog') as HTMLDialogElement;
  let activity: AiActivity = { bridge: 'starting' };
  let setup: McpSetup | undefined;
  let scope: McpScope = 'folder';
  let agent: AgentId = loadAgent();
  /** What each agent's button needs (`claude` program …): undefined = still looking, null = not found. */
  const found = new Map<AgentId, string | null>();
  /** The agent whose one-click is running. */
  let connecting: AgentId | undefined;
  /** The last one-click outcome per agent, while the pop-up stays open. */
  const results = new Map<AgentId, ConnectResult>();

  const render = (): void => {
    const view = aiStatusView(activity, Date.now());
    item.dataset['dot'] = view.dot;
    label.textContent = view.label;
    item.title = view.title;
    if (dialog.open) renderDialog();
  };

  const renderDialog = (): void => {
    for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="connect-agent"]'))
      radio.checked = radio.value === agent;
    el('connect-panel-claude').hidden = agent !== 'claude';
    el('connect-panel-agent').hidden = agent === 'claude';
    if (agent !== 'claude') renderAgent(agent);
    el('connect-scope-hint').textContent = SCOPE_HINT[scope];
    el('connect-then').textContent =
      scope === 'folder'
        ? 'Then start Claude Code in that folder and type /mcp: third-wheel should be listed. Ask it to open a STEP file.'
        : 'Then start Claude Code anywhere and type /mcp: third-wheel should be listed. Ask it to open a STEP file.';
    el('connect-command').textContent = setup ? claudeAddCommand(setup, scope) : '…';
    el('connect-json').textContent = setup ? mcpJsonSnippet(setup) : '…';
    const missing = el('connect-missing');
    missing.hidden = !setup || (setup.exists && !setup.temporaryLocation);
    missing.textContent = setup?.temporaryLocation
      ? 'Move Third Wheel to your Applications folder and open it from there first: the setup below points to where the app is now.'
      : setup?.packaged
        ? 'The MCP server is missing from this install. Reinstall the app.'
        : 'The MCP server is not built yet: run pnpm build:mcp in the third-wheel folder first.';
    renderOneClick();
    const last = activity.lastCall;
    el('connect-last').textContent =
      activity.bridge === 'failed' || activity.bridge === 'off'
        ? aiStatusView(activity, Date.now()).title
        : last
          ? `Last AI call: ${last.tool} at ${new Date(last.at).toLocaleTimeString()} (${ago(Date.now() - last.at)}).`
          : 'No AI call yet this session.';
  };

  /** Panel of an agent other than Claude Code (T14.2). */
  const renderAgent = (id: OtherAgentId): void => {
    const view = setup ? agentPanel(id, setup, found.get(id)) : undefined;
    const button = el('connect-agent-button') as HTMLButtonElement;
    el('connect-agent-one-click').hidden = !view?.buttonHint;
    button.hidden = !view?.button;
    const looking = id === 'gemini' && !found.has(id);
    const result = results.get(id);
    button.disabled =
      looking || connecting !== undefined || !setup?.exists || setup.temporaryLocation;
    button.textContent = looking
      ? 'Looking for Gemini CLI…'
      : connecting === id
        ? 'Connecting…'
        : (view?.button ?? '');
    el('connect-agent-hint').textContent = view?.buttonHint ?? '';
    const line = el('connect-agent-result');
    line.hidden = !result;
    if (result) {
      line.dataset['ok'] = String(result.ok);
      line.textContent = agentResultText(id, result);
    }
    el('connect-agent-title').textContent = view?.title ?? '';
    el('connect-agent-text').textContent = view?.text ?? '…';
    el('connect-agent-where').textContent = view?.where ?? '';
  };

  const renderOneClick = (): void => {
    const claude = found.has('claude') ? found.get('claude') : undefined;
    const result = results.get('claude');
    const button = el('connect-claude') as HTMLButtonElement;
    const hint = el('connect-claude-hint');
    const notFound = claude === null;
    button.hidden = notFound;
    button.disabled =
      claude === undefined || connecting !== undefined || !setup?.exists || setup.temporaryLocation;
    button.textContent =
      claude === undefined
        ? 'Looking for Claude Code…'
        : connecting === 'claude'
          ? 'Connecting…'
          : result?.ok
            ? 'Connect again'
            : 'Connect to Claude Code';
    hint.textContent = notFound
      ? 'Claude Code wasn’t found on this computer. Install it (claude.com/claude-code), or use the .mcp.json option below.'
      : 'Adds the Third Wheel tools to Claude Code for all your folders: runs the command below with “All my folders”.';
    el('connect-manual-title').textContent = notFound
      ? 'Claude Code: run this once in a terminal'
      : 'Or run this once in a terminal';
    const line = el('connect-result');
    line.hidden = !result;
    if (!result) return;
    line.dataset['ok'] = String(result.ok);
    line.textContent = result.ok
      ? 'Connected ✓ Start a new Claude Code session (or restart it) and type /mcp: third-wheel should be listed.'
      : result.reason === 'failed'
        ? `Couldn’t connect${result.detail ? `: ${result.detail}` : '.'} Copy the command below and run it in a terminal instead.`
        : result.reason === 'not-found'
          ? 'Claude Code wasn’t found. Use the command or the .mcp.json option below.'
          : 'Move Third Wheel to your Applications folder and open it from there first.';
  };

  // Feedback on the button itself: a notice would sit behind the pop-up's backdrop.
  const copy = (button: HTMLElement, text: string, source: HTMLElement): void => {
    const flash = (label: string): void => {
      button.textContent = label;
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 2000);
    };
    navigator.clipboard.writeText(text).then(
      () => {
        flash('Copied ✓');
      },
      () => {
        // Select the text so Cmd/Ctrl+C works by hand.
        getSelection()?.selectAllChildren(source);
        flash("Couldn't copy");
      },
    );
  };

  dialog.addEventListener('keydown', (e) => {
    e.stopPropagation(); // tool shortcuts must not fire behind it
  });
  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="connect-agent"]'))
    radio.addEventListener('change', () => {
      if (!radio.checked || !isAgentId(radio.value)) return;
      agent = radio.value;
      try {
        localStorage.setItem(AGENT_KEY, agent);
      } catch {
        // Not remembered.
      }
      renderDialog();
    });
  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="connect-scope"]'))
    radio.addEventListener('change', () => {
      if (radio.checked) scope = radio.value === 'user' ? 'user' : 'folder';
      renderDialog();
    });
  const copyCommand = el('connect-copy-command');
  copyCommand.addEventListener('click', () => {
    if (setup) copy(copyCommand, claudeAddCommand(setup, scope), el('connect-command'));
  });
  const copyJson = el('connect-copy-json');
  copyJson.addEventListener('click', () => {
    if (setup) copy(copyJson, mcpJsonSnippet(setup), el('connect-json'));
  });

  const copyAgent = el('connect-copy-agent');
  copyAgent.addEventListener('click', () => {
    if (setup && agent !== 'claude')
      copy(copyAgent, agentPanel(agent, setup, found.get(agent)).text, el('connect-agent-text'));
  });

  const connect = (id: AgentId): void => {
    if (!api || connecting) return;
    connecting = id;
    results.delete(id);
    renderDialog();
    void api
      .connectAgent(id)
      .catch((e: unknown): ConnectResult => ({ ok: false, reason: 'failed', detail: String(e) }))
      .then((r) => {
        connecting = undefined;
        results.set(id, r);
        if (r.ok && (id === 'claude' || id === 'gemini')) found.set(id, r.path);
        else if (!r.ok && r.reason === 'not-found' && (id === 'claude' || id === 'gemini'))
          found.set(id, null);
        renderDialog();
      });
  };
  el('connect-claude').addEventListener('click', () => {
    connect('claude');
  });
  el('connect-agent-button').addEventListener('click', () => {
    connect(agent);
  });

  const open = (): void => {
    if (!dialog.open) results.clear();
    renderDialog();
    if (!dialog.open) dialog.showModal();
    for (const id of ['claude', 'gemini', 'codex'] as const)
      void api?.findAgent(id).then((path) => {
        found.set(id, path);
        renderDialog();
      });
    // Ask again each time: the server may have been built since.
    void api?.getMcpSetup().then((s) => {
      setup = s;
      renderDialog();
    });
  };
  item.addEventListener('click', open);

  if (api) {
    api.onAiActivity((a) => {
      activity = a;
      render();
    });
    void api.getAiActivity().then((a) => {
      activity = a;
      render();
    });
  }
  render();
  window.setInterval(render, REFRESH_MS);

  return { open, activity: () => activity };
}
