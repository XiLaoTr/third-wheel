/**
 * View cube: a small labelled cube in the viewport's top-right corner that turns with the camera.
 * Drawn into the main canvas (own scene + camera, after the model). Clicking a face, edge or corner
 * returns that view direction (camera-views.ts `cubeHitDirection`).
 */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import type { ResolvedTheme } from '../../shared/theme.js';
import { cubeHitDirection, type Vec3 } from './camera-views.js';

/** Widget size and margin from the viewport's top-right corner, in CSS px. */
export const VIEW_CUBE_SIZE = 96;
export const VIEW_CUBE_MARGIN = 12;

interface FaceSpec {
  readonly label: string;
  readonly normal: Vec3;
  /** Which world direction is "up" in the label. */
  readonly up: Vec3;
}

const FACES: readonly FaceSpec[] = [
  { label: 'FRONT', normal: [0, -1, 0], up: [0, 0, 1] },
  { label: 'BACK', normal: [0, 1, 0], up: [0, 0, 1] },
  { label: 'RIGHT', normal: [1, 0, 0], up: [0, 0, 1] },
  { label: 'LEFT', normal: [-1, 0, 0], up: [0, 0, 1] },
  { label: 'TOP', normal: [0, 0, 1], up: [0, 1, 0] },
  { label: 'BOTTOM', normal: [0, 0, -1], up: [0, -1, 0] },
];

const COLORS: Record<ResolvedTheme, { face: string; text: string; edge: number; hover: number }> = {
  light: { face: '#f4f5f7', text: '#3a3f47', edge: 0x6b717c, hover: 0x3b82f6 },
  dark: { face: '#3a3e46', text: '#e3e6ea', edge: 0x9aa0aa, hover: 0x60a5fa },
};

function labelTexture(label: string, theme: ResolvedTheme): CanvasTexture {
  const c = COLORS[theme];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = c.face;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = c.text;
    ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64, 66);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class ViewCube {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.9, 0.9, 0.9, -0.9, 0.1, 10);
  private readonly cube = new Group();
  private readonly faces: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly edges: LineSegments<BufferGeometry, LineBasicMaterial>;
  /** Patch drawn over the hovered face/edge/corner region. */
  private readonly hover: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly raycaster = new Raycaster();
  private hoverKey = '';

  constructor() {
    for (const spec of FACES) {
      const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
      const n = new Vector3(...spec.normal);
      const up = new Vector3(...spec.up);
      const right = up.clone().cross(n);
      mesh.applyMatrix4(new Matrix4().makeBasis(right, up, n).setPosition(n.multiplyScalar(0.5)));
      this.faces.push(mesh);
      this.cube.add(mesh);
    }
    this.edges = new LineSegments(cubeEdges(), new LineBasicMaterial());
    this.cube.add(this.edges);

    this.hover = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        side: DoubleSide,
      }),
    );
    this.hover.visible = false;
    this.hover.renderOrder = 1;
    this.cube.add(this.hover);

    this.scene.add(this.cube);
    this.setTheme('light');
  }

  setTheme(theme: ResolvedTheme): void {
    const c = COLORS[theme];
    this.faces.forEach((mesh, i) => {
      mesh.material.map?.dispose();
      mesh.material.map = labelTexture(FACES[i]?.label ?? '', theme);
      mesh.material.needsUpdate = true;
    });
    this.edges.material.color.setHex(c.edge);
    this.hover.material.color = new Color(c.hover);
  }

  /** Viewport-relative rectangle of the widget in CSS px (top-left origin). */
  rect(viewportWidth: number): { x: number; y: number; size: number } {
    return {
      x: viewportWidth - VIEW_CUBE_SIZE - VIEW_CUBE_MARGIN,
      y: VIEW_CUBE_MARGIN,
      size: VIEW_CUBE_SIZE,
    };
  }

  /** Draw on top of what is already in the canvas, oriented like `mainCamera`. */
  render(renderer: WebGLRenderer, mainCamera: PerspectiveCamera, viewportWidth: number): void {
    const height = renderer.domElement.clientHeight;
    const { x, y, size } = this.rect(viewportWidth);
    this.syncCamera(mainCamera);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    // setViewport/setScissor take a bottom-left origin.
    renderer.setViewport(x, height - y - size, size, size);
    renderer.render(this.scene, this.camera);
    renderer.setViewport(0, 0, viewportWidth, height);
    renderer.autoClear = autoClear;
  }

  /**
   * View direction under a viewport-relative point (CSS px), or undefined if the point misses the
   * cube. Also updates the hover highlight; returns whether that changed (caller re-renders).
   */
  pick(
    px: number,
    py: number,
    viewportWidth: number,
    mainCamera: PerspectiveCamera,
  ): Vec3 | undefined {
    const { x, y, size } = this.rect(viewportWidth);
    const u = (px - x) / size;
    const v = (py - y) / size;
    if (u < 0 || u > 1 || v < 0 || v > 1) return undefined;
    this.syncCamera(mainCamera);
    this.raycaster.setFromCamera(new Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const hit = this.raycaster.intersectObjects(this.faces, false)[0];
    if (!hit) return undefined;
    return cubeHitDirection([hit.point.x, hit.point.y, hit.point.z]);
  }

  /** Highlight the cube region for `dir` (or nothing). Returns true when the highlight changed. */
  setHover(dir: Vec3 | undefined): boolean {
    const sign = (c: number): number => Math.sign(Math.round(c * 10));
    const region: Vec3 | undefined = dir && [sign(dir[0]), sign(dir[1]), sign(dir[2])];
    const key = region?.join() ?? '';
    if (key === this.hoverKey) return false;
    this.hoverKey = key;
    this.hover.visible = region !== undefined;
    if (region) {
      this.hover.geometry.dispose();
      this.hover.geometry = regionPatch(region);
    }
    return true;
  }

  dispose(): void {
    for (const mesh of this.faces) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    this.edges.geometry.dispose();
    this.edges.material.dispose();
    this.hover.geometry.dispose();
    this.hover.material.dispose();
  }

  private syncCamera(mainCamera: PerspectiveCamera): void {
    // Same orientation as the main camera, looking at the cube's centre from outside.
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.position.set(0, 0, 3).applyQuaternion(mainCamera.quaternion);
    this.camera.updateMatrixWorld();
  }
}

/** The 12 edges of the unit cube. */
function cubeEdges(): BufferGeometry {
  const pts: number[] = [];
  const h = 0.5;
  for (const a of [-h, h])
    for (const b of [-h, h]) {
      pts.push(-h, a, b, h, a, b); // along X
      pts.push(a, -h, b, a, h, b); // along Y
      pts.push(a, b, -h, a, b, h); // along Z
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}

/**
 * Surface patch of the cube region a face/edge/corner click selects (same 0.15 band as
 * `cubeHitDirection`), slightly lifted off the faces: on each face the region's axis is non-zero
 * for, the matching strip/square/centre.
 */
function regionPatch(sign: Vec3): BufferGeometry {
  const h = 0.5;
  const band = 0.15;
  const lift = 0.502;
  const pts: number[] = [];
  // Interval along one axis on a face: centre part for 0, the band at that side for ±1.
  const span = (s: number): [number, number] =>
    s === 0 ? [-h + band, h - band] : s > 0 ? [h - band, h] : [-h, -h + band];
  for (let axis = 0; axis < 3; axis++) {
    const s = sign[axis] ?? 0;
    if (s === 0) continue;
    const [ua, va] = [(axis + 1) % 3, (axis + 2) % 3];
    const [u0, u1] = span(sign[ua] ?? 0);
    const [v0, v1] = span(sign[va] ?? 0);
    const corner = (u: number, v: number): void => {
      const p = [0, 0, 0];
      p[axis] = s * lift;
      p[ua] = u;
      p[va] = v;
      pts.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    };
    corner(u0, v0);
    corner(u1, v0);
    corner(u1, v1);
    corner(u0, v0);
    corner(u1, v1);
    corner(u0, v1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}
