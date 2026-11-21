/**
 * 3D pictures of catalogue parts with three.js: small thumbnails for the list (one shared offscreen
 * renderer, cached as images) and one rotatable preview for the detail card. Each mesh is decoded
 * once from `meshes.bin` (see `mesh.ts`).
 *
 * The app's own viewport is untouched: these are separate WebGL contexts. When WebGL cannot be created
 * the object marks itself unavailable and the panel shows plain placeholders.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { CatalogueMesh } from './catalogue.js';
import { decodeMesh } from './mesh.js';

interface Palette {
  readonly face: number;
  readonly edge: number;
}

/** Colours for the current theme (the app sets `data-theme` on the root element). */
function palette(): Palette {
  return document.documentElement.dataset['theme'] === 'dark'
    ? { face: 0x8a93a3, edge: 0xe6e9ef }
    : { face: 0xb4bcc9, edge: 0x1c1f24 };
}

interface PartGeometry {
  readonly faces: BufferGeometry;
  readonly edges: EdgesGeometry;
}

/** A scene with a lit part, drawn into its own canvas. */
class Stage {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly group = new Group();
  private materials: Material[] = [];

  constructor(width: number, height: number, pixelRatio: number) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new HemisphereLight(0xffffff, 0x6a7384, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, -4, 6);
    this.scene.add(sun);
    this.camera = new PerspectiveCamera(32, width / height, 0.1, 60);
    this.camera.up.set(0, 0, 1); // bd_warehouse parts are Z-up
    this.scene.add(this.group);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  show(part: PartGeometry): void {
    for (const m of this.materials) m.dispose();
    this.group.clear();
    const colours = palette();
    const face = new MeshStandardMaterial({
      color: colours.face,
      metalness: 0.1,
      roughness: 0.6,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const edge = new LineBasicMaterial({ color: colours.edge });
    this.materials = [face, edge];
    this.group.add(new Mesh(part.faces, face), new LineSegments(part.edges, edge));
  }

  /** `theta` turns around the vertical axis, `phi` is the elevation, `distance` is in part sizes. */
  draw(theta: number, phi: number, distance: number): void {
    this.camera.position.set(
      distance * Math.cos(phi) * Math.cos(theta),
      distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.renderer.dispose();
  }
}

const THUMB_PX = 80;
/** First size of the rotatable preview; it is resized to its host straight away. */
const PREVIEW_HEIGHT = 200;
const HOME = { theta: -0.7, phi: 0.5, distance: 4.4 } as const;

export class PartPreviews {
  private readonly geometries = new Map<string, PartGeometry>();
  private readonly thumbnails = new Map<string, string>();
  private thumbStage: Stage | undefined;
  private broken = false;

  // the rotatable preview
  private stage: Stage | undefined;
  private shownName: string | undefined;
  private view: { theta: number; phi: number; distance: number; spin: boolean } = {
    ...HOME,
    spin: true,
  };
  private drag: { x: number; y: number } | undefined;
  private frame = 0;
  private observer: ResizeObserver | undefined;

  constructor(private readonly meshes: ArrayBuffer) {}

  /** False once WebGL turned out not to work here. */
  get available(): boolean {
    return !this.broken;
  }

  private geometryOf(name: string, mesh: CatalogueMesh): PartGeometry {
    const cached = this.geometries.get(name);
    if (cached) return cached;
    const decoded = decodeMesh(this.meshes, mesh);
    const faces = new BufferGeometry();
    faces.setAttribute('position', new BufferAttribute(decoded.positions, 3));
    faces.setIndex(new BufferAttribute(decoded.indices, 1));
    const part = { faces, edges: new EdgesGeometry(faces, 30) };
    this.geometries.set(name, part);
    return part;
  }

  /** A small picture of the part as a data URL (cached), or undefined without WebGL. */
  thumbnail(name: string, mesh: CatalogueMesh): string | undefined {
    const cached = this.thumbnails.get(name);
    if (cached) return cached;
    if (this.broken) return undefined;
    try {
      this.thumbStage ??= new Stage(THUMB_PX, THUMB_PX, 1);
      this.thumbStage.show(this.geometryOf(name, mesh));
      this.thumbStage.draw(HOME.theta, HOME.phi, 4.3);
      const url = this.thumbStage.renderer.domElement.toDataURL('image/png');
      this.thumbnails.set(name, url);
      return url;
    } catch {
      this.broken = true;
      return undefined;
    }
  }

  /** Puts the rotatable preview of a part into `host` (drag to turn, wheel to zoom, double-click to reset). */
  show(host: HTMLElement, name: string, mesh: CatalogueMesh): void {
    if (this.broken) return;
    try {
      if (!this.stage) {
        this.stage = new Stage(280, PREVIEW_HEIGHT, Math.min(window.devicePixelRatio, 2));
        this.wire(this.stage.renderer.domElement);
      }
      const canvas = this.stage.renderer.domElement;
      host.replaceChildren(canvas);
      Object.assign(canvas.style, { width: '100%', height: '100%' });
      const fit = (): void => {
        // The host's size follows the window (CSS), so the picture is drawn at whatever it is now.
        this.stage?.resize(Math.max(120, host.clientWidth), Math.max(100, host.clientHeight));
      };
      fit();
      this.observer?.disconnect();
      this.observer = new ResizeObserver(fit);
      this.observer.observe(host);
      if (this.shownName !== name) {
        this.stage.show(this.geometryOf(name, mesh));
        this.shownName = name;
        this.view = { ...HOME, spin: true };
      }
      this.start();
    } catch {
      this.broken = true;
      host.replaceChildren();
    }
  }

  /** Stops drawing (the panel is closed). */
  hide(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** The theme changed: colours are baked into the pictures, so rebuild them. */
  themeChanged(): void {
    this.thumbnails.clear();
    this.shownName = undefined;
  }

  dispose(): void {
    this.hide();
    this.stage?.dispose();
    this.thumbStage?.dispose();
    for (const g of this.geometries.values()) {
      g.faces.dispose();
      g.edges.dispose();
    }
    this.geometries.clear();
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    const tick = (): void => {
      const stage = this.stage;
      if (!stage) return;
      if (this.view.spin && !this.drag) this.view.theta += 0.005;
      stage.draw(this.view.theta, this.view.phi, this.view.distance);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private wire(canvas: HTMLCanvasElement): void {
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.view.spin = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.view.theta -= (e.clientX - this.drag.x) * 0.01;
      this.view.phi = Math.max(
        -1.45,
        Math.min(1.45, this.view.phi + (e.clientY - this.drag.y) * 0.01),
      );
      this.drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => {
      this.drag = undefined;
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.view.distance = Math.max(
          2.4,
          Math.min(9, this.view.distance * (e.deltaY > 0 ? 1.08 : 0.92)),
        );
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', () => {
      this.view = { ...HOME, spin: true };
    });
  }
}
