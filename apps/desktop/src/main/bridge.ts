/**
 * App bridge server (T7.1): localhost WebSocket the MCP server connects to. Electron-free, so it
 * is unit-tested with a real socket (`bridge.test.ts`). Protocol: `@third-wheel/core` bridge.ts.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BRIDGE_MAX_REQUEST_BYTES,
  BRIDGE_PROTOCOL,
  parseBridgeRequest,
  type BridgeErrorCode,
  type BridgeFile,
  type BridgeResponse,
} from '@third-wheel/core';
import { WebSocketServer, type WebSocket } from 'ws';

/** Handles one method; the result is sent as `{ result }`. Throw `BridgeMethodError` for a coded error. */
export type BridgeHandler = (params: unknown) => unknown;

export class BridgeMethodError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface BridgeOptions {
  /** Where to write the bridge file (port + token). */
  readonly filePath: string;
  readonly version: string;
  readonly handlers: Readonly<Record<string, BridgeHandler>>;
}

export interface Bridge {
  readonly port: number;
  /** Stop listening, drop clients, remove the bridge file if it is still ours. */
  close(): Promise<void>;
  /** Same, blocking (process exit): only removes the file; the sockets die with the process. */
  removeFileSync(): void;
}

const HOST = '127.0.0.1';

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  let port = 0;

  const wss = new WebSocketServer({
    host: HOST,
    port: 0, // any free port; clients find it in the bridge file
    maxPayload: BRIDGE_MAX_REQUEST_BYTES,
    verifyClient: (
      { req }: { req: IncomingMessage },
      done: (ok: boolean, code?: number) => void,
    ) => {
      done(...checkClient(req, expected, () => port));
    },
  });
  await new Promise<void>((ok, fail) => {
    wss.once('listening', ok);
    wss.once('error', fail);
  });
  const address = wss.address();
  if (address === null || typeof address === 'string')
    throw new Error('Bridge: unexpected address');
  port = address.port;
  // Later server errors are logged, never thrown in the main process.
  wss.on('error', (err) => {
    console.error('App bridge error:', err);
  });

  wss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      const text = isBinary ? '' : (data as Buffer).toString('utf8');
      void answer(text, options.handlers).then((response) => {
        send(socket, response);
      });
    });
  });

  const file: BridgeFile = {
    app: 'third-wheel',
    protocol: BRIDGE_PROTOCOL,
    port,
    token,
    pid: process.pid,
    version: options.version,
  };
  try {
    writeBridgeFile(options.filePath, file);
  } catch (err) {
    wss.close();
    throw err;
  }

  const removeFileSync = (): void => {
    // Another app copy started later owns the file now: leave its file alone.
    try {
      const current = JSON.parse(readFileSync(options.filePath, 'utf8')) as { token?: unknown };
      if (current.token === token) rmSync(options.filePath, { force: true });
    } catch {
      // gone or unreadable: nothing to remove
    }
  };

  return {
    port,
    removeFileSync,
    close: () =>
      new Promise<void>((done) => {
        removeFileSync();
        for (const client of wss.clients) client.terminate();
        wss.close(() => {
          done();
        });
      }),
  };
}

/** Refuse a connection unless it carries the token and comes as a plain local client (not a web page). */
function checkClient(
  req: IncomingMessage,
  expected: Buffer,
  port: () => number,
): [boolean, number?] {
  // Browsers always send Origin; our Node client never does. Blocks web pages outright.
  if (req.headers.origin !== undefined) return [false, 403];
  // DNS rebinding: a page's name pointing at 127.0.0.1 would arrive with its own Host.
  const host = req.headers.host;
  if (host !== `${HOST}:${String(port())}` && host !== `localhost:${String(port())}`)
    return [false, 403];
  const given = Buffer.from(req.headers.authorization ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [false, 401];
  return [true];
}

async function answer(
  text: string,
  handlers: Readonly<Record<string, BridgeHandler>>,
): Promise<BridgeResponse> {
  const parsed = parseBridgeRequest(text);
  if (!parsed.ok) return parsed.response;
  const { id, method, params } = parsed.request;
  const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (!handler)
    return { id, error: { code: 'unknown_method', message: `Unknown method "${method}"` } };
  try {
    return { id, result: (await handler(params)) ?? null };
  } catch (err) {
    if (err instanceof BridgeMethodError)
      return { id, error: { code: err.code, message: err.message } };
    return {
      id,
      error: { code: 'failed', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

function send(socket: WebSocket, response: BridgeResponse): void {
  if (socket.readyState !== socket.OPEN) return;
  let text: string;
  try {
    text = JSON.stringify(response);
  } catch (err) {
    text = JSON.stringify({
      id: response.id,
      error: { code: 'failed', message: `Answer not serialisable: ${String(err)}` },
    });
  }
  socket.send(text);
}

/** Write the bridge file readable only by this user (temp file + rename: never half a file). */
function writeBridgeFile(path: string, file: BridgeFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    renameWithRetry(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Codes Windows gives while antivirus / the indexer briefly holds a file. */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 4 || !BUSY_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
