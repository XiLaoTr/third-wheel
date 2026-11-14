/** Web Worker entry: STEP import with OpenCascade, off the UI thread. */
import { serveStepImports, type MessageEndpoint } from '@third-wheel/geometry';
import { OcctKernel } from 'occt-wasm';
// Emitted as a separate file (LGPL: the OCCT binary must stay a replaceable file).
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url';

serveStepImports(self as unknown as MessageEndpoint, () => OcctKernel.init({ wasm: wasmUrl }));
