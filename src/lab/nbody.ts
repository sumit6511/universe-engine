// Gravity lab: real-time N-body experiments integrated on the GPU.
//
// Two integrators share one code path (float textures, symplectic kick-drift leapfrog):
//
//  * Restricted N-body (Toomre & Toomre 1972): each galaxy is a massive Plummer-softened core
//    carrying a disc of massless test stars.  Hundreds of thousands of stars respond to the
//    time-varying tidal field of the cores; this is the method that first explained tidal
//    tails and bridges.  Core orbits are integrated on the CPU, with a Chandrasekhar-style
//    dynamical-friction drag so that the pair loses orbital energy and merges.
//  * Direct summation: every particle attracts every other (O(N^2) per step in the fragment
//    shader), used for the collapse of a self-gravitating star cluster.
//
// Units: G = 1, kpc, 1e10 solar masses  ->  velocity unit 207.4 km/s, time unit 4.715 Myr.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, FloatType, Mesh, NearestFilter, NoBlending, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Points, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { App } from '../app';
import type { UI } from '../ui/ui';

const TIME_UNIT_MYR = 4.715;
const VEL_UNIT_KMS = 207.4;

interface GalaxySpec { mass: number; a: number; rd: number; rmin: number; rmax: number; share: number; incl: number; node: number; spin: 1 | -1; tint: number }
interface Preset {
  id: string; name: string; blurb: string; self: boolean;
  dt: number; view: number; friction: number;
  galaxies?: GalaxySpec[];
  /** relative orbit: pericentre q, eccentricity e, initial separation r0 (kpc); or explicit relative state */
  orbit?: { q: number; e: number; r0: number } | { r: [number, number, number]; v: [number, number, number] };
}

const PRESETS: Preset[] = [
  {
    id: 'tails', name: 'Tidal tails', self: false, dt: 0.02, view: 150, friction: 0.5,
    blurb: 'Two equal disc galaxies on a parabolic, prograde encounter. Stars on the far side of each disc are flung into long tails, as in the Antennae (NGC 4038/9).',
    galaxies: [
      { mass: 12, a: 1.6, rd: 3, rmin: 0.8, rmax: 11, share: 0.5, incl: 60, node: 30, spin: 1, tint: 0 },
      { mass: 12, a: 1.6, rd: 3, rmin: 0.8, rmax: 11, share: 0.5, incl: 60, node: 210, spin: 1, tint: 1 },
    ],
    orbit: { q: 14, e: 1, r0: 75 },
  },
  {
    id: 'retro', name: 'Prograde vs retrograde', self: false, dt: 0.02, view: 150, friction: 0.5,
    blurb: 'The same encounter, but the blue disc spins against the orbit. Its stars never stay in resonance with the passing mass, so it barely reacts: Toomre and Toomre’s key result.',
    galaxies: [
      { mass: 12, a: 1.6, rd: 3, rmin: 0.8, rmax: 11, share: 0.5, incl: 15, node: 0, spin: 1, tint: 0 },
      { mass: 12, a: 1.6, rd: 3, rmin: 0.8, rmax: 11, share: 0.5, incl: 15, node: 0, spin: -1, tint: 1 },
    ],
    orbit: { q: 14, e: 1, r0: 75 },
  },
  {
    id: 'm51', name: 'Fly-by companion', self: false, dt: 0.02, view: 120, friction: 0.25,
    blurb: 'A companion with a quarter of the mass passes a large spiral, drawing out a bridge and a counter-arm, like the Whirlpool (M51) and NGC 5195.',
    galaxies: [
      { mass: 16, a: 1.8, rd: 3.5, rmin: 0.8, rmax: 13, share: 0.85, incl: 20, node: 0, spin: 1, tint: 0 },
      { mass: 4, a: 1.0, rd: 1.2, rmin: 0.4, rmax: 3.5, share: 0.15, incl: 70, node: 90, spin: 1, tint: 1 },
    ],
    orbit: { q: 11, e: 1, r0: 70 },
  },
  {
    id: 'mwm31', name: 'Milky Way meets Andromeda', self: false, dt: 0.06, view: 1100, friction: 0.9,
    blurb: 'Today’s measured separation (770 kpc) and approach speed (110 km/s radial, ~20 km/s sideways). First close passage comes in roughly four billion years.',
    galaxies: [
      { mass: 100, a: 12, rd: 3.5, rmin: 1, rmax: 18, share: 0.42, incl: 60, node: 20, spin: 1, tint: 0 },
      { mass: 150, a: 14, rd: 5, rmin: 1.2, rmax: 26, share: 0.58, incl: 77, node: 200, spin: 1, tint: 1 },
    ],
    orbit: { r: [770, 0, 0], v: [-110 / VEL_UNIT_KMS, 20 / VEL_UNIT_KMS, 0] },
  },
  {
    id: 'collapse', name: 'Cluster collapse', self: true, dt: 0.01, view: 34, friction: 0,
    blurb: 'A cold, self-gravitating cloud of stars. Every star attracts every other. It falls together, overshoots, and relaxes violently into a dense core with a halo of ejected stars.',
  },
];

class GravityLab {
  private scene = new Scene();
  private camera = new PerspectiveCamera(45, 1, 0.1, 1e5);
  private composer: EffectComposer | null = null;
  private quadScene = new Scene();
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private velMat: ShaderMaterial | null = null;
  private posMat: ShaderMaterial;
  private copyMat: ShaderMaterial;
  private rtPos: WebGLRenderTarget[] = [];
  private rtVel: WebGLRenderTarget[] = [];
  private flip = 0;
  private points: Points | null = null;
  private pointMat: ShaderMaterial;
  private corePoints: Points;
  private size = 0;
  private preset: Preset = PRESETS[0];
  private cores: { p: Vector3; v: Vector3; m: number; a: number }[] = [];
  private t = 0;
  private speed = 6;
  private paused = false;
  private frictionScale = 1;
  private minSep = Infinity;
  // camera
  private yaw = 0.5; private pitch = -0.9; private lnDist = Math.log(150);
  yawVel = 0; pitchVel = 0;
  active = false;
  private panel: HTMLElement;
  private readEl!: HTMLElement;
  private sizePx = new Vector2();

  constructor(private app: App, private ui: UI) {
    this.quad = new Mesh(new PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const base = { depthTest: false, depthWrite: false, blending: NoBlending, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }' };
    this.copyMat = new ShaderMaterial({ ...base, uniforms: { tSrc: { value: null } }, fragmentShader: 'uniform sampler2D tSrc; void main(){ gl_FragColor = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0); }' });
    this.posMat = new ShaderMaterial({
      ...base, uniforms: { tPos: { value: null }, tVel: { value: null }, uDt: { value: 0.02 } },
      fragmentShader: `uniform sampler2D tPos, tVel; uniform float uDt;
        void main(){ ivec2 c = ivec2(gl_FragCoord.xy); vec4 p = texelFetch(tPos, c, 0); vec4 v = texelFetch(tVel, c, 0); gl_FragColor = vec4(p.xyz + v.xyz * uDt, p.w); }`,
    });
    this.pointMat = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
      uniforms: { tPos: { value: null }, tVel: { value: null }, uPixelRatio: { value: 1 }, uGain: { value: 1 }, uSelf: { value: 0 }, uVref: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec2 aRef; uniform sampler2D tPos, tVel; uniform float uPixelRatio, uGain, uSelf, uVref;
        varying vec3 vColor;
        void main(){
          vec4 p = texelFetch(tPos, ivec2(aRef), 0); vec4 v = texelFetch(tVel, ivec2(aRef), 0);
          float sp = clamp(length(v.xyz) / uVref, 0.0, 1.6);
          vec3 warm = vec3(1.0, 0.80, 0.55), cool = vec3(0.55, 0.75, 1.0);
          vec3 c = mix(warm, cool, v.w);
          // self-gravity runs: colour by speed (cold blue -> hot white)
          vec3 cs = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.92, 0.75), smoothstep(0.1, 1.0, sp));
          vColor = mix(c * (0.55 + 0.5 * sp), cs * (0.5 + sp), uSelf) * uGain;
          vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
          gl_PointSize = (uSelf > 0.5 ? 2.6 : 1.7) * uPixelRatio;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vColor; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vColor * smoothstep(1.0, 0.2, r), 1.0); }`,
    });
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    this.corePoints = new Points(cg, new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: 'uniform float uPixelRatio; void main(){ gl_PointSize = 14.0 * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * pow(max(0.0, 1.0 - r), 3.0) * 0.9, 1.0); }',
    }));
    this.corePoints.frustumCulled = false;
    this.scene.add(this.corePoints);
    this.panel = document.getElementById('lab')!;
    this.buildPanel();
  }

  // ------------------------------------------------------------------ UI
  private buildPanel(): void {
    const p = this.panel;
    p.innerHTML = '';
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    p.append(el('div', 'lab-sub', 'Gravity lab · GPU N-body'));
    const title = el('h2'); title.id = 'lab-title';
    const blurb = el('p'); blurb.id = 'lab-blurb';
    p.append(title, blurb);
    const presets = el('div', 'lab-presets');
    for (const pr of PRESETS) {
      const b = el('button', '', pr.name); b.type = 'button'; b.dataset.id = pr.id;
      b.onclick = () => this.load(pr);
      presets.append(b);
    }
    p.append(presets);
    const range = (label: string, id: string, min: number, max: number, val: number, fn: (v: number) => void) => {
      const l = el('label', 'range', label);
      const i = el('input'); i.type = 'range'; i.id = id; i.min = String(min); i.max = String(max); i.step = '1'; i.value = String(val);
      i.oninput = () => fn(parseFloat(i.value));
      l.append(i); p.append(l);
    };
    range('Speed', 'lab-speed', 1, 24, this.speed, (v) => (this.speed = v));
    range('Dynamical friction', 'lab-friction', 0, 20, 10, (v) => (this.frictionScale = v / 10));
    this.readEl = el('div', 'lab-read');
    p.append(this.readEl);
    const actions = el('div', 'lab-actions');
    const pause = el('button', '', 'Pause'); pause.type = 'button';
    pause.onclick = () => { this.paused = !this.paused; pause.textContent = this.paused ? 'Resume' : 'Pause'; };
    const restart = el('button', '', 'Restart'); restart.type = 'button'; restart.onclick = () => this.load(this.preset);
    const exit = el('button', '', 'Back to the universe'); exit.type = 'button'; exit.onclick = () => this.toggle(false);
    actions.append(pause, restart, exit);
    p.append(actions);
    p.append(el('p', 'lab-note', 'Galaxy runs use the restricted N-body method: stars feel the galaxies’ cores but not each other, so bars and spiral instabilities are absent. The cluster run sums all pairwise forces. Drag to orbit, scroll to zoom.'));
  }

  // ------------------------------------------------------------------ setup
  private targets(n: number): void {
    for (const rt of [...this.rtPos, ...this.rtVel]) rt.dispose();
    const mk = () => new WebGLRenderTarget(n, n, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    this.rtPos = [mk(), mk()]; this.rtVel = [mk(), mk()];
    this.flip = 0;
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    const ref = new Float32Array(n * n * 2);
    for (let i = 0; i < n * n; i++) { ref[i * 2] = i % n; ref[i * 2 + 1] = Math.floor(i / n); }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('aRef', new BufferAttribute(ref, 2));
    this.points = new Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.size = n;
  }

  private velocityMaterial(self: boolean, n: number): ShaderMaterial {
    return new ShaderMaterial({
      depthTest: false, depthWrite: false, blending: NoBlending,
      defines: self ? { SELF: 1, NSIDE: n } : {},
      uniforms: {
        tPos: { value: null }, tVel: { value: null }, uDt: { value: 0.02 }, uSoft2: { value: 0.09 },
        uCore: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] }, uEps2: { value: [1, 1, 1, 1] }, uNCore: { value: 0 },
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tPos, tVel; uniform float uDt, uSoft2; uniform vec4 uCore[4]; uniform float uEps2[4]; uniform int uNCore;
        void main(){
          ivec2 c = ivec2(gl_FragCoord.xy);
          vec4 p = texelFetch(tPos, c, 0); vec4 v = texelFetch(tVel, c, 0);
          vec3 a = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            if (i >= uNCore) break;
            vec3 d = uCore[i].xyz - p.xyz; float r2 = dot(d, d) + uEps2[i];
            a += uCore[i].w * d / (r2 * sqrt(r2));
          }
        #ifdef SELF
          for (int y = 0; y < NSIDE; y++) for (int x = 0; x < NSIDE; x++) {
            vec4 q = texelFetch(tPos, ivec2(x, y), 0);
            vec3 d = q.xyz - p.xyz; float r2 = dot(d, d) + uSoft2;
            a += q.w * d / (r2 * sqrt(r2));
          }
        #endif
          gl_FragColor = vec4(v.xyz + a * uDt, v.w);
        }`,
    });
  }

  load(preset: Preset): void {
    this.preset = preset;
    const q = this.app.quality;
    const n = preset.self ? (q.name === 'low' ? 40 : q.name === 'medium' ? 64 : q.name === 'high' ? 80 : 96) : q.labSize;
    if (n !== this.size) this.targets(n);
    this.velMat?.dispose();
    this.velMat = this.velocityMaterial(preset.self, n);
    const N = n * n;
    const pos = new Float32Array(N * 4), vel = new Float32Array(N * 4);
    let seed = 1234567;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
    this.cores = [];
    this.t = 0; this.minSep = Infinity;
    if (preset.self) {
      // cold, slightly lumpy uniform sphere: total mass 10 (1e11 Msun), radius 10 kpc, virial ratio ~0.05
      const M = 10, R = 10;
      for (let i = 0; i < N; i++) {
        let x = 0, y = 0, z = 0;
        do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
        pos.set([x * R, y * R, z * R * 0.8, M / N], i * 4);
        vel.set([gauss() * 0.12, gauss() * 0.12, gauss() * 0.12, 0], i * 4);
      }
    } else {
      const g = preset.galaxies!;
      const M = g[0].mass + g[1].mass;
      let rel = new Vector3(), relV = new Vector3();
      const o = preset.orbit!;
      if ('q' in o) {
        // conic section through pericentre q with eccentricity e, starting at separation r0 on the inbound branch
        const p = o.q * (1 + o.e);
        const nu = -Math.acos(Math.max(-1, Math.min(1, (p / o.r0 - 1) / o.e)));
        const h = Math.sqrt(M * p);
        const vr = (M / h) * o.e * Math.sin(nu), vt = h / o.r0;
        rel.set(o.r0 * Math.cos(nu), 0, o.r0 * Math.sin(nu));
        relV.set(vr * Math.cos(nu) - vt * Math.sin(nu), 0, vr * Math.sin(nu) + vt * Math.cos(nu));
      } else {
        rel.set(o.r[0], o.r[2], o.r[1]); relV.set(o.v[0], o.v[2], o.v[1]);
      }
      // centre-of-mass frame
      this.cores.push({ p: rel.clone().multiplyScalar(-g[1].mass / M), v: relV.clone().multiplyScalar(-g[1].mass / M), m: g[0].mass, a: g[0].a });
      this.cores.push({ p: rel.clone().multiplyScalar(g[0].mass / M), v: relV.clone().multiplyScalar(g[0].mass / M), m: g[1].mass, a: g[1].a });
      let i = 0;
      g.forEach((gal, k) => {
        const count = k === g.length - 1 ? N - i : Math.floor(N * gal.share);
        const ci = Math.cos((gal.incl * Math.PI) / 180), si = Math.sin((gal.incl * Math.PI) / 180);
        const cn = Math.cos((gal.node * Math.PI) / 180), sn = Math.sin((gal.node * Math.PI) / 180);
        const core = this.cores[k];
        for (let c = 0; c < count; c++, i++) {
          // exponential disc, truncated; near-circular orbits in the core's Plummer potential
          let R = 0;
          do { R = -gal.rd * Math.log(Math.max(1e-9, rnd() * rnd())); } while (R < gal.rmin || R > gal.rmax);
          const th = rnd() * 2 * Math.PI;
          const vc = Math.sqrt((gal.mass * R * R) / Math.pow(R * R + gal.a * gal.a, 1.5)) * gal.spin;
          const sig = 0.03 * Math.abs(vc);
          // disc frame (y = normal)
          const lx = R * Math.cos(th), lz = R * Math.sin(th), ly = gauss() * 0.04 * gal.rd;
          const lvx = -vc * Math.sin(th) + gauss() * sig, lvz = vc * Math.cos(th) + gauss() * sig, lvy = gauss() * sig * 0.5;
          // incline about x, then rotate the node about y
          const rot = (x: number, y: number, z: number): [number, number, number] => {
            const y1 = y * ci - z * si, z1 = y * si + z * ci;
            return [x * cn + z1 * sn, y1, -x * sn + z1 * cn];
          };
          const [px, py, pz] = rot(lx, ly, lz), [vx, vy, vz] = rot(lvx, lvy, lvz);
          pos.set([core.p.x + px, core.p.y + py, core.p.z + pz, 0], i * 4);
          vel.set([core.v.x + vx, core.v.y + vy, core.v.z + vz, gal.tint], i * 4);
        }
      });
    }
    // upload initial state
    const renderer = this.app.engine.renderer;
    const up = (data: Float32Array, rt: WebGLRenderTarget) => {
      const tex = new DataTexture(data, n, n, RGBAFormat, FloatType);
      tex.minFilter = tex.magFilter = NearestFilter; tex.needsUpdate = true;
      this.copyMat.uniforms.tSrc.value = tex;
      this.quad.material = this.copyMat;
      renderer.setRenderTarget(rt);
      renderer.render(this.quadScene, this.quadCam);
      tex.dispose();
    };
    up(pos, this.rtPos[0]); up(vel, this.rtVel[0]);
    renderer.setRenderTarget(null);
    this.flip = 0;
    this.lnDist = Math.log(preset.view);
    this.pointMat.uniforms.uSelf.value = preset.self ? 1 : 0;
    this.pointMat.uniforms.uVref.value = preset.self ? 1.2 : Math.sqrt(preset.galaxies![0].mass / (2.6 * preset.galaxies![0].a));
    this.pointMat.uniforms.uGain.value = preset.self ? 0.5 : Math.min(0.5, 0.055 * Math.sqrt(65536 / N) + 0.035);
    document.getElementById('lab-title')!.textContent = preset.name;
    document.getElementById('lab-blurb')!.textContent = preset.blurb;
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('.lab-presets button')) b.setAttribute('aria-pressed', String(b.dataset.id === preset.id));
    (document.getElementById('lab-friction') as HTMLInputElement).disabled = preset.self;
  }

  // ------------------------------------------------------------------ dynamics
  private stepCores(dt: number): void {
    const c = this.cores;
    if (c.length < 2) return;
    const [A, B] = c;
    const d = B.p.clone().sub(A.p);
    const eps2 = A.a * A.a + B.a * B.a;
    const r2 = d.lengthSq() + eps2;
    const f = 1 / (r2 * Math.sqrt(r2));
    const M = A.m + B.m;
    // dynamical friction: drag on the relative velocity while the haloes overlap
    const s = A.a + B.a;
    const overlap = 1 / Math.pow(1 + d.lengthSq() / (s * s * 9), 1.5);
    const gamma = this.preset.friction * this.frictionScale * 0.35 * Math.sqrt(M / (s * s * s)) * overlap;
    const dv = B.v.clone().sub(A.v);
    A.v.addScaledVector(d, B.m * f * dt).addScaledVector(dv, (gamma * B.m / M) * dt);
    B.v.addScaledVector(d, -A.m * f * dt).addScaledVector(dv, (-gamma * A.m / M) * dt);
    A.p.addScaledVector(A.v, dt); B.p.addScaledVector(B.v, dt);
    this.minSep = Math.min(this.minSep, A.p.distanceTo(B.p));
  }

  private step(): void {
    const renderer = this.app.engine.renderer;
    const vm = this.velMat!;
    const dt = this.preset.dt;
    const a = this.flip, b = 1 - a;
    const u = vm.uniforms;
    this.cores.forEach((c, i) => { (u.uCore.value[i] as Vector4).set(c.p.x, c.p.y, c.p.z, c.m); u.uEps2.value[i] = c.a * c.a; });
    u.uNCore.value = this.cores.length;
    u.uDt.value = dt;
    u.tPos.value = this.rtPos[a].texture; u.tVel.value = this.rtVel[a].texture;
    this.quad.material = vm;
    renderer.setRenderTarget(this.rtVel[b]);
    renderer.render(this.quadScene, this.quadCam);
    const pu = this.posMat.uniforms;
    pu.tPos.value = this.rtPos[a].texture; pu.tVel.value = this.rtVel[b].texture; pu.uDt.value = dt;
    this.quad.material = this.posMat;
    renderer.setRenderTarget(this.rtPos[b]);
    renderer.render(this.quadScene, this.quadCam);
    this.stepCores(dt);
    this.flip = b;
    this.t += dt;
  }

  // ------------------------------------------------------------------ camera controller (used by the UI while the lab is open)
  rotate(dYaw: number, dPitch: number): void { this.yaw += dYaw; this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dPitch)); }
  zoom(dLn: number): void { this.lnDist = Math.max(Math.log(2), Math.min(Math.log(6000), this.lnDist + dLn)); }

  render(dt: number): void {
    const eng = this.app.engine;
    const renderer = eng.renderer;
    if (!this.composer) {
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.45, 0.6, 0.7));
      this.composer.addPass(new OutputPass());
    }
    renderer.getSize(this.sizePx);
    this.composer.setPixelRatio(eng.pixelRatio);
    this.composer.setSize(eng.width, eng.height);
    if (!this.paused) {
      // direct summation is expensive: cap the work per frame
      const steps = this.preset.self ? Math.min(this.speed, 8) : this.speed;
      for (let i = 0; i < steps; i++) this.step();
    }
    const d = Math.exp(this.lnDist);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * cp * d, -Math.sin(this.pitch) * d, Math.cos(this.yaw) * cp * d);
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = eng.width / eng.height;
    this.camera.near = d * 0.01; this.camera.far = d * 100;
    this.camera.updateProjectionMatrix();
    const pm = this.pointMat.uniforms;
    pm.tPos.value = this.rtPos[this.flip].texture; pm.tVel.value = this.rtVel[this.flip].texture; pm.uPixelRatio.value = eng.pixelRatio;
    const cg = this.corePoints.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < 4; i++) { const c = this.cores[i]; cg.setXYZ(i, c ? c.p.x : 1e9, c ? c.p.y : 1e9, c ? c.p.z : 1e9); }
    cg.needsUpdate = true;
    (this.corePoints.material as ShaderMaterial).uniforms.uPixelRatio.value = eng.pixelRatio;
    renderer.setClearColor(0x000000, 1);
    this.composer.render(dt);
    // readout
    const myr = this.t * TIME_UNIT_MYR;
    const lines = [`t = ${myr < 1000 ? myr.toFixed(0) + ' Myr' : (myr / 1000).toFixed(2) + ' Gyr'}`, `${(this.size * this.size).toLocaleString('en-US')} ${this.preset.self ? 'mutually gravitating stars' : 'test stars'}`];
    if (this.cores.length === 2) {
      const sep = this.cores[0].p.distanceTo(this.cores[1].p);
      const v = this.cores[0].v.distanceTo(this.cores[1].v) * VEL_UNIT_KMS;
      lines.push(`separation ${sep.toFixed(1)} kpc · ${v.toFixed(0)} km/s`);
      if (isFinite(this.minSep)) lines.push(`closest approach ${this.minSep.toFixed(1)} kpc`);
    } else lines.push(`${(this.size * this.size).toLocaleString('en-US')}² force pairs per step`);
    const txt = lines.join('\n');
    if (this.readEl.textContent !== txt) { this.readEl.style.whiteSpace = 'pre'; this.readEl.textContent = txt; }
  }

  toggle(on: boolean): void {
    this.active = on;
    document.body.classList.toggle('lab-mode', on);
    this.panel.hidden = !on;
    document.getElementById('btn-lab')!.setAttribute('aria-pressed', String(on));
    this.app.engine.override = on ? { render: (dt) => this.render(dt) } : null;
    this.ui.controller = on ? this : null;
    if (on && !this.size) this.load(PRESETS[0]);
  }
}

export function installLab(app: App, ui: UI): void {
  const lab = new GravityLab(app, ui);
  ui.onLab = () => lab.toggle(!lab.active);
  (window as any).ueLab = lab;
}
