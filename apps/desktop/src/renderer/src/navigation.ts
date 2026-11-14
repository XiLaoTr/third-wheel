/**
 * Viewport navigation styles — mouse/trackpad mappings matching the CAD tools users already know.
 * Pure data (no three.js) so it can be tested and shown in the UI; `viewport.ts` applies it.
 *
 * OrbitControls quirk we rely on: holding Shift/Ctrl/Cmd on a `pan` button orbits instead,
 * and on an `orbit` button pans instead. That gives e.g. Fusion's Shift+middle-drag = orbit for free.
 */

export type NavAction = 'orbit' | 'pan' | 'none';

export type NavigationStyleId = 'fusion' | 'onshape' | 'slicer';

export interface NavigationStyle {
  readonly id: NavigationStyleId;
  readonly label: string;
  /** Drag action per mouse button. The wheel always zooms (to the cursor). */
  readonly mouse: {
    readonly left: NavAction;
    readonly middle: NavAction;
    readonly right: NavAction;
  };
  /** Two-finger swipe on a trackpad (pinch always zooms). Shift swaps orbit ↔ pan. */
  readonly trackpadSwipe: Exclude<NavAction, 'none'>;
  /** Short mouse help (navigation menu tooltip). */
  readonly mouseHelp: string;
  /** Trackpad help (navigation menu tooltip). */
  readonly trackpadHelp: string;
}

export const NAVIGATION_STYLES: readonly NavigationStyle[] = [
  {
    id: 'fusion',
    label: 'Fusion',
    mouse: { left: 'none', middle: 'pan', right: 'none' },
    trackpadSwipe: 'pan',
    mouseHelp: 'Middle-drag pan · Shift+middle-drag orbit · wheel zoom',
    trackpadHelp: 'Trackpad: swipe pan, Shift+swipe orbit, pinch zoom',
  },
  {
    id: 'onshape',
    label: 'Onshape',
    mouse: { left: 'none', middle: 'pan', right: 'orbit' },
    trackpadSwipe: 'orbit',
    mouseHelp: 'Right-drag orbit · middle-drag or Ctrl+right-drag pan · wheel zoom',
    trackpadHelp: 'Trackpad: swipe orbit, Shift+swipe pan, pinch zoom',
  },
  {
    id: 'slicer',
    label: 'Slicer',
    mouse: { left: 'orbit', middle: 'pan', right: 'pan' },
    trackpadSwipe: 'orbit',
    mouseHelp: 'Left-drag orbit · right/middle-drag pan · wheel zoom',
    trackpadHelp: 'Trackpad: swipe orbit, Shift+swipe pan, pinch zoom',
  },
];

export const DEFAULT_NAVIGATION_STYLE: NavigationStyleId = 'fusion';

export function isNavigationStyleId(value: unknown): value is NavigationStyleId {
  return NAVIGATION_STYLES.some((s) => s.id === value);
}

export function getNavigationStyle(id: NavigationStyleId): NavigationStyle {
  const style = NAVIGATION_STYLES.find((s) => s.id === id);
  if (!style) throw new Error(`Unknown navigation style: ${id}`);
  return style;
}

/**
 * True when a left-button drag moves the camera. Tools must then treat a left *click* (no drag)
 * as their action and leave left-drags to navigation (e.g. Slicer style).
 */
export function leftDragNavigates(style: NavigationStyle): boolean {
  return style.mouse.left !== 'none';
}

/** Action for a trackpad two-finger swipe, given Shift. */
export function trackpadSwipeAction(style: NavigationStyle, shiftKey: boolean): 'orbit' | 'pan' {
  if (!shiftKey) return style.trackpadSwipe;
  return style.trackpadSwipe === 'orbit' ? 'pan' : 'orbit';
}

/**
 * Orbit behaviour. `turntable`: turns around a fixed axis (Z, or the new up after a roll) and
 * stops when looking straight down/up. `free`: no stops — the axis follows the picture's up while
 * dragging, so the model can tumble over the top (0 or Iso straightens it). A setting,
 * default turntable.
 */
export type OrbitStyle = 'turntable' | 'free';

export const DEFAULT_ORBIT_STYLE: OrbitStyle = 'turntable';

export const ORBIT_STYLES: readonly { readonly id: OrbitStyle; readonly label: string }[] = [
  { id: 'turntable', label: 'Turntable' },
  { id: 'free', label: 'Free' },
];

export function isOrbitStyle(value: unknown): value is OrbitStyle {
  return value === 'turntable' || value === 'free';
}
