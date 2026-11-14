/** Theme handling shared by main, preload and renderer. Pure — no DOM/Electron imports. */

/** What the user picked. `system` follows the OS appearance. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** What is actually rendered. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}
