import { describe, expect, it } from 'vitest';
import { BRIDGE_FILE_ENV, bridgeFileSegments, parseBridgeRequest } from './bridge.js';

describe('bridgeFileSegments', () => {
  it('uses the per-user app-data folder of each platform', () => {
    expect(bridgeFileSegments('darwin', {}, '/Users/a')).toEqual([
      '/Users/a',
      'Library',
      'Application Support',
      'third-wheel',
      'bridge.json',
    ]);
    expect(
      bridgeFileSegments('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'),
    ).toEqual(['C:\\Users\\a\\AppData\\Roaming', 'third-wheel', 'bridge.json']);
    expect(bridgeFileSegments('win32', {}, 'C:\\Users\\a')).toEqual([
      'C:\\Users\\a',
      'AppData',
      'Roaming',
      'third-wheel',
      'bridge.json',
    ]);
    expect(bridgeFileSegments('linux', {}, '/home/a')).toEqual([
      '/home/a',
      '.config',
      'third-wheel',
      'bridge.json',
    ]);
  });

  it('takes the override from the environment', () => {
    expect(bridgeFileSegments('darwin', { [BRIDGE_FILE_ENV]: '/tmp/x.json' }, '/Users/a')).toEqual([
      '/tmp/x.json',
    ]);
  });
});

describe('parseBridgeRequest', () => {
  it('accepts a request with or without params', () => {
    expect(parseBridgeRequest('{"id":1,"method":"ping"}')).toEqual({
      ok: true,
      request: { id: 1, method: 'ping' },
    });
    expect(parseBridgeRequest('{"id":"a","method":"x","params":{"p":2}}')).toEqual({
      ok: true,
      request: { id: 'a', method: 'x', params: { p: 2 } },
    });
  });

  it('answers bad messages with bad_request, keeping the id when there is one', () => {
    expect(parseBridgeRequest('nope')).toEqual({
      ok: false,
      response: { id: null, error: { code: 'bad_request', message: 'Message is not JSON' } },
    });
    const noMethod = parseBridgeRequest('{"id":7}');
    expect(noMethod.ok).toBe(false);
    if (!noMethod.ok)
      expect(noMethod.response).toMatchObject({ id: 7, error: { code: 'bad_request' } });
    const nullJson = parseBridgeRequest('null');
    if (!nullJson.ok) expect(nullJson.response.id).toBeNull();
    else expect.fail('null accepted');
  });
});
