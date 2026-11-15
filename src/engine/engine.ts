// Render engine: layered, camera-relative, HDR.
//
// Four scenes are drawn back to front into one HDR target, each in its own unit so that
// 32-bit GPU floats are only ever asked to hold camera-relative numbers of sane magnitude:
//
//   cosmic    megaparsecs   galaxy catalogue, cosmic web, CMB shell
//   galactic  parsecs       Milky Way model (origin: Galactic Centre)
//   stellar   parsecs       star catalogue (origin: Sun)
//   near      kilometres    solid bodies, rings, orbits; logarithmic depth buffer
//
// Followed by an optional relativistic lensing pass, bloom and ACES tone mapping.

import {
  ACESFilmicToneMapping, Group, HalfFloatType, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MPC_KM, PC_KM } from '../core/constants';
import { CameraRig } from './camera';
import type { Entity } from './entity';
import type { Quality } from './quality';

export interface Layer {
  name: string;
  scene: Scene;
  camera: PerspectiveCamera;
  /** kilometres per scene unit */
  unitKm: number;
  /** content whose origin is `originPc`; positioned camera-relative every frame */
  root: Group;
  originPc: Vector3;
}

export interface FrameContext {
  /** simulation time, Julian date (TDB) */
  jd: number;
  /** wall-clock seconds since start and since last frame */
  time: number;
  dt: number;
  rig: CameraRig;
  /** camera distance to its focus point, km */
  distKm: number;
  /** distance from camera to the Sun, pc */
  sunDistPc: number;
  /** device pixels per radian at screen centre */
  pixelScale: number;
  width: number; // css px
  height: number;
  pixelRatio: number;
  /** camera-relative position (km) of an entity */
  rel(e: Entity, out: Vector3): Vector3;
  /** project a camera-relative vector to CSS pixels; returns false when behind the camera */
  project(rel: Vector3, out: { x: number; y: number }): boolean;
}

export interface System {
  /** advance physical state to time jd (runs before the camera so it can track moving bodies) */
  simulate?(jd: number): void;
  /** update render state for this frame */
  update(ctx: FrameContext): void;
}

/** A pass that draws all layers (and anything hooked in between) into the composer's buffer. */
class LayersPass extends Pass {
  constructor(private engine: Engine) {
    super();
    this.needsSwap = false;
  }
  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    const e = this.engine;
    for (const layer of e.layers) {
      if (layer.name === 'near') {
        e.beforeNear?.(renderer, read);
        renderer.setRenderTarget(this.renderToScreen ? null : read);
      }
      renderer.clearDepth();
      renderer.render(layer.scene, layer.camera);
    }
  }
}

export class Engine {
  renderer: WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  layers: Layer[] = [];
  cosmic: Layer;
  galactic: Layer;
  stellar: Layer;
  near: Layer;
  rig = new CameraRig();
  systems: System[] = [];
  /** hook: draw screen-space effects after the background layers, before solid bodies */
  beforeNear: ((renderer: WebGLRenderer, target: WebGLRenderTarget) => void) | null = null;
  /** when set, replaces the whole universe render (simulation lab) */
  override: { render(dt: number, time: number): void } | null = null;
  ctx: FrameContext;
  width = 1;
  height = 1;
  pixelRatio = 1;
  exposure = 1;
  private size = new Vector2();
  private _cam = new Vector3();

  constructor(public canvas: HTMLCanvasElement, public quality: Quality) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const mk = (name: string, unitKm: number, origin: Vector3, near: number, far: number): Layer => {
      const scene = new Scene();
      const camera = new PerspectiveCamera(this.rig.fov, 1, near, far);
      const root = new Group();
      scene.add(root);
      const layer = { name, scene, camera, unitKm, root, originPc: origin };
      this.layers.push(layer);
      return layer;
    };
    this.cosmic = mk('cosmic', MPC_KM, new Vector3(), 1e-6, 1e6);
    this.galactic = mk('galactic', PC_KM, new Vector3(), 1e-6, 1e9);
    this.stellar = mk('stellar', PC_KM, new Vector3(), 1e-9, 1e7);
    this.near = mk('near', 1, new Vector3(), 0.05, 1e17);

    const rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, samples: quality.msaa, depthBuffer: true });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new LayersPass(this));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), quality.bloom ? 0.55 : 0, 0.55, 0.9);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const self = this;
    this.ctx = {
      jd: 0, time: 0, dt: 0, rig: this.rig, distKm: 1, sunDistPc: 0, pixelScale: 1, width: 1, height: 1, pixelRatio: 1,
      rel(e, out) { return e.relativeTo(self.rig.anchor, self.rig.local, out); },
      project(rel, out) {
        const cam = self.near.camera;
        self._cam.copy(rel).applyQuaternion(cam.quaternion.clone().invert());
        if (self._cam.z >= 0) return false;
        const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
        const nx = (self._cam.x * f) / (-self._cam.z * cam.aspect);
        const ny = (self._cam.y * f) / -self._cam.z;
        out.x = (nx * 0.5 + 0.5) * self.width;
        out.y = (-ny * 0.5 + 0.5) * self.height;
        return true;
      },
    };
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w; this.height = h; this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    for (const l of this.layers) {
      l.camera.aspect = w / h;
      l.camera.fov = this.rig.fov;
      l.camera.updateProjectionMatrix();
    }
  }

  /** Camera-relative position (in the layer's units) of a point given as parsecs from the Sun. */
  anchorToLayer(layer: Layer, anchorPc: Vector3, out: Vector3): Vector3 {
    const r = this.rig;
    out.subVectors(anchorPc, r.anchor).multiplyScalar(PC_KM).sub(r.local).multiplyScalar(1 / layer.unitKm);
    return out;
  }

  frame(jd: number, time: number, dt: number): void {
    this.resize();
    if (this.override) {
      this.override.render(dt, time);
      return;
    }
    const rig = this.rig;
    for (const s of this.systems) s.simulate?.(jd);
    rig.update(dt);
    const ctx = this.ctx;
    ctx.jd = jd; ctx.time = time; ctx.dt = dt;
    ctx.distKm = rig.distKm;
    ctx.sunDistPc = rig.distanceFromOriginPc();
    ctx.width = this.width; ctx.height = this.height; ctx.pixelRatio = this.pixelRatio;
    this.renderer.getDrawingBufferSize(this.size);
    ctx.pixelScale = this.size.y / (2 * Math.tan((rig.fov * Math.PI) / 360));
    for (const l of this.layers) {
      l.camera.quaternion.copy(rig.quaternion);
      l.camera.updateMatrixWorld(true);
      this.anchorToLayer(l, l.originPc, l.root.position);
    }
    for (const s of this.systems) s.update(ctx);
    this.renderer.toneMappingExposure = this.exposure;
    this.composer.render(dt);
  }
}
