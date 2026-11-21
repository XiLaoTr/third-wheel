/** Pure TypeScript domain logic: schema, region analysis, sidecar I/O, annotation transfer. */
export const PACKAGE_NAME = '@third-wheel/core';

/** Sidecar file name for a model file, e.g. `part.step` → `part.step.thirdwheel.json`. */
export function sidecarFileName(modelFileName: string): string {
  return `${modelFileName}.thirdwheel.json`;
}

export * from './schema.js';
export * from './runs.js';
export * from './format-json.js';
export * from './region.js';
export * from './bridge.js';
export * from './bridge-methods.js';
export * from './thread.js';
export * from './parts.js';
export * from './body-names.js';
export * from './versions.js';
export * from './version-chain.js';
