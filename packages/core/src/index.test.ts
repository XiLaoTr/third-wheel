import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, sidecarFileName } from './index.js';

describe('@third-wheel/core', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@third-wheel/core');
  });

  it('derives the sidecar file name next to the model', () => {
    expect(sidecarFileName('bracket.step')).toBe('bracket.step.thirdwheel.json');
  });
});
