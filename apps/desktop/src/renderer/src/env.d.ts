import type { ThirdWheelApi } from '../../shared/ipc.js';

declare global {
  interface Window {
    /** Present inside Electron (set by the preload); absent in a plain browser. */
    thirdWheel?: ThirdWheelApi;
  }
}
