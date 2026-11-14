import { describe, expect, it } from 'vitest';
import { isThemeMode, resolveTheme } from './theme.js';

describe('theme', () => {
  it('resolves system mode from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('explicit modes ignore the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('validates stored values', () => {
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('blue')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });
});
