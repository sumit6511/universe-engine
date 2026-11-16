// Large-scale structure beyond the galaxy catalogue.
//
// A periodic LCDM realisation (see workers/zeldovich.worker.ts) is tiled out to the particle
// horizon with nested levels of detail: every doubling of distance from the Milky Way keeps a
// smaller random subsample of the box, drawn as proportionally larger and brighter splats so
// that the projected surface brightness is the same at every level.  Along our past light
// cone the growth factor follows D(z(r)), so structure is visibly smoother at high redshift,
// and no galaxies are drawn before the first ones formed.  The surface of last scattering
// (CMB) closes the observable universe at z = 1090.

import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Points, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import { LY_KM, MPC_KM } from '../core/constants';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { AGE_NOW_GYR, COSMO, HORIZON_MPC, LAST_SCATTERING_MPC, ageAt, comovingDistance, growthFactor, redshiftAtDistance } from '../physics/cosmology';
import { NOISE, REL, RELATIVITY } from '../shaders/common';
import { sig } from '../ui/format';
import type { ZeldovichResult } from '../workers/zeldovich.worker';

export const WEB_BOX_MPC = 640;
const LUT_N = 48;
const LUT_MAX = 14400; // Mpc
// Chebyshev half-extent (in tiles) of each LOD shell and the fraction of particles kept
const LEVELS: { half: number; frac: number }[] = [
  { half: 0, frac: 1 }, { half: 1, frac: 1 / 40 }, { half: 2, frac: 1 / 200 }, { half: 4, frac: 1 / 1500 },
  { half: 8, frac: 1 / 12000 }, { half: 16, frac: 1 / 100000 }, { half: 23, frac: 1 / 400000 },
];

export class CosmicWeb implements System {
  material: ShaderMaterial;
  levels: Points[] = [];
  cmb: Mesh;
  entity: Entity;
  ready = false;
  /** scale factor shown (1 = today) and whether distant regions are shown as they were when their light left */
  scaleFactor = 1;
  lightCone = true;
  enabled = true;
  stats = { sigma: 0, rmsPsi: 0, n: 0, ms: 0 };
  private rel = new Vector3();

  constructor(private engine: Engine) {
    const growth = new Float32Array(LUT_N), form = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
      const r = (i / (LUT_N - 1)) * LUT_MAX;
      const z = Math.min(redshiftAtDistance(Math.min(r, HORIZON_MPC * 0.999)), 3000);
      growth[i] = growthFactor(1 / (1 + z));
      // galaxies assemble between z ~ 20 and z ~ 8 (cosmic dawn)
      form[i] = Math.min(1, Math.max(0, (20 - z) / 12));
    }
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
      uniforms: {
        uPixelScale: { value: 1000 }, uPixelRatio: { value: 1 }, uGain: { value: 1 }, uD: { value: 1 }, uLightCone: { value: 1 },
        uGrowth: { value: growth }, uForm: { value: form }, uFog: { value: 1000 }, uLocalDim: { value: 1 }, uSplat: { value: 1.5 }, uFocus: { value: 100 }, uBeta: REL.uBeta,
      },
      vertexShader: /* glsl */ `
        ${RELATIVITY}
        attribute vec3 aPsi; attribute float aDens; attribute vec4 iOffset; attribute vec4 iSym;
        uniform float uPixelScale, uPixelRatio, uGain, uD, uLightCone, uFog, uLocalDim, uSplat, uFocus;
        uniform float uGrowth[${LUT_N}]; uniform float uForm[${LUT_N}];
        varying vec3 vColor;
        float lut(float tab[${LUT_N}], float r){
          float f = clamp(r / ${LUT_MAX.toFixed(1)}, 0.0, 1.0) * ${(LUT_N - 1).toFixed(1)};
          int i = int(floor(f)); int j = min(i + 1, ${LUT_N - 1});
          return mix(tab[i], tab[j], f - float(i));
        }
        // one of the 48 symmetries of the cube: distant tiles are flipped and permuted (and shifted
        // periodically) so the tiling never shows up as a lattice
        vec3 sym(vec3 v, float s){
          float perm = mod(s, 6.0), fl = floor(s / 6.0);
          vec3 r = perm < 1.0 ? v.xyz : perm < 2.0 ? v.yzx : perm < 3.0 ? v.zxy : perm < 4.0 ? v.xzy : perm < 5.0 ? v.zyx : v.yxz;
          return r * vec3(mod(fl, 2.0) < 1.0 ? 1.0 : -1.0, mod(floor(fl / 2.0), 2.0) < 1.0 ? 1.0 : -1.0, mod(floor(fl / 4.0), 2.0) < 1.0 ? 1.0 : -1.0);
        }
        void main(){
          const float L = ${WEB_BOX_MPC.toFixed(1)};
          vec3 q0 = mod(position + iSym.xyz + 0.5 * L, L) - 0.5 * L;
          vec3 q = sym(q0, iSym.w) + iOffset.xyz;
          vec3 psi = sym(aPsi, iSym.w);
          float r0 = length(q);
          // linear growth: today's amplitude scaled back to the epoch at which we see this region
          float D = uD * mix(1.0, lut(uGrowth, r0), uLightCone);
          vec3 x = q + psi * D;
          float r = length(x);
          float formed = mix(1.0, lut(uForm, r), uLightCone) * smoothstep(${HORIZON_MPC.toFixed(1)}, ${(LAST_SCATTERING_MPC - 300).toFixed(1)}, r);
          vec4 mv = modelViewMatrix * vec4(x, 1.0);
          float zv = -mv.z;
          float d = max(length(mv.xyz), 1e-6);
          float dop; mv.xyz = aberrate(mv.xyz, dop);
          // each splat stands for iOffset.w particles: slightly larger, considerably brighter
          float px = uSplat * pow(iOffset.w, 0.12) / d * uPixelScale;
          float s = max(px, 1.5 * uPixelRatio);
          float flux = pow(px / s, 1.5) * pow(iOffset.w, 0.62);
          // depth cue: emphasise a slab through the focus so filaments are not lost in projection
          float slab = exp(-pow((zv - uFocus) / (0.3 * uFocus), 2.0));
          float fog = mix(0.07, 1.0, slab) / (1.0 + (d / uFog) * (d / uFog));
          // colour by local density: voids dim blue, filaments blue-white, cluster nodes warm
          float t = clamp((aDens * D / max(uD, 1e-3) + 0.5) / 1.9, 0.0, 1.0);
          vec3 c = mix(vec3(0.20, 0.32, 0.85), vec3(0.62, 0.78, 1.0), smoothstep(0.0, 0.5, t));
          c = mix(c, vec3(1.0, 0.86, 0.62), smoothstep(0.55, 1.0, t));
          float lum = 0.10 + 2.2 * t * t * t;
          float local = mix(uLocalDim, 1.0, smoothstep(40.0, 260.0, r));
          vColor = c * lum * flux * fog * formed * local * uGain * dopplerTint(dop);
          gl_PointSize = min(s, 48.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = 0.0;
          if (dot(vColor, vec3(1.0)) < 4e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          float r2 = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) * 4.0;
          if (r2 > 1.0) discard;
          gl_FragColor = vec4(vColor * exp(-r2 * 3.0), 1.0);
        }`,
    });

    // Cosmic microwave background: the surface of last scattering, 13.9 Gpc away in every direction.
    this.cmb = new Mesh(new SphereGeometry(LAST_SCATTERING_MPC, 96, 48), new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, side: BackSide,
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = 0.0; }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uAlpha; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          // statistically isotropic Gaussian-looking field peaking near one degree (first acoustic peak)
          float t = 0.55 * snoise(d * 16.0) + 0.3 * snoise(d * 33.0 + 3.0) + 0.25 * snoise(d * 7.0 - 7.0) + 0.12 * snoise(d * 3.0 + 1.0);
          t = clamp(t * 0.9 + 0.5, 0.0, 1.0);
          // Planck-style palette: cold spots blue, hot spots orange-red (the real contrast is 1 part in 100,000)
          vec3 c = t < 0.5 ? mix(vec3(0.05, 0.12, 0.55), vec3(0.55, 0.75, 0.95), t * 2.0) : mix(vec3(0.95, 0.80, 0.50), vec3(0.85, 0.22, 0.08), t * 2.0 - 2.0 + 1.0);
          gl_FragColor = vec4(c * uAlpha, 1.0);
        }`,
    }));
    this.cmb.frustumCulled = false;
    engine.cosmic.root.add(this.cmb);

    const e = new Entity('universe', 'Observable Universe', 'region');
    e.radiusKm = HORIZON_MPC * MPC_KM;
    e.minDistKm = 100 * MPC_KM;
    e.viewDistKm = HORIZON_MPC * MPC_KM * 2.75;
    e.subtitle = 'Everything whose light has had time to reach us';
    e.rank = 20;
    e.searchTerms = 'observable universe cosmos cmb cosmic microwave background horizon';
    e.getInfo = () => ({
      title: 'Observable Universe', subtitle: e.subtitle,
      blurb: 'A sphere centred on us, bounded by the distance light could have travelled since the Big Bang. Because space has expanded while the light was in transit, its edge is now 46 billion light-years away. The outer shell shown is the cosmic microwave background, released when the universe was 380,000 years old.',
      rows: [
        { k: 'Age', v: `${sig(AGE_NOW_GYR, 4)} Gyr` },
        { k: 'Radius (comoving)', v: `${sig((HORIZON_MPC * MPC_KM) / LY_KM / 1e9, 3)} Gly`, hint: `${sig(HORIZON_MPC / 1000, 3)} Gpc` },
        { k: 'Distance to last scattering', v: `${sig((LAST_SCATTERING_MPC * MPC_KM) / LY_KM / 1e9, 3)} Gly`, hint: 'z = 1090' },
        { k: 'Hubble constant H₀', v: `${COSMO.H0} km/s/Mpc` },
        { k: 'Matter density Ωm', v: String(COSMO.Om), hint: `baryons ${sig(COSMO.Ob, 2)}` },
        { k: 'Dark energy ΩΛ', v: sig(COSMO.OL, 3) },
        { k: 'CMB temperature', v: `${COSMO.Tcmb} K` },
        { k: 'Fluctuation amplitude σ₈', v: String(COSMO.sigma8) },
        { k: 'Galaxies (estimated)', v: '~2 × 10¹¹ – 2 × 10¹²' },
      ],
      notes: [
        'Cosmology: flat ΛCDM with Planck 2018 parameters. All distances are comoving.',
        'Beyond the catalogued galaxies, structure is a statistical realisation of ΛCDM (Eisenstein–Hu power spectrum, Zel’dovich approximation): representative of the real universe, but not a map of it.',
        'Distant regions are drawn as they were when their light left: smoother at high redshift, and empty before the first galaxies (z > 20). The CMB pattern is illustrative.',
      ],
    });
    this.entity = e;
  }

  /** Build the nested LOD point clouds from a finished realisation. */
  setRealisation(res: ZeldovichResult): void {
    const n3 = res.n ** 3;
    const draw = Math.floor(n3 * this.engine.quality.webFraction);
    const thin = n3 / draw; // particles each drawn point stands for at level 0
    this.stats = { sigma: res.sigmaDelta, rmsPsi: res.rmsPsi, n: res.n, ms: res.ms };
    // put the origin on a moderately overdense particle near the box centre: we live in a filament, not a void
    let bi = 0, best = Infinity;
    for (let i = 0; i < Math.min(n3, 60000); i++) {
      const d = res.dens[i];
      if (d < 0.25 || d > 0.6) continue;
      const x = res.q[i * 3] + res.psi[i * 3], y = res.q[i * 3 + 1] + res.psi[i * 3 + 1], z = res.q[i * 3 + 2] + res.psi[i * 3 + 2];
      const r = x * x + y * y + z * z;
      if (r < best) { best = r; bi = i; }
    }
    const sx = res.q[bi * 3] + res.psi[bi * 3], sy = res.q[bi * 3 + 1] + res.psi[bi * 3 + 1], sz = res.q[bi * 3 + 2] + res.psi[bi * 3 + 2];
    for (let i = 0; i < n3; i++) { res.q[i * 3] -= sx; res.q[i * 3 + 1] -= sy; res.q[i * 3 + 2] -= sz; }

    let seed = 987654321;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    const pos = new BufferAttribute(res.q, 3), psi = new BufferAttribute(res.psi, 3), dens = new BufferAttribute(res.dens, 1);
    const L = res.boxMpc;
    for (let k = 0; k < LEVELS.length; k++) {
      const { half, frac } = LEVELS[k];
      const inner = k === 0 ? -1 : LEVELS[k - 1].half;
      const offs: number[] = [];
      const syms: number[] = [];
      const count = Math.max(1, Math.round(draw * frac));
      const weight = (thin * draw) / count / thin; // relative to a level-0 splat
      for (let x = -half; x <= half; x++) for (let y = -half; y <= half; y++) for (let z = -half; z <= half; z++) {
        if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= inner) continue;
        if (Math.hypot(x, y, z) * L > HORIZON_MPC + L) continue;
        offs.push(x * L, y * L, z * L, weight);
        if (k >= 2) syms.push((rnd() - 0.5) * L, (rnd() - 0.5) * L, (rnd() - 0.5) * L, Math.floor(rnd() * 48));
        else syms.push(0, 0, 0, 0);
      }
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('position', pos);
      geo.setAttribute('aPsi', psi);
      geo.setAttribute('aDens', dens);
      geo.setAttribute('iOffset', new InstancedBufferAttribute(new Float32Array(offs), 4));
      geo.setAttribute('iSym', new InstancedBufferAttribute(new Float32Array(syms), 4));
      geo.instanceCount = offs.length / 4;
      geo.setDrawRange(0, count);
      const pts = new Points(geo as unknown as BufferGeometry, this.material);
      pts.frustumCulled = false;
      this.engine.cosmic.root.add(pts);
      this.levels.push(pts);
    }
    this.ready = true;
  }

  get redshift(): number { return 1 / this.scaleFactor - 1; }
  get age(): number { return ageAt(this.scaleFactor); }

  update(ctx: FrameContext): void {
    const scaleMpc = ctx.distKm / MPC_KM;
    const u = this.material.uniforms;
    // fade in as the view leaves the Local Group
    const vis = this.enabled ? Math.min(1, Math.max(0, Math.log10(Math.max(scaleMpc, 1e-6) / 1.5) / 1.1)) : 0;
    for (const p of this.levels) p.visible = vis > 0.01;
    u.uPixelScale.value = ctx.pixelScale;
    u.uPixelRatio.value = ctx.pixelRatio;
    u.uD.value = growthFactor(this.scaleFactor);
    u.uLightCone.value = this.lightCone && this.scaleFactor > 0.999 ? 1 : 0;
    u.uFog.value = Math.max(60, scaleMpc * 3.2);
    u.uFocus.value = Math.max(1, scaleMpc);
    // keep exposure roughly constant: the column of splats along a sight line grows with the view scale
    const comp = 1 / (this.engine.quality.webFraction ** 0.6);
    u.uGain.value = vis * 1.5 * comp * Math.pow(Math.min(1, 90 / Math.max(scaleMpc, 1)), 0.36);
    u.uLocalDim.value = this.scaleFactor > 0.999 ? 0.3 : 1; // let the real catalogue stand out nearby
    u.uSplat.value = 1.6;
    const cu = (this.cmb.material as ShaderMaterial).uniforms;
    const a = this.enabled ? Math.min(1, Math.max(0, Math.log10(Math.max(scaleMpc, 1) / 2500) / 0.7)) : 0;
    cu.uAlpha.value = 0.05 * a;
    this.cmb.visible = a > 0.01;
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    const scaleMpc = ctx.distKm / MPC_KM;
    if (!this.enabled || scaleMpc < 3000) return;
    const p = { x: 0, y: 0 };
    ctx.rel(this.entity, this.rel);
    if (ctx.project(this.rel, p)) add({ x: p.x, y: p.y, text: 'You are here', priority: 99, color: '#ffe6c0', entity: this.entity, offset: 8, kind: 'region', key: 'here' });
    // rim labels
    const cam = this.engine.cosmic.camera;
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const v = this.rel.clone().addScaledVector(up, LAST_SCATTERING_MPC * MPC_KM);
    if (ctx.project(v, p)) add({ x: p.x, y: p.y - 14, text: 'Cosmic microwave background · z = 1090', priority: 98, color: '#ffb48a', kind: 'region', offset: 0, key: 'cmb' });
    const z10 = comovingDistance(10) * MPC_KM;
    const v2 = this.rel.clone().addScaledVector(up, -z10);
    if (ctx.project(v2, p)) add({ x: p.x, y: p.y, text: 'First galaxies · z ≈ 10', priority: 97, color: '#9fb2d9', kind: 'region', offset: 0, key: 'z10' });
  }
}
