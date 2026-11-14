import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from './autosave.js';

function setup(fail = false) {
  const writes: string[] = [];
  let n = 0;
  const io = {
    write: vi.fn((path: string, text: string) => {
      writes.push(`${path}:${text}`);
      return Promise.resolve(
        fail ? { ok: false as const, error: 'disk full' } : { ok: true as const },
      );
    }),
    writeSync: vi.fn((path: string, text: string) => {
      writes.push(`sync ${path}:${text}`);
      return { ok: true as const };
    }),
  };
  const save = new Autosave(io, 1000);
  save.setTarget({ modelPath: 'a.step', build: () => String(++n) });
  return { save, writes, io };
}

describe('Autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once, a second after the last change', async () => {
    const { save, writes } = setup();
    save.changed();
    await vi.advanceTimersByTimeAsync(600);
    save.changed();
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual(['a.step:1']);
    expect(save.pending).toBe(false);
  });

  it('writes nothing without a change or a target', async () => {
    const { save, writes } = setup();
    save.flushSync();
    await save.flush();
    save.setTarget(undefined);
    save.changed();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
  });

  it('flushSync writes at once and cancels the timer', async () => {
    const { save, writes } = setup();
    save.changed();
    save.flushSync();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual(['sync a.step:1']);
  });

  it('reports pending → saving → saved for the indicator', async () => {
    const { save } = setup();
    const states: string[] = [];
    save.onState = (s) => states.push(s);
    save.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual(['pending', 'saving', 'saved']);
  });

  it('a failed write stays pending and reports the error', async () => {
    const { save } = setup(true);
    const errors: (string | undefined)[] = [];
    save.onSaved = (e) => errors.push(e);
    save.changed();
    await save.flush();
    expect(errors).toEqual(['disk full']);
    expect(save.pending).toBe(true);
  });
});
