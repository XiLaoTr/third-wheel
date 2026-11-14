/** Rounding for compact output (review payload, fingerprints). Never returns -0 or NaN. */
import type { V3 } from './vec.js';

/** `x` rounded to `digits` decimals; undefined for missing / non-finite input. */
export function round(x: number | undefined, digits: number): number | undefined {
  if (x === undefined || !Number.isFinite(x)) return undefined;
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
}

export function roundV(
  v: V3 | readonly number[] | undefined,
  digits: number,
): [number, number, number] | undefined {
  if (!v || v.length < 3) return undefined;
  const [x, y, z] = [round(v[0], digits), round(v[1], digits), round(v[2], digits)];
  return x !== undefined && y !== undefined && z !== undefined ? [x, y, z] : undefined;
}

/** `T` with every field that may be undefined turned into an optional field. */
export type Compact<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Copy of `o` without undefined fields (so JSON and snapshots stay small). */
export function compact<T extends object>(o: T): Compact<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Compact<T>;
}
