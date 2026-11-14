import { sidecarFileName as coreName } from '@third-wheel/core';
import { describe, expect, it } from 'vitest';
import { sidecarBackupName, sidecarFileName } from './sidecar-path.js';

describe('sidecar paths', () => {
  it('matches the core rule', () => {
    expect(sidecarFileName('a b.step')).toBe(coreName('a b.step'));
  });
  it('stamps backups with the local time', () => {
    expect(sidecarBackupName('part.step', new Date(2026, 10, 8, 14, 5, 9))).toBe(
      'part.step.thirdwheel.2026-11-08-140509.bak.json',
    );
  });
});
