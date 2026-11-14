/**
 * Sidecar file names (T5.1), shared by main and renderer. Same rule as `sidecarFileName` in
 * `@third-wheel/core` (main can't import core: it is shipped as TypeScript source).
 */

/** `part.step` → `part.step.thirdwheel.json`. */
export function sidecarFileName(modelFileName: string): string {
  return `${modelFileName}.thirdwheel.json`;
}

/**
 * Backup name for a sidecar that can't be used with the model any more (other model version or
 * unreadable): `part.step` at 2026-11-08 14:05:09 → `part.step.thirdwheel.2026-11-08-140509.bak.json`.
 */
export function sidecarBackupName(modelFileName: string, at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${String(at.getFullYear())}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  const time = `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${modelFileName}.thirdwheel.${day}-${time}.bak.json`;
}
