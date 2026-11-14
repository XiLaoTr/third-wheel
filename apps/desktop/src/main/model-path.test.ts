import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalModelPath } from './model-path.js';

describe('canonicalModelPath', () => {
  it('resolves a symlinked folder to the real one', async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'tw-path-')));
    writeFileSync(join(dir, 'a.step'), 'x');
    const link = join(dir, 'link');
    try {
      symlinkSync(dir, link, 'junction');
    } catch {
      return; // no symlink rights (Windows without developer mode)
    }
    expect(await canonicalModelPath(join(link, 'a.step'))).toBe(join(dir, 'a.step'));
  });

  it('keeps a mapped drive letter instead of the network path', async () => {
    const p = await canonicalModelPath('Z:\\parts\\a.step', () =>
      Promise.resolve('\\\\host\\share\\parts\\a.step'),
    );
    expect(p).toBe('Z:\\parts\\a.step');
  });

  it('takes the on-disk letter case', async () => {
    const p = await canonicalModelPath('c:\\parts\\A.STEP', () =>
      Promise.resolve('C:\\Parts\\a.step'),
    );
    expect(p).toBe('C:\\Parts\\a.step');
  });

  it('falls back to the given path when it cannot be resolved', async () => {
    expect(await canonicalModelPath('/no/such/file.step')).toBe('/no/such/file.step');
  });
});
