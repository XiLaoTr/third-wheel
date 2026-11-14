import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { installFreeOrbit, screenUp, setOrbitAxis } from './free-orbit.js';

function setup(active: boolean): { controls: OrbitControls; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera();
  camera.up.set(0, 0, 1);
  camera.position.set(0, -10, 0); // front view, Z up
  const controls = new OrbitControls(camera);
  setOrbitAxis(controls, camera, new Vector3(0, 0, 1));
  controls.update();
  installFreeOrbit(controls, camera, () => active);
  return { controls, camera };
}

describe('free orbit', () => {
  it('tumbles over the top when dragging up past the pole', () => {
    const { controls, camera } = setup(true);
    for (let i = 0; i < 6; i++) controls.rotateUp(-Math.PI / 6); // 180° in 30° steps
    // Half a turn over the top: now behind the model, upside down.
    expect(camera.position.y).toBeCloseTo(10, 5);
    expect(screenUp(controls, camera).z).toBeCloseTo(-1, 5);
  });

  it('turntable (inactive) stops at the pole', () => {
    const { controls, camera } = setup(false);
    for (let i = 0; i < 6; i++) controls.rotateUp(-Math.PI / 6);
    expect(camera.position.y).toBeLessThan(0.01);
    expect(screenUp(controls, camera).z).toBeLessThan(0.01);
    expect(Math.abs(camera.position.z)).toBeGreaterThan(9.9); // parked at a pole
  });

  it('keeps a rolled picture on update (no snap back to the old axis)', () => {
    const { controls, camera } = setup(true);
    // Roll the picture 90°: screen-up becomes +X.
    camera.up.set(1, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
    expect(screenUp(controls, camera).x).toBeCloseTo(1, 5);
  });
});
