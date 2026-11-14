/** Keeps a window inside the usable area of its display. Pure (no Electron imports) for testing. */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Returns `bounds` shrunk to fit `workArea` and moved fully inside it, or `undefined` if it
 * already fits (so callers only touch the window when needed).
 */
export function fitBounds(bounds: Rect, workArea: Rect): Rect | undefined {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  if (x === bounds.x && y === bounds.y && width === bounds.width && height === bounds.height) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * After the user moved the window: only fix a window that is larger than the display it is now
 * mostly on (then shrink + move it inside). A window that fits in size is left where the user
 * put it — even straddling two displays — so it can be dragged across screens.
 */
export function fitAfterMove(bounds: Rect, workArea: Rect): Rect | undefined {
  if (bounds.width <= workArea.width && bounds.height <= workArea.height) return undefined;
  return fitBounds(bounds, workArea);
}
