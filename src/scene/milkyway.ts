// A particle model of the Milky Way built from published structural parameters:
//
//   * spiral arms: log-periodic segments fitted to maser parallaxes (Reid et al. 2019, Table 2),
//     extrapolated to the unobserved far side with constant pitch
//   * Sun at R0 = 8.15 kpc (Reid+ 2019), 20.8 pc above the plane (Bennett & Bovy 2019)
//   * thin disc scale length 2.6 kpc, scale height 300 pc; bar angle 27 deg
//     (Bland-Hawthorn & Gerhard 2016)
//
// Each particle stands for a population of stars and is drawn as a splat of fixed physical
// size, so surface brightness is conserved at every zoom level and the same model yields both
// the face-on galaxy and the band of light seen from inside the disc.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { DEG, KPC_KM, LY_KM, PC_KM, TAU } from '../core/constants';
import { GALACTIC_CENTER_PC, R0_PC, Z0_PC, galToWorld, galacticToWorldMatrix } from '../core/frames';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { blackbodyRGB } from '../physics/stellar';

interface ArmDef { name: string; betaK: number; Rk: number; psiIn: number; psiOut: number; range: [number, number]; width: number; weight: number; extend: boolean }

// Reid et al. (2019) Table 2.  beta: galactocentric azimuth, 0 toward the Sun, increasing with
// Galactic rotation; ln(R/Rk) = -(beta - betaK) tan(psi); psiIn applies for beta <= betaK.
export const ARMS: ArmDef[] = [
  { name: 'Norma Arm', betaK: 18, Rk: 4.46, psiIn: -1.0, psiOut: 19.5, range: [5, 54], width: 0.14, weight: 0.9, extend: true },
  { name: 'Scutum–Centaurus Arm', betaK: 23, Rk: 4.91, psiIn: 14.1, psiOut: 12.1, range: [0, 104], width: 0.23, weight: 1.15, extend: true },
  { name: 'Sagittarius–Carina Arm', betaK: 24, Rk: 6.04, psiIn: 17.1, psiOut: 1.0, range: [2, 97], width: 0.27, weight: 1.0, extend: true },
  { name: 'Orion Spur (Local Arm)', betaK: 9, Rk: 8.26, psiIn: 11.4, psiOut: 11.4, range: [-8, 34], width: 0.31, weight: 0.45, extend: false },
  { name: 'Perseus Arm', betaK: 40, Rk: 8.87, psiIn: 10.3, psiOut: 8.7, range: [-23, 115], width: 0.35, weight: 1.15, extend: true },
  { name: 'Outer Arm', betaK: 18, Rk: 12.24, psiIn: 3.0, psiOut: 9.4, range: [-16, 71], width: 0.65, weight: 0.5, extend: false },
];

const R_MIN = 3.3, R_MAX = 15.5;
const EXT_PITCH = 12.5 * DEG;

/** Tabulated centre line of an arm: arrays of azimuth (rad) and radius (kpc), from outer to inner end. */
function traceArm(a: ArmDef): { beta: Float64Array; R: Float64Array; cum: Float64Array } {
  const pts: [number, number][] = [];
  const step = 0.5 * DEG;
  const pitch = (beta: number) => {
    const p = (beta <= a.betaK * DEG ? a.psiIn : a.psiOut) * DEG;
    const inData = beta >= a.range[0] * DEG && beta <= a.range[1] * DEG;
    return inData ? p : Math.abs(p) < 6 * DEG ? EXT_PITCH : p;
  };
  // integrate outward (decreasing beta) and inward (increasing beta) from the kink
  const maxExt = a.extend ? 260 * DEG : 12 * DEG;
  let beta = a.betaK * DEG, lnR = Math.log(a.Rk);
  const out: [number, number][] = [];
  while (Math.exp(lnR) < R_MAX && beta > a.range[0] * DEG - maxExt) { beta -= step; lnR += step * Math.tan(pitch(beta)); out.push([beta, Math.exp(lnR)]); }
  out.reverse();
  pts.push(...out, [a.betaK * DEG, a.Rk]);
  beta = a.betaK * DEG; lnR = Math.log(a.Rk);
  while (Math.exp(lnR) > R_MIN && beta < a.range[1] * DEG + maxExt) { beta += step; lnR -= step * Math.tan(pitch(beta)); pts.push([beta, Math.exp(lnR)]); }
  const n = pts.length;
  const B = new Float64Array(n), R = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    B[i] = pts[i][0]; R[i] = pts[i][1];
    if (i > 0) {
      const ds = Math.hypot(R[i] - R[i - 1], R[i] * (B[i] - B[i - 1]));
      // stellar surface density falls off exponentially with radius; taper the very ends
      const taper = Math.min(1, (R_MAX - R[i]) / 2.5) * Math.min(1, (R[i] - R_MIN + 0.3) / 0.8);
      cum[i] = cum[i - 1] + ds * Math.exp(-(R[i] - 4) / 4.2) * Math.max(0.02, taper);
    }
  }
  return { beta: B, R, cum };
}

/** Galactocentric cartesian (kpc, galactic axes) of azimuth beta, radius R. */
function armXY(beta: number, R: number): [number, number] {
  return [-R * Math.cos(beta), R * Math.sin(beta)];
}

// small deterministic PRNG so the galaxy is identical on every load
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MilkyWay implements System {
  points: Points;
  material: ShaderMaterial;
  entity: Entity;
  group = new Group();
  private armLabels: { name: string; pos: Vector3 }[] = [];
  private rel = new Vector3();
  private v = new Vector3();

  constructor(private engine: Engine) {
    const layer = engine.galactic;
    layer.originPc.copy(GALACTIC_CENTER_PC);
    this.group.quaternion.copy(new Quaternion().setFromRotationMatrix(galacticToWorldMatrix()));
    layer.root.add(this.group);

    const N = engine.quality.galaxyParticles;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const rnd = mulberry(20260611);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(TAU * rnd());
    const arms = ARMS.map(traceArm);
    const rgb = [0, 0, 0];

    // distance (kpc) from the nearest arm centre line, signed: negative = inside (concave side)
    const armOffset = (x: number, y: number): number => {
      const R = Math.hypot(x, y);
      const b0 = Math.atan2(y, -x);
      let best = 99;
      for (let k = 0; k < arms.length; k++) {
        const t = arms[k];
        const n = t.beta.length;
        for (let w = -1; w <= 2; w++) {
          const b = b0 + w * TAU;
          if (b < t.beta[0] || b > t.beta[n - 1]) continue;
          const f = ((b - t.beta[0]) / (t.beta[n - 1] - t.beta[0])) * (n - 1);
          const i = Math.min(n - 2, Math.floor(f));
          const Ra = t.R[i] + (t.R[i + 1] - t.R[i]) * (f - i);
          if (Math.abs(R - Ra) < Math.abs(best)) best = R - Ra;
        }
      }
      return best;
    };
    const dust = (x: number, y: number): number => {
      const R = Math.hypot(x, y);
      if (R < 2.8) return 0;
      const d = armOffset(x, y);
      return 0.72 * Math.exp(-(((d + 0.42) / 0.2) ** 2)) * Math.min(1, (R - 2.8) / 1.5);
    };

    let i = 0;
    const put = (x: number, y: number, z: number, T: number, lum: number, sz: number, tint?: [number, number, number]) => {
      if (i >= N) return;
      pos[i * 3] = x * 1000; pos[i * 3 + 1] = y * 1000; pos[i * 3 + 2] = z * 1000;
      if (tint) { rgb[0] = tint[0]; rgb[1] = tint[1]; rgb[2] = tint[2]; } else blackbodyRGB(T, rgb);
      col[i * 3] = rgb[0] * lum; col[i * 3 + 1] = rgb[1] * lum; col[i * 3 + 2] = rgb[2] * lum;
      size[i] = sz;
      i++;
    };

    // --- bar and boxy bulge (old, cool stars) ---------------------------------------------
    const nBulge = Math.floor(N * 0.13);
    const ba = 27 * DEG;
    const ex: [number, number] = [-Math.cos(ba), Math.sin(ba)], ey: [number, number] = [-Math.sin(ba), -Math.cos(ba)];
    for (let k = 0; k < nBulge; k++) {
      const long = rnd() < 0.4;
      const a = gauss() * (long ? 2.1 : 0.9), b = gauss() * (long ? 0.42 : 0.55), z = gauss() * (long ? 0.16 : 0.42);
      const x = a * ex[0] + b * ey[0], y = a * ex[1] + b * ey[1];
      put(x, y, z, 3900 + 900 * rnd(), 0.3 + 0.25 * rnd(), 160 + 160 * rnd());
    }
    // --- smooth thin + thick disc ----------------------------------------------------------
    const nDisk = Math.floor(N * 0.36);
    for (let k = 0; k < nDisk; k++) {
      const thick = rnd() < 0.12;
      let R = -(thick ? 2.1 : 2.6) * Math.log(Math.max(1e-9, rnd() * rnd()));
      if (R > 17) { k--; continue; }
      const th = rnd() * TAU;
      const x = R * Math.cos(th), y = R * Math.sin(th);
      const h = thick ? 0.9 : 0.3;
      const z = 0.5 * h * Math.atanh(Math.max(-0.999, Math.min(0.999, 2 * rnd() - 1)));
      const dk = dust(x, y) * Math.exp(-Math.abs(z) / 0.12);
      const T = (thick ? 4300 : 4700) + 1500 * rnd() - 900 * dk;
      put(x, y, z, T, (thick ? 0.3 : 0.55) * (0.6 + 0.8 * rnd()) * (1 - dk), 150 + 200 * rnd());
    }
    // --- spiral arms: young blue stars, OB associations and H II regions -------------------
    const nArm = Math.floor(N * 0.44);
    const totalW = ARMS.reduce((s, a, k) => s + a.weight * arms[k].cum[arms[k].cum.length - 1], 0);
    for (let k = 0; k < ARMS.length; k++) {
      const t = arms[k], a = ARMS[k];
      const cumEnd = t.cum[t.cum.length - 1];
      const n = Math.floor((nArm * a.weight * cumEnd) / totalW);
      const sample = (): [number, number, number] => {
        const u = rnd() * cumEnd;
        let lo = 0, hi = t.cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.cum[mid] < u) lo = mid; else hi = mid; }
        const f = (u - t.cum[lo]) / Math.max(1e-12, t.cum[hi] - t.cum[lo]);
        const beta = t.beta[lo] + (t.beta[hi] - t.beta[lo]) * f, R = t.R[lo] + (t.R[hi] - t.R[lo]) * f;
        return [beta, R, (0.336 + 0.036 * (R - 8.15)) * (a.width / 0.3) * 1.25];
      };
      let c = 0;
      while (c < n) {
        const [beta, R, w] = sample();
        const clump = rnd() < 0.55;
        const members = clump ? 6 + Math.floor(rnd() * 22) : 1;
        // star formation trails the dust lane: shift the young population slightly outward
        const dR = gauss() * w * 0.75 + 0.12, dB = (gauss() * w * 0.5) / R;
        const [cx, cy] = armXY(beta + dB, R + dR);
        const cz = gauss() * 0.06;
        const hii = clump && rnd() < 0.3;
        for (let m = 0; m < members && c < n; m++, c++) {
          const s = clump ? 0.05 + 0.1 * rnd() : 0;
          const x = cx + gauss() * s, y = cy + gauss() * s, z = cz + gauss() * (clump ? 0.03 : 0.05);
          if (hii && m < 2) put(x, y, z, 0, 0.9 + 0.6 * rnd(), 90 + 110 * rnd(), [1.0, 0.28, 0.42]); // H-alpha
          else {
            const young = rnd() < 0.7;
            put(x, y, z, young ? 9000 + 16000 * rnd() * rnd() : 5200 + 1500 * rnd(), (young ? 0.75 : 0.5) * (0.5 + rnd()), clump ? 55 + 70 * rnd() : 110 + 150 * rnd());
          }
        }
      }
    }
    // --- stellar halo and globular clusters -------------------------------------------------
    while (i < N) {
      const gc = rnd() < 0.12;
      const r = 1.2 * Math.pow(Math.max(1e-6, rnd()), -0.75) * (gc ? 1.6 : 1);
      if (r > 32) continue;
      const u = 2 * rnd() - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
      put(r * s * Math.cos(th), r * s * Math.sin(th), r * u * 0.8, gc ? 5600 : 4600, gc ? 1.6 : 0.16, gc ? 40 : 260);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, vertexColors: true,
      uniforms: { uPixelScale: { value: 1000 }, uPixelRatio: { value: 1 }, uGain: { value: 1 }, uNearFade: { value: 400 }, uMaxPx: { value: 220 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uPixelScale, uPixelRatio, uGain, uNearFade, uMaxPx;
        varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(length(mv.xyz), 1e-3);
          float px = aSize / d * uPixelScale;                 // true diameter in device pixels
          float s = max(px, 1.7 * uPixelRatio);
          float flux = pow(px / s, 1.6);                       // unresolved: (nearly) conserve flux
          float fade = smoothstep(uNearFade * 0.4, uNearFade * 1.6, d) * (1.0 - smoothstep(uMaxPx * 0.5, uMaxPx, s));
          vColor = color * uGain * flux * fade;
          gl_PointSize = min(s, uMaxPx);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = 0.0;
          if (fade * flux < 1e-4) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          float r2 = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) * 4.0;
          if (r2 > 1.0) discard;
          gl_FragColor = vec4(vColor * exp(-r2 * 3.5), 1.0);
        }`,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    for (const a of ARMS) {
      const beta = (a.name.startsWith('Orion') ? 22 : a.name.startsWith('Outer') ? 40 : a.betaK + 38) * DEG;
      const t = traceArm(a);
      let j = 0; while (j < t.beta.length - 1 && t.beta[j] < beta) j++;
      const [x, y] = armXY(t.beta[j], t.R[j]);
      this.armLabels.push({ name: a.name, pos: this.galToAnchor(x, y, 0) });
    }
    this.armLabels.push({ name: 'Galactic Bar', pos: this.galToAnchor(ex[0] * 2.6, ex[1] * 2.6, 0) });

    const e = new Entity('milkyway', 'Milky Way', 'galaxy');
    e.anchor.copy(GALACTIC_CENTER_PC);
    e.radiusKm = 16 * KPC_KM;
    e.minDistKm = 0.4 * KPC_KM;
    e.viewDistKm = 46 * KPC_KM;
    e.subtitle = 'Barred spiral galaxy · SBbc';
    e.rank = 95;
    e.color = 0xffe6c0;
    e.searchTerms = 'milky way galaxy home';
    e.getInfo = () => ({
      title: 'Milky Way', subtitle: e.subtitle,
      blurb: 'Our home galaxy: a barred spiral of a few hundred billion stars. The Sun orbits 26,600 light-years from the centre at about 236 km/s, completing a circuit every ~212 million years.',
      rows: [
        { k: 'Stellar disc diameter', v: '~100,000 ly', hint: '~30 kpc' },
        { k: 'Stellar mass', v: '~6 × 10¹⁰ M☉' },
        { k: 'Total mass (incl. dark matter)', v: '~1.3 × 10¹² M☉' },
        { k: 'Number of stars', v: '100–400 billion' },
        { k: 'Sun–centre distance R₀', v: '8.15 kpc', hint: 'Reid et al. 2019' },
        { k: 'Sun height above plane', v: '20.8 pc', hint: 'Bennett & Bovy 2019' },
        { k: 'Circular speed at Sun', v: '236 km/s' },
        { k: 'Galactic year', v: '~212 Myr' },
        { k: 'Thin-disc scale length', v: '2.6 kpc' },
        { k: 'Bar orientation', v: '27° to the Sun–centre line' },
        { k: 'Central black hole', v: 'Sagittarius A*, 4.3 × 10⁶ M☉' },
      ],
      notes: [
        'Arms follow the log-spiral segments fitted to maser parallaxes by Reid et al. (2019). The far side of the Galaxy is hidden from us by dust; arms there are extrapolated with constant pitch.',
        `Model: ${N.toLocaleString('en-US')} particles; individual stars come from the HYG catalogue near the Sun.`,
      ],
    });
    this.entity = e;
  }

  private galToAnchor(xk: number, yk: number, zk: number): Vector3 {
    // galactocentric kpc (galactic axes) -> heliocentric world parsecs
    return galToWorld(xk * 1000 + R0_PC, yk * 1000, zk * 1000 - Z0_PC, new Vector3());
  }

  update(ctx: FrameContext): void {
    const u = this.material.uniforms;
    u.uPixelScale.value = ctx.pixelScale;
    u.uPixelRatio.value = ctx.pixelRatio;
    // camera distance from the galactic centre decides the look: inside the disc we want the faint band
    // of the night sky, outside the full galaxy
    const dGC = this.v.copy(ctx.rig.anchor).addScaledVector(ctx.rig.local, 1 / PC_KM).sub(GALACTIC_CENTER_PC).length();
    const scalePc = ctx.distKm / PC_KM;
    const outside = Math.min(1, Math.max(0, Math.log10(Math.max(scalePc, 1) / 150) / 1.5));
    // far away the galaxy shrinks to a few pixels: lift it so the Local Group stays readable
    const far = 1 + 3.5 * Math.min(1, Math.max(0, Math.log10(Math.max(scalePc, 1) / 1.5e5) / 1.2));
    u.uGain.value = (0.0045 + 0.075 * outside * outside) * (0.6 + 0.4 * Math.min(1, dGC / 20000)) * far;
    u.uMaxPx.value = (70 + 150 * outside) * ctx.pixelRatio;
    u.uNearFade.value = 250 + 250 * outside;
    this.points.visible = dGC < 4e8; // beyond ~400 Mpc it is far below a pixel
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    const scale = ctx.distKm / KPC_KM;
    const p = { x: 0, y: 0 };
    if (scale > 0.02 && scale < 3000) {
      ctx.rel(this.entity, this.rel);
      if (ctx.project(this.rel, p)) add({ x: p.x, y: p.y, text: scale > 150 ? 'Milky Way' : 'Galactic Centre', priority: 96, color: '#ffe6c0', entity: this.entity, offset: 10, kind: 'galaxy', key: 'mw' });
    }
    if (scale > 6 && scale < 160) {
      for (const a of this.armLabels) {
        this.v.subVectors(a.pos, ctx.rig.anchor).multiplyScalar(PC_KM).sub(ctx.rig.local);
        if (ctx.project(this.v, p)) add({ x: p.x, y: p.y, text: a.name, priority: 30, color: '#9fb2d9', kind: 'region', offset: 0, alpha: 0.85 });
      }
    }
  }
}

export const MILKY_WAY_FACTS = { R0_LY: (R0_PC * PC_KM) / LY_KM };
