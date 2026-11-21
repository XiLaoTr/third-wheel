/**
 * Body names that a new model version lost. A CAD round trip through build123d (`import_step`, boolean
 * results, `export_step`) drops the names the user gave: the Bodies list then shows `SOLID` / `COMPOUND`
 * or codes such as `=>[0:1:1:2]`. Comparing the previous version's names with the new file's tells
 * the AI at `load_model` time. Pure.
 */

/** Names a CAD kernel makes up when a body has none. */
const GENERIC = /^(solid|compound|compsolid|shell|face|body\s*\d*|solid\s*\d+|=>\[[\d:]*\].*)$/i;

/** "Screw M5 [2]" → "Screw M5": the app adds " [n]" to repeated names. */
export function baseBodyName(name: string): string {
  return name.replace(/\s*\[\d+\]$/, '').trim();
}

/** The names a person gave (not the kernel's), once each. */
export function customBodyNames(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const base = baseBodyName(n);
    if (base !== '' && !GENERIC.test(base)) out.add(base);
  }
  return [...out];
}

/**
 * Custom names of the previous version that are missing from the new one, when at least half of them
 * are (a few renames are normal). `undefined` = nothing to warn about.
 */
export function lostBodyNames(
  previous: readonly string[],
  next: readonly string[],
): string[] | undefined {
  const before = customBodyNames(previous);
  if (before.length === 0) return undefined;
  const kept = new Set(next.map(baseBodyName));
  const lost = before.filter((n) => !kept.has(n));
  return lost.length >= Math.ceil(before.length / 2) ? lost : undefined;
}

/** The sentence `load_model` gives the AI. */
export function lostBodyNamesWarning(lost: readonly string[], total: number): string {
  const shown = lost
    .slice(0, 4)
    .map((n) => `"${n}"`)
    .join(', ');
  return (
    `Body names were lost: ${String(lost.length)} of the ${String(total)} named bodies of the previous version ` +
    `(${shown}${lost.length > 4 ? ', …' : ''}) are not in this file; its bodies are called SOLID / COMPOUND or codes. ` +
    `The user sees these names in the Bodies list. build123d's import_step, boolean results and export_step drop them: ` +
    `set .label on every solid you export (same text as before, e.g. read them from the previous STEP's PRODUCT names) and keep ` +
    `the assembly nesting (Compound(label=…, children=[…])), then export again under a new file name and load_model it with revisionOf. Helper: scripts/ai/restore_step_names.py in the Third Wheel repository (python restore_step_names.py previous.step new.step restored.step); see docs/recipes.md.`
  );
}
