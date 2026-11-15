// Real galaxies: ~10,000 NGC/IC galaxies (OpenNGC) plus Local Group dwarfs, placed in 3D.
// Distances: measured (TRGB/Cepheid/SBF) where available, cluster distances inside rich
// clusters (removing redshift-space "fingers of god"), Hubble-flow comoving distances otherwise.
// Each galaxy is an instanced billboard whose fragment shader reconstructs an inclined disc
// or spheroid of the catalogued size, axis ratio, position angle and Hubble type.

import { AdditiveBlending, BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { C_KMS, KPC_KM, LY_KM, MPC_KM, PC_KM } from '../core/constants';
import { raDecToWorld, worldToRaDec } from '../core/frames';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity, type InfoData, type InfoRow } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { lookbackTime } from '../physics/cosmology';
import { NOISE } from '../shaders/common';
import { sig } from '../ui/format';

/** [name, messier, common name, hubble type, distance method (0 redshift, 1 cluster, 2 measured), z] */
export type GalaxyMetaRow = [string, string, string, string, number, number | null];
export interface GalaxiesMeta { count: number; stride: number; meta: GalaxyMetaRow[]; clusters: [string, number, number, number][] }

const TYPE_NAMES = ['Elliptical', 'Lenticular', 'Spiral', 'Barred spiral', 'Irregular'];
const _v = new Vector3();

// Large-scale landmarks: [name, RA deg, Dec deg, distance Mpc, description]
const LANDMARKS: [string, number, number, number, string][] = [
  ['Shapley Supercluster', 201.98, -31.5, 200, 'The largest concentration of galaxies in the nearby universe, about 650 million light-years away.'],
  ['Boötes Void', 218, 46, 215, 'A nearly empty region ~330 million light-years across containing only a few dozen known galaxies.'],
  ['Local Void', 279.5, 18, 23, 'A vast underdense region adjacent to the Local Group; our galaxy is moving away from it at ~260 km/s.'],
  ['Perseus–Pisces Supercluster', 23, 33, 70, 'A 300 million light-year long filament of galaxy clusters.'],
];

export class GalaxyField implements System {
  mesh: Mesh;
  material: ShaderMaterial;
  count: number;
  private entities = new Map<number, Entity>();
  private named: number[] = [];
  private clusterEntities: Entity[] = [];
  private camMpc = new Vector3();

  constructor(private engine: Engine, private data: Float32Array, private meta: GalaxiesMeta) {
    const n = (this.count = meta.count), st = meta.stride;
    const iPos = new Float32Array(n * 3), iNormal = new Float32Array(n * 3), iParams = new Float32Array(n * 4), iMajor = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * st;
      iPos.set(data.subarray(o, o + 3), i * 3);
      iNormal.set(data.subarray(o + 3, o + 6), i * 3);
      iParams.set(data.subarray(o + 6, o + 10), i * 4);
      iMajor.set(data.subarray(o + 10, o + 14), i * 4);
      const m = meta.meta[i];
      if (m[1] || m[2] || !/^(NGC|IC) /.test(m[0])) this.named.push(i);
    }
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iNormal', new InstancedBufferAttribute(iNormal, 3));
    geo.setAttribute('iParams', new InstancedBufferAttribute(iParams, 4));
    geo.setAttribute('iMajor', new InstancedBufferAttribute(iMajor, 4));
    geo.instanceCount = n;
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uPixelScale: { value: 1000 }, uPixelRatio: { value: 1 }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec3 iNormal; attribute vec4 iParams; attribute vec4 iMajor;
        uniform float uPixelScale, uPixelRatio, uGain;
        varying vec2 vUv; varying vec3 vN; varying vec3 vMaj; varying vec4 vParams; varying float vFlux; varying float vPx;
        void main(){
          vec4 c = modelViewMatrix * vec4(iPos, 1.0);
          float d = max(length(c.xyz), 1e-9);
          float R = iParams.x * 1.0e-3 * 1.7;                 // billboard half-size, Mpc
          float px = R / d * uPixelScale;
          float s = max(px, 2.1 * uPixelRatio);
          vPx = px;
          // unresolved galaxies fade more slowly than 1/d^2 so the large-scale structure stays readable
          float lum = clamp(pow(10.0, -0.4 * (iParams.y + 20.5)), 0.03, 6.0);
          vFlux = pow(px / s, 1.0) * uGain * pow(lum, 0.45);
          vec3 f = c.xyz / d;
          vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
          vec3 u = cross(r, f);
          vec3 p = c.xyz + (r * position.x + u * position.y) * (s / uPixelScale * d);
          vUv = position.xy * 1.7;
          vec3 nv = normalize(mat3(modelViewMatrix) * iNormal);
          vec3 mv = normalize(mat3(modelViewMatrix) * iMajor.xyz);
          vN = vec3(dot(nv, r), dot(nv, u), dot(nv, f));
          vMaj = vec3(dot(mv, r), dot(mv, u), dot(mv, f));
          vParams = vec4(iParams.z, iParams.w, iMajor.w, 0.0);
          gl_Position = projectionMatrix * vec4(p, 1.0);
          gl_Position.z = 0.0;
          if (c.z > 0.0 || vFlux < 2e-3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec2 vUv; varying vec3 vN; varying vec3 vMaj; varying vec4 vParams; varying float vFlux; varying float vPx;
        void main(){
          float type = vParams.x, seed = vParams.y, q = vParams.z;
          vec3 col;
          float rr = length(vUv);
          if (vPx < 2.5) {
            // unresolved: a soft point tinted by morphological type
            vec3 tint = type < 1.5 ? vec3(1.0, 0.84, 0.62) : type < 3.5 ? vec3(0.82, 0.88, 1.0) : vec3(0.68, 0.82, 1.0);
            col = tint * exp(-rr * rr * 2.2) * 0.9;
          } else if (type < 0.5) {
            // elliptical: flattened spheroid with a steep (de Vaucouleurs-like) profile
            vec2 m = normalize(vMaj.xy + vec2(1e-4, 0.0));
            vec2 k = vec2(-m.y, m.x);
            float rho = length(vec2(dot(vUv, m), dot(vUv, k) / max(q, 0.35)));
            float I = 1.6 / pow(1.0 + (rho / 0.09) * (rho / 0.09), 1.15) * smoothstep(1.7, 0.5, rho);
            col = vec3(1.0, 0.85, 0.64) * I;
          } else {
            // disc galaxy: intersect the sight line with the (slightly thickened) disc plane
            vec3 n = normalize(vN);
            float nz = sign(n.z + 1e-6) * max(abs(n.z), 0.16);
            vec3 p = vec3(vUv, -(dot(vUv, n.xy)) / nz);
            float r = length(p);
            vec3 e1 = normalize(vMaj - n * dot(vMaj, n) + vec3(1e-4, 0.0, 0.0));
            vec3 e2 = cross(n, e1);
            float th = atan(dot(p, e2), dot(p, e1));
            float edge = clamp(0.5 / abs(nz), 0.5, 1.8);                 // longer path length when inclined
            float disc = exp(-r / 0.27) * smoothstep(1.55, 0.9, r);
            float bulge = 1.3 * exp(-pow(length(vUv) / 0.085, 1.4));
            vec3 discCol = vec3(1.0, 0.92, 0.80);
            float arms = 0.0;
            if (type > 1.5 && type < 3.5) {
              float pitch = mix(0.20, 0.42, fract(seed * 7.31));
              float narm = fract(seed * 3.17) < 0.75 ? 2.0 : 3.0;
              float ph = th * narm - log(r + 0.03) / pitch * narm + seed * 40.0;
              float w = 0.5 + 0.5 * cos(ph);
              float nse = snoise(vec3(p.xy * 9.0, seed * 10.0)) * 0.5 + 0.5;
              arms = pow(w, 2.2) * smoothstep(0.07, 0.22, r) * (0.55 + 0.9 * nse);
              if (type > 2.5) {
                // bar
                float along = dot(p, e1), across = dot(p, e2);
                bulge += 0.9 * exp(-pow(abs(along) / 0.22, 2.0) - pow(abs(across) / 0.055, 2.0));
              }
              discCol = mix(vec3(1.0, 0.88, 0.70), vec3(0.62, 0.78, 1.0), clamp(arms, 0.0, 1.0));
              disc *= 0.35 + 1.5 * arms;
            } else if (type > 3.5) {
              float nse = snoise(vec3(p.xy * 5.0, seed * 20.0)) * 0.6 + snoise(vec3(p.xy * 13.0, seed * 3.0)) * 0.4;
              disc = exp(-r / 0.4) * smoothstep(1.5, 0.8, r) * (0.5 + 0.9 * max(nse + 0.4, 0.0));
              discCol = vec3(0.70, 0.82, 1.0);
              bulge *= 0.25;
            }
            col = discCol * disc * edge * 0.9 + vec3(1.0, 0.84, 0.62) * bulge;
            col *= smoothstep(1.7, 1.2, rr);
          }
          gl_FragColor = vec4(col * vFlux, 1.0);
        }`,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    engine.cosmic.root.add(this.mesh);

    for (const [name, x, y, z] of meta.clusters) {
      const e = new Entity(`cluster:${name}`, name, 'cluster');
      e.anchor.set(x * 1e6, y * 1e6, z * 1e6);
      e.radiusKm = 1.5 * MPC_KM;
      e.minDistKm = 0.3 * MPC_KM;
      e.viewDistKm = 9 * MPC_KM;
      e.subtitle = 'Galaxy cluster';
      e.rank = 40;
      e.getInfo = () => this.regionInfo(e, 'A gravitationally bound cluster of hundreds to thousands of galaxies embedded in hot X-ray gas and dark matter.' + (name.startsWith('Norma') ? ' It lies at the heart of the Great Attractor region, largely hidden behind the Milky Way.' : name.startsWith('Virgo') ? ' The nearest large cluster and the centre of the Local Supercluster.' : ''));
      this.clusterEntities.push(e);
    }
    for (const [name, ra, dec, d, text] of LANDMARKS) {
      const e = new Entity(`region:${name}`, name, 'region');
      raDecToWorld(ra, dec, d * 1e6, e.anchor);
      e.radiusKm = 15 * MPC_KM;
      e.minDistKm = 2 * MPC_KM;
      e.viewDistKm = (name.includes('Void') ? 120 : 90) * MPC_KM;
      e.subtitle = name.includes('Void') ? 'Cosmic void' : 'Supercluster';
      e.rank = 35;
      e.getInfo = () => this.regionInfo(e, text);
      this.clusterEntities.push(e);
    }
  }

  private regionInfo(e: Entity, blurb: string): InfoData {
    const dMpc = e.anchor.length() / 1e6;
    return {
      title: e.name, subtitle: e.subtitle, blurb,
      rows: [
        { k: 'Distance', v: `${sig((dMpc * MPC_KM) / LY_KM / 1e6, 3)} million ly`, hint: `${sig(dMpc, 3)} Mpc` },
        { k: 'Light left it', v: `${sig(dMpc * 3.2616, 3)} million years ago` },
      ],
      notes: ['Galaxies shown nearby are real NGC/IC objects. The catalogue is brightness-limited, so it thins out with distance.'],
    };
  }

  regions(): Entity[] { return this.clusterEntities; }
  namedIndices(): number[] { return this.named; }

  galaxyName(i: number): string {
    const m = this.meta.meta[i];
    return m[2] || (m[1] ? `${m[1]}` : m[0]);
  }
  searchText(i: number): string {
    const m = this.meta.meta[i];
    return `${m[2]} ${m[1]} ${m[1] ? m[1].replace('M', 'Messier ') : ''} ${m[0]}`.toLowerCase();
  }

  galaxyEntity(i: number): Entity {
    let e = this.entities.get(i);
    if (e) return e;
    const o = i * this.meta.stride, d = this.data;
    e = new Entity(`galaxy:${i}`, this.galaxyName(i), 'galaxy');
    e.anchor.set(d[o] * 1e6, d[o + 1] * 1e6, d[o + 2] * 1e6);
    e.radiusKm = d[o + 6] * KPC_KM;
    e.minDistKm = e.radiusKm * 1.5;
    e.viewDistKm = e.radiusKm * 4.6;
    e.subtitle = `${TYPE_NAMES[d[o + 8]] ?? 'Galaxy'} galaxy`;
    e.color = d[o + 8] < 1.5 ? 0xffdcae : 0xcfe0ff;
    e.getInfo = () => this.info(i, e!);
    this.entities.set(i, e);
    return e;
  }

  private info(i: number, e: Entity): InfoData {
    const m = this.meta.meta[i];
    const o = i * this.meta.stride, d = this.data;
    const dMpc = Math.hypot(d[o], d[o + 1], d[o + 2]);
    const rows: InfoRow[] = [];
    const ids = [m[1], m[0]].filter((s) => s && s !== e.name);
    if (m[3]) rows.push({ k: 'Hubble type', v: m[3] });
    rows.push({ k: 'Distance', v: dMpc < 0.5 ? `${sig(dMpc * 3261.6, 3)} thousand ly` : `${sig(dMpc * 3.2616, 3)} million ly`, hint: dMpc < 1 ? `${sig(dMpc * 1000, 3)} kpc` : `${sig(dMpc, 3)} Mpc` });
    rows.push({ k: 'Distance method', v: ['Hubble flow (redshift)', 'Host cluster distance', 'Measured (redshift-independent)'][m[4]] });
    rows.push({ k: 'Diameter', v: `${sig(d[o + 6] * 2 * 3.2616, 3)} thousand ly`, hint: `${sig(d[o + 6] * 2, 3)} kpc` });
    rows.push({ k: 'Absolute magnitude (B)', v: sig(d[o + 7], 3) });
    rows.push({ k: 'Luminosity', v: `${sig(Math.pow(10, -0.4 * (d[o + 7] - 5.48)), 2)} L☉` });
    if (m[5] != null) {
      rows.push({ k: 'Redshift z', v: m[5].toFixed(5), hint: `${sig(m[5] * C_KMS, 3)} km/s${m[5] < 0 ? ' (approaching)' : ''}` });
    }
    if (dMpc > 5) rows.push({ k: 'Lookback time', v: `${sig(lookbackTime((dMpc * 67.4) / C_KMS) * 1000, 3)} Myr` });
    const { ra, dec } = worldToRaDec(_v.set(d[o], d[o + 1], d[o + 2]));
    rows.push({ k: 'RA / Dec (J2000)', v: `${(ra / 15).toFixed(2)}h  ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(1)}°` });
    const notes = ['Position, size, orientation and type: OpenNGC. The image is a procedural reconstruction from those parameters, not a photograph.'];
    if (m[4] === 0) notes.push('Redshift distances ignore peculiar velocities and can be off by several Mpc for nearby galaxies.');
    return { title: e.name, subtitle: e.subtitle + (ids.length ? ` · ${ids.join(' · ')}` : ''), rows, notes };
  }

  update(ctx: FrameContext): void {
    const u = this.material.uniforms;
    u.uPixelScale.value = ctx.pixelScale;
    u.uPixelRatio.value = ctx.pixelRatio;
    // from inside the Milky Way other galaxies are faint smudges; brighten as the view widens
    const scaleKpc = ctx.distKm / KPC_KM;
    const t = Math.min(1, Math.max(0, Math.log10(Math.max(scaleKpc, 1e-3) / 1) / 2.3));
    u.uGain.value = 0.45 + 2.3 * t;
    this.camMpc.copy(ctx.rig.anchor).addScaledVector(ctx.rig.local, 1 / PC_KM).multiplyScalar(1e-6);
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    const scaleMpc = ctx.distKm / MPC_KM;
    if (scaleMpc < 0.002) return;
    const p = { x: 0, y: 0 };
    const d = this.data, st = this.meta.stride;
    for (const i of this.named) {
      const o = i * st;
      _v.set(d[o] - this.camMpc.x, d[o + 1] - this.camMpc.y, d[o + 2] - this.camMpc.z);
      const dist = _v.length();
      const px = ((d[o + 6] * 1e-3) / Math.max(dist, 1e-9)) * ctx.pixelScale / ctx.pixelRatio;
      // apparent magnitude from the camera decides which names appear
      const m = d[o + 7] + 5 * Math.log10(Math.max(dist, 1e-6) * 1e5);
      if (m > 10.2 && px < 6) continue;
      if (!ctx.project(_v, p)) continue;
      add({ x: p.x, y: p.y, text: this.galaxyName(i), priority: 28 - m + (px > 8 ? 20 : 0), color: '#c9d6f2', resolve: () => this.galaxyEntity(i), offset: Math.min(50, Math.max(6, px * 0.7 + 4)), kind: 'galaxy', key: `g${i}` });
    }
    if (scaleMpc > 4 && scaleMpc < 1500) {
      for (const e of this.clusterEntities) {
        ctx.rel(e, _v);
        if (ctx.project(_v, p)) add({ x: p.x, y: p.y, text: e.name, priority: 45, color: '#ffd9a0', entity: e, offset: 0, kind: 'region' });
      }
    }
  }

  /** Nearest/brightest galaxy to a screen point. */
  pick(ctx: FrameContext, x: number, y: number, radiusPx = 16): { index: number; score: number } | null {
    const d = this.data, st = this.meta.stride;
    const p = { x: 0, y: 0 };
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const o = i * st;
      _v.set(d[o] - this.camMpc.x, d[o + 1] - this.camMpc.y, d[o + 2] - this.camMpc.z);
      const dist = _v.length();
      if (!ctx.project(_v, p)) continue;
      const px = ((d[o + 6] * 1e-3) / Math.max(dist, 1e-9)) * ctx.pixelScale / ctx.pixelRatio;
      const r = Math.hypot(p.x - x, p.y - y);
      if (r > Math.max(radiusPx, px * 0.8)) continue;
      const m = d[o + 7] + 5 * Math.log10(Math.max(dist, 1e-6) * 1e5);
      if (m > 16 && px < 3) continue;
      const score = -m * 0.5 - r * 0.3;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best >= 0 ? { index: best, score: bestScore } : null;
  }
}
