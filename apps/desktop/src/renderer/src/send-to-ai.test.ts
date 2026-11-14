import { describe, expect, it } from 'vitest';
import { ReviewedFiles, sendToAiMessage } from './send-to-ai.js';

describe('ReviewedFiles', () => {
  it('lists models with open comments plus the shown one, in first-seen order', () => {
    const r = new ReviewedFiles();
    r.update({ path: '/a/bracket.step', name: 'bracket.step', openComments: 2 });
    r.update({ path: '/a/empty.step', name: 'empty.step', openComments: 0 });
    r.update({ path: '/b/housing.step', name: 'housing.step', openComments: 0 });
    r.update({ path: '/b/housing.step', name: 'housing.step', openComments: 1 });
    r.update({ path: '/a/bracket.step', name: 'bracket.step', openComments: 3 });
    expect(r.forMessage('/b/housing.step').map((f) => [f.name, f.openComments])).toEqual([
      ['bracket.step', 3],
      ['housing.step', 1],
    ]);
    expect(r.forMessage('/a/empty.step').map((f) => f.name)).toEqual([
      'bracket.step',
      'empty.step',
      'housing.step',
    ]);
  });

  it('drops a model whose comments were all resolved (unless shown)', () => {
    const r = new ReviewedFiles();
    r.update({ path: 'C:\\cad\\a.step', name: 'a.step', openComments: 1 });
    r.update({ path: 'C:\\cad\\a.step', name: 'a.step', openComments: 0 });
    expect(r.forMessage(undefined)).toEqual([]);
  });
});

describe('sendToAiMessage', () => {
  it('names one model with its path', () => {
    expect(sendToAiMessage([{ path: '/cad/box.step', name: 'box.step', openComments: 1 }])).toBe(
      'I reviewed box.step in Third Wheel (1 open comment).\n' +
        'Path: /cad/box.step\n' +
        'Please read them with the Third Wheel MCP tools: load_model on that path, then get_annotations.',
    );
  });

  it('lists several models as belonging together', () => {
    const text = sendToAiMessage([
      { path: '/a/bracket.step', name: 'bracket.step', openComments: 3 },
      { path: 'C:\\b\\housing.step', name: 'housing.step', openComments: 1 },
    ]);
    expect(text).toBe(
      'I reviewed 2 models in Third Wheel; they belong together:\n' +
        '- /a/bracket.step (3 open comments)\n' +
        '- C:\\b\\housing.step (1 open comment)\n' +
        'Please read them with the Third Wheel MCP tools: load_model on each path, then get_annotations.',
    );
  });
});
