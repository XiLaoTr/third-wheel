import { describe, expect, it } from 'vitest';
import { commentThread, nextReplyId } from './thread.js';

const T = '2026-11-09T10:00:00.000Z';
const reply = (id: string) => ({
  id,
  text: id,
  author: 'human' as const,
  createdAt: T,
  updatedAt: T,
});

describe('nextReplyId', () => {
  it('counts above the highest r<n>', () => {
    expect(nextReplyId([])).toBe('r1');
    expect(nextReplyId([reply('r2'), reply('x9'), reply('r10')])).toBe('r11');
  });
});

describe('commentThread', () => {
  it('returns the replies as they are without a note', () => {
    expect(commentThread({ status: 'open', updatedAt: T, replies: [reply('r1')] })).toEqual([
      reply('r1'),
    ]);
    expect(commentThread({ status: 'open', updatedAt: T, note: '  ' })).toEqual([]);
  });

  it('puts an old note first as an AI reply with the status', () => {
    expect(commentThread({ status: 'wontfix', updatedAt: T, note: 'too thin to print' })).toEqual([
      {
        id: 'r1',
        text: 'too thin to print',
        author: 'ai',
        createdAt: T,
        updatedAt: T,
        status: 'wontfix',
      },
    ]);
    const both = commentThread({ status: 'open', updatedAt: T, note: 'n', replies: [reply('r1')] });
    expect(both.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(both[0]).not.toHaveProperty('status');
  });
});
