import { Vector3, type PerspectiveCamera, type Quaternion } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Orbit (turntable) axis; OrbitControls caches it at construction, so refresh its rotation. */
export function setOrbitAxis(
  controls: OrbitControls,
  camera: PerspectiveCamera,
  up: Vector3,
): void {
  camera.up.copy(up);
  const c = controls as unknown as { _quat?: Quaternion; _quatInverse?: Quaternion };
  if (!c._quat || !c._quatInverse) throw new Error('OrbitControls internals changed (_quat)');
  c._quat.setFromUnitVectors(camera.up, new Vector3(0, 1, 0));
  c._quatInverse.copy(c._quat).invert();
}

/** The picture's up, made exactly ⟂ the view direction (camera may sit a hair off a pole). */
export function screenUp(controls: OrbitControls, camera: PerspectiveCamera): Vector3 {
  const view = camera.position.clone().sub(controls.target).normalize();
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return up.addScaledVector(view, -up.dot(view)).normalize();
}

/**
 * Free orbit: before every OrbitControls update (its own drag updates included), make the
 * picture's current up the orbit axis while `active()` is true. The camera then always sits at the
 * "equator", so vertical drags tumble over the top instead of stopping at the pole.
 */
export function installFreeOrbit(
  controls: OrbitControls,
  camera: PerspectiveCamera,
  active: () => boolean,
): void {
  const update = controls.update.bind(controls);
  controls.update = (deltaTime?: number | null): boolean => {
    if (active()) setOrbitAxis(controls, camera, screenUp(controls, camera));
    return update(deltaTime);
  };
}
