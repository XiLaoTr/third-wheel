/**
 * App menu commands (T13.2): menu items the window carries out with its own code (the same as
 * its buttons and keys). Main sends one of these over `IPC.menuCommand`.
 */
export const MENU_COMMANDS = ['open', 'import', 'undo', 'redo', 'shortcuts', 'connect'] as const;
export type MenuCommand = (typeof MENU_COMMANDS)[number];

export function isMenuCommand(x: unknown): x is MenuCommand {
  return typeof x === 'string' && (MENU_COMMANDS as readonly string[]).includes(x);
}

/** Menu item ids (tests find items by them). */
export const MENU_IDS: Readonly<Record<MenuCommand, string>> = {
  open: 'menu-open',
  import: 'menu-import',
  undo: 'menu-undo',
  redo: 'menu-redo',
  shortcuts: 'menu-shortcuts',
  connect: 'menu-connect',
};

/** One key press reaching both the page and the menu counts once if they are this close (ms). */
export const SAME_PRESS_MS = 300;

/**
 * Menu accelerators may fire before (or instead of) the page's keydown — on macOS the menu
 * takes Cmd+O / Cmd+Z, on Windows the page does. When one press arrives from both sides, only
 * the first runs. Repeats from the same side (holding Cmd+Z) are never dropped.
 */
export class ShortcutOnce {
  private readonly last = new Map<string, { source: 'key' | 'menu'; at: number }>();

  /** True when this command should run now. `key` = from the page's keydown. */
  take(command: MenuCommand, source: 'key' | 'menu', now: number): boolean {
    const prev = this.last.get(command);
    if (prev && prev.source !== source && now - prev.at < SAME_PRESS_MS) {
      this.last.delete(command); // the pair is used up; the next press counts again
      return false;
    }
    this.last.set(command, { source, at: now });
    return true;
  }
}
