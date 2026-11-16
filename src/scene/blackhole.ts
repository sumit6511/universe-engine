// Black holes with general-relativistic light bending.
//
// Photons in the Schwarzschild metric obey the Binet equation u'' + u = (3/2) r_s u^2
// (u = 1/r).  In Cartesian form this is motion under the fictitious central acceleration
//     a = -(3/2) h^2 x / |x|^5,      h = |x cross v|     (units r_s = 1),
// which the fragment shader integrates for every pixel (velocity-Verlet, adaptive step).
// Rays that cross r = r_s are captured; rays that escape sample a cube map of the *actual*
// surrounding sky (stars, Milky Way, galaxies) rendered at the hole's position, so the
// Einstein ring you see is made of real catalogue objects.
//
// The accretion disc is a thin Keplerian disc from the innermost stable circular orbit
// (3 r_s) outward with the Shakura-Sunyaev temperature profile.  Each disc element's
// emission is shifted by g = (gravitational redshift) x (relativistic Doppler factor) and its
// bolometric intensity scales as g^4 T^4, giving the bright approaching side.

import {
  CubeTexture, HalfFloatType, LinearFilter, Mesh, NormalBlending, OrthographicCamera, PlaneGeometry, Quaternion, Scene, ShaderMaterial, Vector3,
  WebGLCubeRenderTarget, WebGLRenderer, WebGLRenderTarget, Matrix3, Matrix4,
} from 'three';
import type { App } from '../app';
import { AU_KM, C_KMS, KPC_KM, LY_KM, MPC_KM, PC_KM } from '../core/constants';
import { GALACTIC_CENTER_PC, raDecToWorld } from '../core/frames';
import type { FrameContext, System } from '../engine/engine';
import { Entity, type InfoData } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { BLACKBODY, NOISE } from '../shaders/common';
import { fmtDist, fmtDuration, sig } from '../ui/format';

const RS_PER_MSUN_KM = 2.95325008; // 2GM_sun/c^2

interface HoleDef {
  id: string; name: string; massSun: number; subtitle: string; blurb: string;
  anchor: (app: App) => Vector3;
  diskNormal: Vector3; diskOuter: number; diskTemp: number; diskGain: number;
  notes: string[];
}

const HOLES: HoleDef[] = [
  {
    id: 'sgra', name: 'Sagittarius A*', massSun: 4.297e6, subtitle: 'Supermassive black hole · centre of the Milky Way',
    blurb: 'Four million solar masses at the exact centre of our galaxy, weighed by tracking stars that orbit it at up to 3% of the speed of light. The Event Horizon Telescope imaged its shadow in 2022.',
    anchor: () => GALACTIC_CENTER_PC.clone(),
    diskNormal: new Vector3(0.25, 0.92, 0.3).normalize(), diskOuter: 13, diskTemp: 5200, diskGain: 1.0,
    notes: ['Mass: GRAVITY Collaboration (2022). The real accretion flow is hot, thick and faint; it is drawn here as a thin disc to show the relativistic optics.'],
  },
  {
    id: 'm87', name: 'M87*', massSun: 6.5e9, subtitle: 'Supermassive black hole · Virgo A',
    blurb: 'The first black hole ever imaged (EHT, 2019): 6.5 billion solar masses, with an event horizon larger than the orbit of Pluto, launching a jet 5,000 light-years long.',
    anchor: (app) => app.find('M87')?.anchor.clone() ?? raDecToWorld(187.706, 12.391, 16.8e6, new Vector3()),
    diskNormal: new Vector3(-0.4, 0.75, 0.52).normalize(), diskOuter: 15, diskTemp: 6000, diskGain: 1.1,
    notes: ['Mass and distance: Event Horizon Telescope Collaboration (2019). The relativistic jet is not modelled.'],
  },
  {
    id: 'cygx1', name: 'Cygnus X-1', massSun: 21.2, subtitle: 'Stellar-mass black hole · X-ray binary',
    blurb: 'The first widely accepted black hole: 21 solar masses, 7,200 light-years away, stripping gas from a blue supergiant companion. Its inner disc reaches millions of kelvin and shines in X-rays.',
    anchor: () => raDecToWorld(299.5903, 35.2016, 2220, new Vector3()),
    diskNormal: new Vector3(0.6, 0.7, -0.38).normalize(), diskOuter: 16, diskTemp: 9000, diskGain: 1.2,
    notes: ['Mass and distance: Miller-Jones et al. (2021). The companion star HDE 226868 is not drawn; disc colours are shifted into the visible for display.'],
  },
];

const B_MAX = 46; // impact parameter (r_s) inside which rays are traced
const FACES: [Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0)], [new Vector3(-1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1)], [new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0)], [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
];

class BlackHoles implements System {
  holes: { def: HoleDef; entity: Entity; rsKm: number; rel: Vector3 }[] = [];
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: ShaderMaterial;
  private cube: WebGLCubeRenderTarget;
  private active = -1;
  private lastCapture = -1e9;
  private captureFor = -1;
  private time = 0;
  private distRs = 0;

  constructor(private app: App) {
    const q = app.quality;
    this.cube = new WebGLCubeRenderTarget(q.name === 'low' ? 512 : 1024, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthBuffer: true });
    this.material = new ShaderMaterial({
      depthTest: false, depthWrite: false, transparent: true, blending: NormalBlending,
      defines: { STEPS: q.bhSteps },
      uniforms: {
        uEnv: { value: this.cube.texture as CubeTexture }, uCamPos: { value: new Vector3() }, uCamRot: { value: new Matrix3() },
        uTanHalf: { value: 0.5 }, uAspect: { value: 1 }, uTime: { value: 0 }, uDiskN: { value: new Vector3(0, 1, 0) },
        uDiskOuter: { value: 12 }, uDiskTemp: { value: 6000 }, uDiskGain: { value: 1 }, uStepK: { value: q.bhSteps < 120 ? 0.17 : q.bhSteps < 200 ? 0.11 : 0.08 },
      },
      vertexShader: `varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${BLACKBODY}
        uniform samplerCube uEnv;
        uniform vec3 uCamPos; uniform mat3 uCamRot; uniform float uTanHalf, uAspect, uTime;
        uniform vec3 uDiskN; uniform float uDiskOuter, uDiskTemp, uDiskGain, uStepK;
        varying vec2 vNdc;
        const float BMAX = ${B_MAX.toFixed(1)};
        const float RIN = 3.0;                       // innermost stable circular orbit, in r_s

        // emission of the disc where a (backward-traced) ray with direction v crosses it at p
        vec4 disc(vec3 p, vec3 v, float rObs){
          float r = length(p);
          if (r < RIN || r > uDiskOuter) return vec4(0.0);
          // Shakura-Sunyaev: T ~ r^-3/4 (1 - sqrt(r_in/r))^1/4, peaking at r = 49/36 r_in
          float T = pow(r / RIN, -0.75) * pow(1.0 - sqrt(RIN / r), 0.25) / 0.4880;
          // circular-orbit speed measured by a static observer: beta = sqrt(r_s / (2 (r - r_s)))
          float beta = sqrt(0.5 / (r - 1.0));
          vec3 tang = normalize(cross(uDiskN, p));
          float gammaL = 1.0 / sqrt(1.0 - beta * beta);
          float doppler = 1.0 / (gammaL * (1.0 - beta * dot(tang, -normalize(v))));
          float grav = sqrt((1.0 - 1.0 / r) / max(1.0 - 1.0 / rObs, 1e-3));
          float g = doppler * grav;
          // turbulent structure sheared by differential (Keplerian) rotation; two phases cross-faded
          vec3 e1 = normalize(cross(uDiskN, vec3(0.31, 0.11, 0.94))); vec3 e2 = cross(uDiskN, e1);
          float phi = atan(dot(p, e2), dot(p, e1));
          float omega = sqrt(0.5 / (r * r * r));
          float dens = 0.0;
          for (int k = 0; k < 2; k++) {
            float ph = mod(uTime * 0.6 + float(k) * 40.0, 80.0);
            float w = 1.0 - abs(ph - 40.0) / 40.0;
            float a = phi - omega * ph * 14.0;
            vec3 q = vec3(cos(a) * r, sin(a) * r, float(k) * 7.0);
            dens += w * (0.55 + 0.45 * snoise(q * 0.9) + 0.3 * snoise(q * 2.7));
          }
          float edge = smoothstep(RIN, RIN + 0.25, r) * smoothstep(uDiskOuter, uDiskOuter * 0.62, r);
          float I = pow(g, 4.0) * pow(T, 4.0) * (0.35 + dens) * edge;
          vec3 col = blackbody(uDiskTemp * T * g) * I * uDiskGain * 0.42;
          return vec4(col, clamp(edge * (0.55 + 0.6 * dens), 0.0, 0.97));
        }

        void main(){
          vec3 rd = normalize(uCamRot * vec3(vNdc.x * uAspect * uTanHalf, vNdc.y * uTanHalf, -1.0));
          vec3 ro = uCamPos;
          float rObs = length(ro);
          float along = -dot(ro, rd);
          float b = length(cross(ro, rd));
          if (b > BMAX || (along < 0.0 && rObs > BMAX)) discard;
          float RS = max(BMAX * 1.25, 0.0);
          vec3 p = ro;
          if (rObs > RS) p = ro + rd * (along - sqrt(RS * RS - b * b));      // skip straight to the traced region
          vec3 v = rd;
          float h2 = dot(cross(p, v), cross(p, v));
          vec3 col = vec3(0.0);
          float trans = 1.0;
          bool captured = false;
          float escapeR = max(RS, rObs) * 1.02;
          for (int i = 0; i < STEPS; i++) {
            float r = length(p);
            if (r < 1.0) { captured = true; break; }
            if (r > escapeR && dot(p, v) > 0.0) break;
            float dt = uStepK * r * clamp((r - 0.85) * 1.2, 0.12, 1.0);
            vec3 a0 = -1.5 * h2 * p / pow(r, 5.0);
            vec3 pn = p + v * dt + 0.5 * a0 * dt * dt;
            float rn = length(pn);
            vec3 a1 = -1.5 * h2 * pn / pow(rn, 5.0);
            vec3 vn = v + 0.5 * (a0 + a1) * dt;
            float y0 = dot(p, uDiskN), y1 = dot(pn, uDiskN);
            if (y0 * y1 < 0.0) {
              vec3 hit = mix(p, pn, y0 / (y0 - y1));
              vec4 d = disc(hit, mix(v, vn, y0 / (y0 - y1)), rObs);
              col += trans * d.rgb;
              trans *= 1.0 - d.a;
              if (trans < 0.01) break;
            }
            p = pn; v = vn;
          }
          if (!captured) {
            // gravitational blueshift of infalling starlight seen by a static observer near the hole
            float boost = 1.0 / max(1.0 - 1.0 / rObs, 0.05);
            col += trans * textureCube(uEnv, normalize(v)).rgb * min(boost, 3.0);
          }
          float alpha = smoothstep(BMAX, BMAX * 0.72, b);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);

    for (const def of HOLES) {
      const e = new Entity(`bh:${def.id}`, def.name, 'blackhole');
      e.anchor.copy(def.anchor(app));
      const rs = def.massSun * RS_PER_MSUN_KM;
      e.radiusKm = rs;
      e.minDistKm = rs * 2.2;
      e.viewDistKm = rs * 30;
      e.subtitle = def.subtitle;
      e.rank = 97;
      e.color = 0xffc98a;
      e.getInfo = () => this.info(def, e, rs);
      this.holes.push({ def, entity: e, rsKm: rs, rel: new Vector3() });
      app.registerEntity(e);
      app.addSearch({ text: `${def.name} black hole ${def.id === 'sgra' ? 'sgr a* galactic centre' : ''}`.toLowerCase(), label: def.name, sub: 'Black hole', weight: 185, get: () => e });
    }
    app.engine.systems.push(this);
    app.labelSystems.push(this);
    app.engine.beforeNear = (renderer, target) => this.render(renderer, target);
  }

  private info(def: HoleDef, e: Entity, rs: number): InfoData {
    const dKm = e.anchor.length() * PC_KM;
    const tIsco = (46.17 * rs) / C_KMS; // seconds: orbital period at 3 r_s
    const shadow = Math.sqrt(27) * rs;
    const r = this.active >= 0 && this.holes[this.active].entity === e ? this.distRs : NaN;
    const rows = [
      { k: 'Mass', v: `${sig(def.massSun, 3)} M☉` },
      { k: 'Schwarzschild radius rₛ', v: fmtDist(rs), hint: rs > 1e6 ? `${sig(rs / AU_KM, 3)} AU` : undefined },
      { k: 'Photon sphere', v: '1.5 rₛ', hint: fmtDist(rs * 1.5) },
      { k: 'Shadow diameter', v: `${sig(Math.sqrt(27), 4)} rₛ`, hint: fmtDist(shadow) },
      { k: 'Innermost stable orbit', v: '3 rₛ', hint: `period ${fmtDuration(tIsco / 86400)}` },
      { k: 'Shadow seen from Earth', v: `${sig((shadow / dKm) * 206264.8e6, 3)} µas` },
      { k: 'Distance from Sun', v: dKm > 1e6 * PC_KM ? `${sig(dKm / LY_KM / 1e6, 3)} million ly` : `${sig(dKm / LY_KM, 3)} ly`, hint: dKm > MPC_KM ? `${sig(dKm / MPC_KM, 3)} Mpc` : `${sig(dKm / KPC_KM, 3)} kpc` },
    ];
    if (isFinite(r) && r > 1) {
      rows.push({ k: 'Your distance', v: `${sig(r, 3)} rₛ` });
      rows.push({ k: 'Time dilation here', v: `${sig(Math.sqrt(1 - 1 / r), 4)}`, hint: 'seconds per far-away second' });
      if (r > 1.5) rows.push({ k: 'Circular orbit speed here', v: `${sig(Math.sqrt(0.5 / (r - 1)), 3)} c` });
    }
    return {
      title: def.name, subtitle: def.subtitle, blurb: def.blurb, rows,
      notes: [...def.notes, 'Light paths: Schwarzschild (non-rotating) geodesics traced per pixel. The background is the real sky around the hole, bent by its gravity.'],
    };
  }

  update(ctx: FrameContext): void {
    this.time = ctx.time;
    // the hole with the largest apparent size, if any is resolvable
    let best = -1, bestAng = 0;
    this.holes.forEach((h, i) => {
      ctx.rel(h.entity, h.rel);
      const ang = h.rsKm / Math.max(h.rel.length(), 1);
      if (ang > bestAng) { bestAng = ang; best = i; }
    });
    this.active = bestAng * ctx.pixelScale > 0.35 ? best : -1;
    if (this.active < 0) return;
    const h = this.holes[this.active];
    const u = this.material.uniforms;
    (u.uCamPos.value as Vector3).copy(h.rel).multiplyScalar(-1 / h.rsKm);
    this.distRs = h.rel.length() / h.rsKm;
    const cam = this.app.engine.near.camera;
    (u.uCamRot.value as Matrix3).setFromMatrix4(new Matrix4().makeRotationFromQuaternion(cam.quaternion));
    u.uTanHalf.value = Math.tan((cam.fov * Math.PI) / 360);
    u.uAspect.value = cam.aspect;
    u.uTime.value = ctx.time;
    u.uDiskN.value.copy(h.def.diskNormal);
    u.uDiskOuter.value = h.def.diskOuter;
    u.uDiskTemp.value = h.def.diskTemp;
    u.uDiskGain.value = h.def.diskGain;
  }

  /** Render the surrounding sky into the cube map (background layers only). */
  private capture(renderer: WebGLRenderer): void {
    const eng = this.app.engine;
    const layers = eng.layers.filter((l) => l.name !== 'near');
    const saved = layers.map((l) => ({ q: l.camera.quaternion.clone(), fov: l.camera.fov, aspect: l.camera.aspect }));
    const m = new Matrix4(), q = new Quaternion(), zero = new Vector3();
    for (let f = 0; f < 6; f++) {
      m.lookAt(zero, FACES[f][0], FACES[f][1]);
      q.setFromRotationMatrix(m);
      renderer.setRenderTarget(this.cube, f);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      for (const l of layers) {
        l.camera.quaternion.copy(q); l.camera.fov = 90; l.camera.aspect = 1;
        l.camera.updateProjectionMatrix(); l.camera.updateMatrixWorld(true);
        renderer.clearDepth();
        renderer.render(l.scene, l.camera);
      }
    }
    layers.forEach((l, i) => {
      l.camera.quaternion.copy(saved[i].q); l.camera.fov = saved[i].fov; l.camera.aspect = saved[i].aspect;
      l.camera.updateProjectionMatrix(); l.camera.updateMatrixWorld(true);
    });
  }

  private render(renderer: WebGLRenderer, target: WebGLRenderTarget): void {
    if (this.active < 0) return;
    if (this.captureFor !== this.active || this.time - this.lastCapture > 4) {
      this.capture(renderer);
      this.captureFor = this.active;
      this.lastCapture = this.time;
    }
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    const p = { x: 0, y: 0 };
    for (const h of this.holes) {
      const d = h.rel.length();
      const px = ((h.rsKm * 2.6) / Math.max(d, 1)) * ctx.pixelScale / ctx.pixelRatio;
      // show the name once the view is close enough for it to be the subject, or when it is the target
      const isTarget = ctx.rig.target === h.entity;
      const near = d < (h.def.id === 'sgra' ? 600 * PC_KM : h.def.id === 'm87' ? 3 * MPC_KM : 900 * PC_KM);
      if (!isTarget && !near) continue;
      if (!ctx.project(h.rel, p)) continue;
      add({ x: p.x, y: p.y, text: h.def.name, priority: isTarget ? 1200 : 94, color: '#ffc98a', entity: h.entity, offset: Math.min(120, Math.max(8, px + 6)), kind: 'star', key: `bh${h.def.id}` });
    }
  }
}

export function installBlackHoles(app: App): void {
  new BlackHoles(app);
}
