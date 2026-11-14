import { describe, expect, it } from 'vitest';
import { formatJson } from './format-json.js';

describe('formatJson', () => {
  const doc = {
    schemaVersion: 1,
    skip: undefined,
    markers: [
      {
        id: 'm1',
        entities: [{ kind: 'face', id: 7, seq: 1 }],
        paint: {
          faces: [
            {
              faceId: 2,
              triangles: [
                [120, 3],
                [130, 1],
              ],
            },
          ],
          samples: Array.from({ length: 90 }, (_, i) => i * 1.001),
        },
      },
    ],
    empty: { list: [], obj: {} },
  };

  it('reads back to the same value', () => {
    expect(JSON.parse(formatJson(doc))).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('keeps short parts on one line and wraps long number lists', () => {
    const text = formatJson(doc);
    expect(text).toContain('"entities": [{ "kind": "face", "id": 7, "seq": 1 }]');
    expect(text).toContain('"triangles": [[120, 3], [130, 1]]');
    expect(text).toContain('"empty": { "list": [], "obj": {} }');
    expect(text.endsWith('}\n')).toBe(true);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
    expect(text.split('\n').length).toBeLessThan(40);
  });

  it('formats plain values', () => {
    expect(formatJson('a')).toBe('"a"\n');
    expect(formatJson([1, null])).toBe('[1, null]\n');
  });
});
