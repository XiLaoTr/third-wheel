import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLaunchRequest, modelPathFromArgs } from './launch-file.js';

describe('modelPathFromArgs', () => {
  const cwd = resolve('work');

  it('finds a model file among Electron arguments and flags', () => {
    const argv = ['electron', '.', '--user-data-dir=/x/p.step', 'part.STEP', 'other.stl'];
    expect(modelPathFromArgs(argv, cwd)).toBe(resolve(cwd, 'part.STEP'));
  });

  it('keeps an absolute path and takes meshes too', () => {
    const abs = resolve('elsewhere', 'cover.3mf');
    expect(modelPathFromArgs(['third-wheel.exe', abs], cwd)).toBe(abs);
  });

  it('returns nothing without a model file', () => {
    expect(modelPathFromArgs(['electron', '.', 'notes.txt', '--inspect'], cwd)).toBeUndefined();
  });
});

describe('isLaunchRequest', () => {
  it('accepts an empty or string request, rejects anything else', () => {
    expect(isLaunchRequest({})).toBe(true);
    expect(isLaunchRequest({ open: '/a.step' })).toBe(true);
    expect(isLaunchRequest({ open: 3 })).toBe(false);
    expect(isLaunchRequest(null)).toBe(false);
  });
});
