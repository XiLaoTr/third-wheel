import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAVIGATION_STYLE,
  DEFAULT_ORBIT_STYLE,
  isOrbitStyle,
  ORBIT_STYLES,
  getNavigationStyle,
  isNavigationStyleId,
  leftDragNavigates,
  NAVIGATION_STYLES,
  trackpadSwipeAction,
} from './navigation.js';

describe('navigation styles', () => {
  it('has unique ids and a valid default', () => {
    const ids = NAVIGATION_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isNavigationStyleId(DEFAULT_NAVIGATION_STYLE)).toBe(true);
    expect(isNavigationStyleId('blender')).toBe(false);
  });

  it('every style can orbit and pan with the mouse (directly or via a modifier)', () => {
    for (const s of NAVIGATION_STYLES) {
      const actions = Object.values(s.mouse);
      expect(
        actions.some((a) => a !== 'none'),
        s.id,
      ).toBe(true);
    }
  });

  it('Fusion: middle pans, left/right are free', () => {
    const s = getNavigationStyle('fusion');
    expect(s.mouse).toEqual({ left: 'none', middle: 'pan', right: 'none' });
    expect(leftDragNavigates(s)).toBe(false);
  });

  it('Slicer: left orbits, right and middle pan', () => {
    const s = getNavigationStyle('slicer');
    expect(s.mouse).toEqual({ left: 'orbit', middle: 'pan', right: 'pan' });
    expect(leftDragNavigates(s)).toBe(true);
  });

  it('Shift swaps the trackpad swipe action', () => {
    const fusion = getNavigationStyle('fusion');
    expect(trackpadSwipeAction(fusion, false)).toBe('pan');
    expect(trackpadSwipeAction(fusion, true)).toBe('orbit');
    const slicer = getNavigationStyle('slicer');
    expect(trackpadSwipeAction(slicer, false)).toBe('orbit');
    expect(trackpadSwipeAction(slicer, true)).toBe('pan');
  });
});

describe('orbit styles', () => {
  it('defaults to turntable and validates ids', () => {
    expect(DEFAULT_ORBIT_STYLE).toBe('turntable');
    expect(ORBIT_STYLES.map((s) => s.id)).toEqual(['turntable', 'free']);
    expect(isOrbitStyle('free')).toBe(true);
    expect(isOrbitStyle('trackball')).toBe(false);
  });
});
