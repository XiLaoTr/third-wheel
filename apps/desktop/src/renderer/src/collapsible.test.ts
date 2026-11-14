import { describe, expect, it } from 'vitest';
import { parseCollapsed, serializeCollapsed } from './collapsible.js';

describe('collapsed sections setting', () => {
  it('round-trips and ignores junk', () => {
    expect(parseCollapsed(serializeCollapsed(new Set(['info', 'bodies'])))).toEqual(
      new Set(['bodies', 'info']),
    );
    expect(serializeCollapsed(new Set(['markers', 'bodies']))).toBe('["bodies","markers"]');
    expect(parseCollapsed(null)).toEqual(new Set());
    expect(parseCollapsed('{not json')).toEqual(new Set());
    expect(parseCollapsed('{"a":1}')).toEqual(new Set());
    expect(parseCollapsed('["info", 3]')).toEqual(new Set(['info']));
  });
});
