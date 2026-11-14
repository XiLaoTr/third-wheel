import { describe, expect, it } from 'vitest';
import { FrameRecorder, summarizeFrames } from './perf.js';

describe('summarizeFrames', () => {
  it('handles no frames', () => {
    expect(summarizeFrames([]).frames).toBe(0);
  });

  it('computes avg, p95, max and slow frames', () => {
    const s = summarizeFrames([...Array<number>(19).fill(10), 30]);
    expect(s.frames).toBe(20);
    expect(s.avgMs).toBeCloseTo(11);
    expect(s.p95Ms).toBe(10);
    expect(s.maxMs).toBe(30);
    expect(s.slowFrames).toBe(1);
  });
});

describe('FrameRecorder', () => {
  it('records intervals and skips idle gaps', () => {
    const r = new FrameRecorder();
    for (const t of [0, 16, 33, 500, 516]) r.frame(t, 2);
    expect(r.intervals).toEqual([16, 17, 16]);
    expect(r.cpu).toHaveLength(5);
  });
});
