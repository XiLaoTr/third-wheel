import { describe, expect, it } from 'vitest';
import { looksLikeTrackpad, WheelClassifier, type WheelSample } from './wheel.js';

const ev = (over: Partial<WheelSample>): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  shiftKey: false,
  timeStamp: 0,
  ...over,
});

describe('looksLikeTrackpad', () => {
  it('line-mode deltas are a mouse', () => {
    expect(looksLikeTrackpad(ev({ deltaY: 3, deltaMode: 1 }), false)).toBe(false);
  });

  it('horizontal motion is a trackpad, unless Shift (mouse horizontal scroll)', () => {
    expect(looksLikeTrackpad(ev({ deltaX: 2, deltaY: 5 }), false)).toBe(true);
    expect(looksLikeTrackpad(ev({ deltaX: 100, shiftKey: true }), false)).toBe(false);
  });

  it('Windows: 120-multiple wheelDelta is a mouse notch, anything else a touchpad', () => {
    expect(looksLikeTrackpad(ev({ deltaY: 100, wheelDeltaY: -120 }), false)).toBe(false);
    expect(looksLikeTrackpad(ev({ deltaY: 7, wheelDeltaY: -8 }), false)).toBe(true);
  });

  it('macOS: wheelDeltaY === -3 × deltaY is a trackpad', () => {
    expect(looksLikeTrackpad(ev({ deltaY: 4, wheelDeltaY: -12 }), true)).toBe(true);
    expect(looksLikeTrackpad(ev({ deltaY: 4.000244140625, wheelDeltaY: -120 }), true)).toBe(false);
  });
});

describe('WheelClassifier', () => {
  it('keeps a stream as trackpad once evidence appears, resets after a pause', () => {
    const c = new WheelClassifier(false, 250);
    expect(c.classify(ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 0 }))).toBe('mouse');
    expect(c.classify(ev({ deltaX: 1, deltaY: 3, timeStamp: 16 }))).toBe('trackpad');
    // Same stream: an ambiguous event does not flip it back.
    expect(c.classify(ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 32 }))).toBe('trackpad');
    // After a pause a new stream starts.
    expect(c.classify(ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1000 }))).toBe('mouse');
  });
});
