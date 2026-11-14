import { describe, expect, it } from 'vitest';
import {
  modelIdOf,
  parseParams,
  renderParamsSchema,
  waitReviewParamsSchema,
} from './bridge-methods.js';

describe('bridge methods', () => {
  it('model id = first 12 hex digits of the content hash', () => {
    expect(modelIdOf('sha256:0123456789abcdef0123')).toBe('0123456789ab');
  });

  it('render wants markerIds or groups (≤ 4), not both', () => {
    expect(() => parseParams(renderParamsSchema, { modelId: 'a' }, 'render')).toThrow(/either/);
    expect(() =>
      parseParams(
        renderParamsSchema,
        { modelId: 'a', markerIds: ['m'], groups: [['m']] },
        'render',
      ),
    ).toThrow(/either/);
    expect(() =>
      parseParams(
        renderParamsSchema,
        { modelId: 'a', groups: [['a'], ['b'], ['c'], ['d'], ['e']] },
        'render',
      ),
    ).toThrow(/Bad params/);
    expect(parseParams(renderParamsSchema, { modelId: 'a', groups: [['m']] }, 'render')).toEqual({
      modelId: 'a',
      groups: [['m']],
    });
  });

  it('wait is capped at 300 s', () => {
    expect(() =>
      parseParams(waitReviewParamsSchema, { reviewId: 'r', timeoutSec: 301 }, 'wait_review'),
    ).toThrow(/Bad params/);
  });
});
