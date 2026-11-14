/** Readout text for the hovered entity (bottom left of the view), pure. */
import { entityInfo, type InfoModel } from '@third-wheel/geometry';
import { sizeHint } from './info-format.js';
import type { PickHit } from './viewport.js';

/** No mesh pass while hovering: face area stays out of the readout. */
const NO_AREAS: ReadonlyMap<number, number> = new Map();

/** e.g. "Face 12 (cylinder Ø6 hole) · Bracket", "Vertex 3 · M3 screw [2]", "Body · Bracket". */
export function hoverLabel(hit: PickHit, model: InfoModel): string {
  const bodyName = model.bodyNames[hit.body] ?? `Body ${String(hit.body + 1)}`;
  if (hit.kind === 'body') return `Body · ${bodyName}`;
  const kind = hit.kind.charAt(0).toUpperCase() + hit.kind.slice(1);
  if (hit.kind === 'vertex') return `${kind} ${String(hit.id)} · ${bodyName}`;
  const info = entityInfo(model, hit, NO_AREAS);
  const detail = [info.type, sizeHint(info)].filter(Boolean).join(' ');
  return `${kind} ${String(hit.id)}${detail ? ` (${detail})` : ''} · ${bodyName}`;
}
