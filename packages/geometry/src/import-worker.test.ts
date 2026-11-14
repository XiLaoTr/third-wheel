import { MessageChannel } from 'node:worker_threads';
import { OcctKernel } from 'occt-wasm';
import { describe, expect, it } from 'vitest';
import {
  NO_KEPT_SHAPES,
  serveStepImports,
  StepImportClient,
  type ImportProgress,
  type MessageEndpoint,
} from './import-worker.js';

function channel(initKernel: () => Promise<OcctKernel>): StepImportClient {
  const { port1, port2 } = new MessageChannel();
  serveStepImports(port2 as unknown as MessageEndpoint, initKernel);
  const client = new StepImportClient(port1 as unknown as MessageEndpoint);
  port1.start();
  port2.start();
  return client;
}

async function boxStep(): Promise<ArrayBuffer> {
  const k = await OcctKernel.init();
  return new TextEncoder().encode(k.exportStep(k.makeBox(1, 2, 3))).buffer;
}

describe('StepImportClient ↔ serveStepImports', () => {
  it('imports via messages, reports rising progress and transfers the result', async () => {
    const client = channel(() => OcctKernel.init());
    const progress: ImportProgress[] = [];
    const model = await client.import(await boxStep(), { onProgress: (p) => progress.push(p) });
    expect(model.faceBody.length).toBe(6);
    expect(model.triangleFace).toBeInstanceOf(Uint32Array);
    expect(progress.map((p) => p.label)[0]).toBe('Starting OpenCascade');
    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBeLessThan(1);
  }, 30_000);

  it('cancelAll rejects pending imports', async () => {
    const client = channel(() => OcctKernel.init());
    const pending = client.import(await boxStep());
    client.cancelAll();
    await expect(pending).rejects.toThrow('Import cancelled');
  }, 30_000);

  it('rejects with the error message and keeps serving', async () => {
    const client = channel(() => OcctKernel.init());
    await expect(client.import(new TextEncoder().encode('garbage').buffer)).rejects.toThrow();
    const model = await client.import(await boxStep());
    expect(model.bodyCount).toBe(1);
  }, 30_000);

  it('retries a failed kernel init on the next request', async () => {
    let calls = 0;
    const client = channel(() =>
      ++calls === 1 ? Promise.reject(new Error('no wasm')) : OcctKernel.init(),
    );
    await expect(client.import(await boxStep())).rejects.toThrow('no wasm');
    expect((await client.import(await boxStep())).bodyCount).toBe(1);
    expect(calls).toBe(2);
  }, 30_000);
});

describe('kept shapes → exact', () => {
  const request = { faceAreas: [0], bodyAreas: [0], bodyBoxes: [0], distances: [] };

  it('keeps the shapes when asked and answers exact requests', async () => {
    const client = channel(() => OcctKernel.init());
    await expect(client.exact(request)).rejects.toThrow(NO_KEPT_SHAPES);
    const { model, kept } = await client.importKeeping(await boxStep(), { keep: {} });
    expect(model.bodyCount).toBe(1);
    expect(kept).toBe(true);
    const r = await client.exact(request);
    expect(r.bodyAreas[0]).toBeCloseTo(22, 6); // 2·(1·2 + 1·3 + 2·3)
    expect(r.bodyBoxes[0]?.max).toEqual([1, 2, 3]);
    // A plain import drops them.
    await client.import(await boxStep());
    await expect(client.exact(request)).rejects.toThrow(NO_KEPT_SHAPES);
  }, 30_000);

  it('does not keep them above maxHeapBytes', async () => {
    const client = channel(() => OcctKernel.init());
    const { kept } = await client.importKeeping(await boxStep(), { keep: { maxHeapBytes: 1 } });
    expect(kept).toBe(false);
    await expect(client.exact(request)).rejects.toThrow(NO_KEPT_SHAPES);
  }, 30_000);
});
