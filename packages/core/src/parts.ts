/** Helpers for part requests (the `parts` of a comment, see `schema.ts`). Pure. */

/** "p1", "p2", …: one above the highest "pN" in `parts`. */
export function nextPartId(parts: readonly { readonly id: string }[]): string {
  let max = 0;
  for (const p of parts) {
    const n = /^p(\d+)$/.exec(p.id)?.[1];
    if (n) max = Math.max(max, Number(n));
  }
  return `p${String(max + 1)}`;
}
