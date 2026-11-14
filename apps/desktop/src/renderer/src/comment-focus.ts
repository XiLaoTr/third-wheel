/**
 * Focused comment look (T4.2): the comment's markers keep their own
 * colour at full strength (shown even when hidden), every other marker's paint and entities fade
 * toward the face colour. Pure — the viewport applies it to what it draws.
 */
import type { MarkerStyle } from './paint-overlay.js';
import type { ShownEntity } from './markers.js';

/** How far other markers fade toward the face colour (0 = not at all, 1 = gone). */
export const FOCUS_FADE = 0.7;

/** 0xrrggbb mixed toward `to` by `t`. */
export function mixColor(from: number, to: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    out |= Math.round(a + (b - a) * t) << shift;
  }
  return out;
}

/** `#rrggbb` mixed toward 0xrrggbb `to`. */
function mixHex(from: string, to: number, t: number): string {
  const n = mixColor(Number.parseInt(from.slice(1), 16), to, t);
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Paint styles with a focus: focused markers drawn (even hidden), others faded. No focus = as is. */
export function focusedStyles(
  styles: readonly MarkerStyle[],
  focus: ReadonlySet<string> | undefined,
  faceColor: number,
): readonly MarkerStyle[] {
  if (!focus || focus.size === 0) return styles;
  return styles.map((s) =>
    focus.has(s.id)
      ? s.visible
        ? s
        : { ...s, visible: true }
      : { ...s, color: mixColor(s.color, faceColor, FOCUS_FADE) },
  );
}

/** Marker entities with a focus: other markers' entities faded. */
export function focusedEntities(
  entities: readonly ShownEntity[],
  focus: ReadonlySet<string> | undefined,
  faceColor: number,
): readonly ShownEntity[] {
  if (!focus || focus.size === 0) return entities;
  return entities.map((e) =>
    focus.has(e.markerId) ? e : { ...e, color: mixHex(e.color, faceColor, FOCUS_FADE) },
  );
}
