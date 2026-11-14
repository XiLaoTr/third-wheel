import { describe, expect, it } from 'vitest';
import { fitAfterMove, fitBounds } from './window-fit.js';

const screen = { x: 0, y: 25, width: 1280, height: 775 };

describe('fitBounds', () => {
  it('leaves a fitting window alone', () => {
    expect(fitBounds({ x: 100, y: 100, width: 1000, height: 600 }, screen)).toBeUndefined();
  });

  it('shrinks a window larger than the screen', () => {
    expect(fitBounds({ x: 0, y: 25, width: 1440, height: 900 }, screen)).toEqual(screen);
  });

  it('moves a window that sticks out back inside', () => {
    expect(fitBounds({ x: 800, y: 500, width: 1000, height: 600 }, screen)).toEqual({
      x: 280,
      y: 200,
      width: 1000,
      height: 600,
    });
  });

  it('works on a secondary display with an offset origin', () => {
    const second = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(fitBounds({ x: -2000, y: 0, width: 2560, height: 1440 }, second)).toEqual(second);
  });
});

describe('fitAfterMove', () => {
  it('lets a fitting window straddle two displays (drag to a second screen)', () => {
    expect(fitAfterMove({ x: 900, y: 100, width: 1000, height: 600 }, screen)).toBeUndefined();
  });

  it('shrinks a window larger than the display it moved to', () => {
    expect(fitAfterMove({ x: 0, y: 25, width: 1440, height: 900 }, screen)).toEqual(screen);
  });
});
