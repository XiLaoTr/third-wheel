/**
 * "Send to AI" without an AI request (T7.3): the AI chat lives in another app, so the button
 * copies a ready-to-paste message naming every model the user has open comments on in this
 * session (two related parts reviewed one after the other, sent together). Pure.
 */

export interface ReviewedFile {
  readonly path: string;
  readonly name: string;
  readonly openComments: number;
}

/** Models seen this session and their open-comment counts, in first-seen order. */
export class ReviewedFiles {
  private readonly files = new Map<string, ReviewedFile>();

  /** Records the shown model's current count (an update keeps its place in the order). */
  update(file: ReviewedFile): void {
    this.files.set(file.path, file);
  }

  /** Models with open comments, plus the shown one (always, even without comments). */
  forMessage(shownPath: string | undefined): ReviewedFile[] {
    return [...this.files.values()].filter((f) => f.openComments > 0 || f.path === shownPath);
  }
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** The message the user pastes into their AI chat. */
export function sendToAiMessage(files: readonly ReviewedFile[]): string {
  const how = (which: string): string =>
    `Please read them with the Third Wheel MCP tools: load_model on ${which}, then get_annotations.`;
  const [only] = files;
  if (files.length === 1 && only)
    return [
      `I reviewed ${only.name} in Third Wheel (${plural(only.openComments, 'open comment')}).`,
      `Path: ${only.path}`,
      how('that path'),
    ].join('\n');
  return [
    `I reviewed ${String(files.length)} models in Third Wheel; they belong together:`,
    ...files.map((f) => `- ${f.path} (${plural(f.openComments, 'open comment')})`),
    how('each path'),
  ].join('\n');
}
