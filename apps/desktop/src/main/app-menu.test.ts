import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate, type AppMenuOptions } from './app-menu.js';
import { ABOUT_MENU_ID } from '../shared/about.js';
import type { MenuCommand } from '../shared/menu-commands.js';

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return Array.isArray(item?.submenu) ? item.submenu : [];
}

/** Each item as "label/role [accelerator]", separators as "-". */
function outline(menu: MenuItemConstructorOptions[]): Record<string, string[]> {
  return Object.fromEntries(
    menu.map((top) => [
      top.label ?? top.role ?? '?',
      submenu(top).map((i) =>
        i.type === 'separator'
          ? '-'
          : `${i.label ?? i.role ?? '?'}${i.accelerator ? ` [${i.accelerator}]` : ''}`,
      ),
    ]),
  );
}

function template(platform: NodeJS.Platform, dev = false) {
  const commands: MenuCommand[] = [];
  let about = 0;
  const opts: AppMenuOptions = {
    platform,
    dev,
    onAbout: () => about++,
    onCommand: (c) => commands.push(c),
  };
  return { menu: appMenuTemplate(opts), commands, about: () => about };
}

function clickAll(menu: MenuItemConstructorOptions[]): void {
  for (const top of menu) {
    for (const item of submenu(top)) (item.click as (() => void) | undefined)?.();
  }
}

describe('appMenuTemplate', () => {
  it('macOS: the small menu, nothing of Electron’s default left', () => {
    const { menu, commands, about } = template('darwin');
    expect(outline(menu)).toEqual({
      'Third Wheel': ['About Third Wheel', '-', 'hide', '-', 'quit'],
      File: ['Open… [CmdOrCtrl+O]', 'Import new version… [CmdOrCtrl+I]'],
      Edit: ['Undo [CmdOrCtrl+Z]', 'Redo [Shift+Cmd+Z]', '-', 'cut', 'copy', 'paste', 'selectAll'],
      windowMenu: ['minimize', 'zoom'],
      help: ['Keyboard shortcuts', 'Connect an AI agent…'],
    });
    expect(submenu(menu[0])[0]?.id).toBe(ABOUT_MENU_ID);
    // macOS: the menu takes the keys (the window drops a second copy of one press).
    expect(JSON.stringify(menu)).not.toContain('registerAccelerator');
    clickAll(menu);
    expect(commands).toEqual(['open', 'import', 'undo', 'redo', 'shortcuts', 'connect']);
    expect(about()).toBe(1);
  });

  it('Windows: File … Exit, Help … About; accelerators shown, keys left to the page', () => {
    const { menu, commands, about } = template('win32');
    expect(outline(menu)).toEqual({
      '&File': ['Open… [CmdOrCtrl+O]', 'Import new version… [CmdOrCtrl+I]', '-', 'Exit'],
      '&Edit': ['Undo [CmdOrCtrl+Z]', 'Redo [Ctrl+Y]', '-', 'cut', 'copy', 'paste', 'selectAll'],
      '&Help': ['Keyboard shortcuts', 'Connect an AI agent…', '-', 'About Third Wheel'],
    });
    expect(submenu(menu[0]).find((i) => i.label === 'Exit')?.role).toBe('quit');
    for (const top of menu) {
      for (const item of submenu(top)) {
        if (item.accelerator) expect(item.registerAccelerator).toBe(false);
      }
    }
    expect(submenu(menu.at(-1)).at(-1)?.id).toBe(ABOUT_MENU_ID);
    clickAll(menu);
    expect(commands).toEqual(['open', 'import', 'undo', 'redo', 'shortcuts', 'connect']);
    expect(about()).toBe(1);
  });

  it('dev builds only: Developer menu with Reload and Developer Tools', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const json = (dev: boolean) => JSON.stringify(template(platform, dev).menu);
      expect(json(false)).not.toMatch(/reload|toggleDevTools|viewMenu|Developer/i);
      expect(outline(template(platform, true).menu)['Developer']).toEqual([
        'reload',
        'forceReload',
        'toggleDevTools',
      ]);
    }
  });
});
