import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';

// Viewport.setOrbitUp patches these private fields to change the orbit axis after construction.
describe('OrbitControls internals used by Viewport.setOrbitUp', () => {
  it('still has _quat and _quatInverse', () => {
    const controls = new OrbitControls(new PerspectiveCamera()) as unknown as Record<
      string,
      unknown
    >;
    expect(controls['_quat']).toBeDefined();
    expect(controls['_quatInverse']).toBeDefined();
  });
});
