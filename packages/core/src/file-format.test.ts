import { describe, expect, it } from 'vitest';
import spec from '../../../docs/file-format.md?raw';
import { parseAnnotationsJson } from './schema.js';

/** The example in docs/file-format.md must stay a valid sidecar (T5.2). */
describe('docs/file-format.md', () => {
  it('has an example that passes the schema', () => {
    const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
    expect(blocks).toHaveLength(1);
    const result = parseAnnotationsJson(blocks[0] ?? '');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.data.markers).toHaveLength(2);
    expect(result.data.comments).toHaveLength(2);
    expect(result.data.bodyTree?.folders).toHaveLength(1);
    expect(result.data.bodies).toHaveLength(2);
    expect(result.data.markers[1]?.entities[0]?.fingerprint?.form).toBe('hole');
    expect(result.droppedFields).toEqual([]);
  });
});
