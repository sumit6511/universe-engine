// Stellar neighbourhood: the HYG catalogue (~113k stars with parallaxes) rendered as physically
// scaled points, constellation figures tied to the real 3D star positions, and on-demand
// close-up star systems, including every confirmed exoplanet from the NASA Exoplanet Archive.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Line, LineBasicMaterial, LineSegments, Matrix4, Mesh, Points,
  ShaderMaterial, SphereGeometry, Vector3, Vector4,
} from 'three';
import { AU_KM, J2000_JD, LY_KM, PC_KM, REARTH_KM, RJUP_KM, RSUN_KM, TAU } from '../core/constants';
import { worldToRaDec } from '../core/frames';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity, type InfoData, type InfoRow } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { elementsToPosition, solveKepler } from '../physics/kepler';
import { blackbodyRGB, bvToTeff, habitableZone, starProps } from '../physics/stellar';
import { BLACKBODY } from '../shaders/common';
import { BODY_FRAG, BODY_VERT, GLOW_FRAG, GLOW_VERT, STAR_FRAG, STAR_VERT } from '../shaders/planet';
import { fmtDist, fmtDuration, hexColor, sig } from '../ui/format';
import { PlaneGeometry } from 'three';

export interface StarsMeta { count: number; nmeta: number; meta: string[]; named: [number, string, string][]; gliese: [number, string, string][] }
/** [letter, period d, a AU, radius R_earth, mass M_earth|null, e, incl|null, Teq|null, method, year, estimated flags] */
export type ExoPlanetRow = [string, number, number, number, number | null, number, number | null, number | null, string, number | null, number];
export interface ExoHost { s: number; n: string; t: number | null; r: number | null; m: number | null; p: ExoPlanetRow[] }
export interface ConstellationData { lines: number[]; labels: [string, number, number, number][] }

const STRIDE = 8;
const _v = new Vector3();
const _p = [0, 0, 0];
const _m = new Matrix4();
const GLOW_GEO = new PlaneGeometry(2, 2);

const GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
  Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};
function prettyBayer(bf: string): string {
  return bf.replace(/^(\d+\s*)?([A-Z][a-z]{1,2})(-?\d)?\s/, (_m0, fl, gr, n) => (GREEK[gr] ? `${GREEK[gr]}${n ? n.replace('-', '') : ''} ` : `${fl ?? ''}${gr} `));
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

interface ExoPlanet {
  entity: Entity;
  row: ExoPlanetRow;
  mesh: Mesh;
  marker: Mesh;
  orbit: Line;
  rel: Vector3;
  peri: number;
  M0: number;
  radiusKm: number;
}

/** Close-up representation of one star (and its planets), built when the camera heads there. */
interface ActiveSystem {
  index: number;
  entity: Entity;
  mesh: Mesh;
  corona: Mesh;
  glare: Mesh;
  radiusKm: number;
  teff: number;
  planets: ExoPlanet[];
  basis: Matrix4; // orbital plane of the system
  rel: Vector3;
}

export class StarField implements System {
  count: number;
  points: Points;
  material: ShaderMaterial;
  constellations: LineSegments | null = null;
  showConstellations = true;
  magLimit = 6.3;
  private entities = new Map<number, Entity>();
  private exoByStar = new Map<number, ExoHost>();
  private exoPlanetEntities = new Map<string, Entity>();
  private named: { i: number; name: string }[] = [];
  private active: ActiveSystem | null = null;
  private myr = 0;
  private jd = J2000_JD;
  private camPc = new Vector3();
  private sphere: SphereGeometry;
  /** the Sun's entity (index 0 of the catalogue) is owned by the solar system */
  sunEntity: Entity | null = null;

  constructor(private engine: Engine, private data: Float32Array, private meta: StarsMeta, private hip: Uint32Array, exo: ExoHost[], private constData: ConstellationData) {
    this.count = meta.count;
    this.sphere = new SphereGeometry(1, 96, 48);
    for (const h of exo) this.exoByStar.set(h.s, h);
    const n = this.count;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), mag = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos.set(data.subarray(i * STRIDE, i * STRIDE + 3), i * 3);
      vel.set(data.subarray(i * STRIDE + 3, i * STRIDE + 6), i * 3);
      mag[i * 2] = data[i * STRIDE + 6]; mag[i * 2 + 1] = data[i * STRIDE + 7];
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new BufferAttribute(vel, 3));
    geo.setAttribute('aMag', new BufferAttribute(mag, 2));
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uMyr: { value: 0 }, uPixelRatio: { value: 1 }, uMagLimit: { value: this.magLimit }, uHide: { value: -1 }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        ${BLACKBODY}
        attribute vec3 aVel; attribute vec2 aMag;
        uniform float uMyr, uPixelRatio, uMagLimit, uHide, uGain;
        varying vec3 vColor;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position + aVel * uMyr, 1.0);
          float d = max(length(mv.xyz), 1e-12);
          float m = aMag.x + 5.0 * log(d * 0.1) / 2.302585093;       // apparent magnitude from the camera
          float b = pow(10.0, min(0.4 * (uMagLimit - m), 30.0));     // flux relative to the faintest visible star
          if (float(gl_VertexID) == uHide) b = 0.0;
          float size = (1.3 + 1.15 * pow(b, 0.27)) * uPixelRatio;
          float inten = b < 1.0 ? b * b * 0.7 : 0.7 + 0.5 * log(b) / 2.302585093;
          vec3 c = blackbody(bvToTeff(aMag.y));
          float l = dot(c, vec3(0.3, 0.55, 0.15));
          c = max(mix(vec3(l), c, 1.35), 0.0);                        // modest saturation boost so colours read on screen
          vColor = c * min(inten, 2.2) * uGain;
          gl_PointSize = min(size, 24.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = 0.0;
          if (b < 0.2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float core = exp(-r * r * 7.0);
          float halo = pow(max(0.0, 1.0 - r), 3.0) * 0.22;
          gl_FragColor = vec4(vColor * (core + halo), 1.0);
        }`,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    engine.stellar.root.add(this.points);

    // constellation figures: pairs of catalogue stars, so they stretch with parallax and proper motion
    if (constData.lines.length) {
      const ln = constData.lines.length;
      const lp = new Float32Array(ln * 3), lv = new Float32Array(ln * 3);
      for (let k = 0; k < ln; k++) {
        const i = constData.lines[k];
        lp.set(pos.subarray(i * 3, i * 3 + 3), k * 3);
        lv.set(vel.subarray(i * 3, i * 3 + 3), k * 3);
      }
      const lg = new BufferGeometry();
      lg.setAttribute('position', new BufferAttribute(lp, 3));
      lg.setAttribute('aVel', new BufferAttribute(lv, 3));
      const lm = new ShaderMaterial({
        transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uMyr: { value: 0 }, uAlpha: { value: 0.5 } },
        vertexShader: `attribute vec3 aVel; uniform float uMyr; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aVel * uMyr, 1.0); gl_Position.z = 0.0; }`,
        fragmentShader: `uniform float uAlpha; void main(){ gl_FragColor = vec4(vec3(0.33, 0.50, 0.85) * uAlpha, 1.0); }`,
      });
      this.constellations = new LineSegments(lg, lm);
      this.constellations.frustumCulled = false;
      engine.stellar.root.add(this.constellations);
    }

    for (let i = 0; i < meta.nmeta; i++) {
      const proper = meta.meta[i].split('|', 1)[0];
      if (proper && i > 0) this.named.push({ i, name: proper });
    }
    for (const [i, name] of meta.named) this.named.push({ i, name });
  }

  // ------------------------------------------------------------------ catalogue access
  starPos(i: number, out: Vector3): Vector3 {
    const d = this.data, o = i * STRIDE;
    return out.set(d[o] + d[o + 3] * this.myr, d[o + 1] + d[o + 4] * this.myr, d[o + 2] + d[o + 5] * this.myr);
  }
  absMag(i: number): number { return this.data[i * STRIDE + 6]; }
  colorIndex(i: number): number { return this.data[i * STRIDE + 7]; }

  starName(i: number): { name: string; alt: string[]; spect: string } {
    const alt: string[] = [];
    let name = '', spect = '';
    if (i < this.meta.nmeta) {
      const [proper, bf, sp, hd] = this.meta.meta[i].split('|');
      spect = sp;
      if (proper) name = proper;
      if (bf) { const b = prettyBayer(bf); if (!name) name = b; else alt.push(b); }
      if (hd) alt.push(`HD ${hd}`);
    } else {
      const nm = this.meta.named.find((x) => x[0] === i) ?? this.meta.gliese.find((x) => x[0] === i);
      if (nm) { name = nm[1].startsWith('Gl') || nm[1].startsWith('GJ') || nm[1].startsWith('NN') ? nm[1].replace(/^(Gl|GJ|NN)\s*/, 'Gliese ') : nm[1]; spect = nm[2]; }
    }
    const host = this.exoByStar.get(i);
    if (host) { if (!name) name = host.n; else if (host.n !== name) alt.push(host.n); }
    if (this.hip[i]) { if (!name) name = `HIP ${this.hip[i]}`; else alt.push(`HIP ${this.hip[i]}`); }
    if (!name) name = `HYG ${i}`;
    return { name, alt, spect };
  }

  /** Entity for catalogue star i (created on demand and cached). */
  starEntity(i: number): Entity {
    if (i === 0 && this.sunEntity) return this.sunEntity;
    let e = this.entities.get(i);
    if (e) return e;
    const nm = this.starName(i);
    e = new Entity(`star:${i}`, nm.name, 'star');
    const host = this.exoByStar.get(i);
    const props = starProps(this.absMag(i), this.colorIndex(i));
    const radiusKm = (host?.r ?? props.radius) * RSUN_KM;
    e.radiusKm = radiusKm;
    e.minDistKm = radiusKm * 1.6;
    e.viewDistKm = radiusKm * 9;
    e.subtitle = host ? `Star · ${host.p.length} known planet${host.p.length > 1 ? 's' : ''}` : 'Star';
    const rgb = blackbodyRGB(host?.t ?? props.teff);
    e.color = (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);
    this.starPos(i, e.anchor);
    e.getInfo = () => this.starInfo(i, e!);
    this.entities.set(i, e);
    return e;
  }

  exoHosts(): IterableIterator<ExoHost> { return this.exoByStar.values(); }
  namedStars(): { i: number; name: string }[] { return this.named; }

  exoPlanetEntity(hostIndex: number, k: number): Entity {
    const key = `${hostIndex}:${k}`;
    let e = this.exoPlanetEntities.get(key);
    if (e) return e;
    const host = this.exoByStar.get(hostIndex)!;
    const row = host.p[k];
    const star = this.starEntity(hostIndex);
    e = new Entity(`exo:${key}`, `${host.n} ${row[0]}`, 'exoplanet');
    e.parent = star;
    e.anchor = star.anchor; // shared: planet positions are exact relative to their star
    e.radiusKm = row[3] * REARTH_KM;
    e.minDistKm = e.radiusKm * 1.25;
    e.viewDistKm = e.radiusKm * 5;
    e.subtitle = `Exoplanet of ${host.n}`;
    e.color = exoColor(row).getHex();
    e.getInfo = () => this.exoInfo(hostIndex, k, e!);
    // provisional position so a flight can start before the system is built
    this.exoPosition(hostIndex, k, this.jd, e.local);
    this.exoPlanetEntities.set(key, e);
    return e;
  }

  /** Which catalogue star (if any) an entity belongs to. */
  systemIndexOf(e: Entity | null): number {
    if (!e) return -1;
    if (e.id.startsWith('star:')) return parseInt(e.id.slice(5), 10);
    if (e.id.startsWith('exo:')) return parseInt(e.id.slice(4).split(':')[0], 10);
    return -1;
  }

  // ------------------------------------------------------------------ exoplanet orbits
  private systemBasis(hostIndex: number): Matrix4 {
    // The sky orientation of exoplanet orbits is unknown: use a fixed pseudo-random plane per system.
    const u = hash(hostIndex * 1.37) * 2 - 1, phi = hash(hostIndex * 2.11) * TAU;
    const s = Math.sqrt(1 - u * u);
    const n = new Vector3(s * Math.cos(phi), u, s * Math.sin(phi));
    const x = new Vector3(0, 1, 0).cross(n).normalize();
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    const y = n.clone().cross(x).normalize();
    return new Matrix4().makeBasis(x, n, y.negate());
  }

  private exoPosition(hostIndex: number, k: number, jd: number, out: Vector3, basis?: Matrix4, Mover?: number): Vector3 {
    const host = this.exoByStar.get(hostIndex)!;
    const row = host.p[k];
    const peri = hash(hostIndex * 7.7 + k * 13.3) * TAU;
    const M0 = hash(hostIndex * 3.3 + k * 5.9) * TAU;
    const M = Mover ?? M0 + (TAU * (jd - J2000_JD)) / row[1];
    elementsToPosition({ a: row[2] * AU_KM, e: Math.min(row[5], 0.95), i: 0, node: 0, peri, M }, _p);
    return out.set(_p[0], 0, -_p[1]).applyMatrix4(basis ?? this.systemBasis(hostIndex));
  }

  // ------------------------------------------------------------------ active close-up system
  activate(index: number): void {
    if (this.active?.index === index) return;
    this.deactivate();
    if (index <= 0) return;
    const scene = this.engine.near.scene;
    const entity = this.starEntity(index);
    const host = this.exoByStar.get(index);
    const props = starProps(this.absMag(index), this.colorIndex(index));
    const teff = host?.t ?? props.teff;
    const radiusKm = entity.radiusKm;
    const mesh = new Mesh(this.sphere, new ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uTeff: { value: teff }, uTime: { value: 0 }, uGain: { value: 7 } },
    }));
    mesh.scale.setScalar(radiusKm);
    mesh.frustumCulled = false;
    const rgb = blackbodyRGB(teff);
    const col = new Color(rgb[0], rgb[1], rgb[2]);
    const mkGlow = (sizeKm: number, power: number, inner: number) => {
      const m = new Mesh(GLOW_GEO, new ShaderMaterial({
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uSizeKm: { value: sizeKm }, uMinPx: { value: 0 }, uPixelScale: { value: 1000 }, uColor: { value: col.clone() }, uPower: { value: power }, uInner: { value: inner }, uAlpha: { value: 1 } },
      }));
      m.frustumCulled = false;
      return m;
    };
    const corona = mkGlow(radiusKm * 14, 2.6, 1 / 14);
    const glare = mkGlow(0, 2.4, 0.16);
    corona.renderOrder = 3; glare.renderOrder = 3;
    scene.add(mesh, corona, glare);
    const basis = this.systemBasis(index);
    const planets: ExoPlanet[] = [];
    if (host) {
      host.p.forEach((row, k) => {
        const e = this.exoPlanetEntity(index, k);
        const style = exoStyle(row);
        const pm = new Mesh(this.sphere, new ShaderMaterial({
          vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, defines: { PROCEDURAL: style.type },
          uniforms: {
            uMap: { value: null }, uRingMap: { value: null }, uTint: { value: style.color }, uRegolith: { value: style.type <= 2 ? 0.6 : 0 }, uLight: { value: 1.1 },
            uTime: { value: 0 }, uSeed: { value: hash(index + k * 17.0) * 10 }, uTemp: { value: row[7] ?? 0 }, uOblate: { value: new Vector3(1, 1, 1) },
            uSunPos: { value: new Vector3() }, uSunRadius: { value: radiusKm },
            uOcc: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] }, uOccCount: { value: 0 },
            uCenter: { value: new Vector3() }, uPole: { value: new Vector3(0, 1, 0) }, uRingInner: { value: 0 }, uRingOuter: { value: 1 },
          },
        }));
        pm.scale.setScalar(e.radiusKm);
        pm.frustumCulled = false;
        pm.quaternion.setFromRotationMatrix(basis);
        const marker = mkGlow(0, 2.2, 0.42);
        (marker.material as ShaderMaterial).uniforms.uColor.value = style.color.clone().lerp(new Color(1, 1, 1), 0.3);
        marker.renderOrder = 4;
        const og = new BufferGeometry();
        og.setAttribute('position', new Float32BufferAttribute(new Float32Array(257 * 3), 3));
        const oc = new Float32Array(257 * 3);
        const base = style.color.clone().lerp(new Color(0x9fb4d8), 0.5);
        for (let i = 0; i <= 256; i++) { const f = 0.12 + 0.88 * Math.pow(1 - i / 256, 1.6); oc.set([base.r * f, base.g * f, base.b * f], i * 3); }
        og.setAttribute('color', new Float32BufferAttribute(oc, 3));
        const orbit = new Line(og, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.8 }));
        orbit.frustumCulled = false;
        scene.add(pm, marker, orbit);
        planets.push({ entity: e, row, mesh: pm, marker, orbit, rel: new Vector3(), peri: 0, M0: 0, radiusKm: e.radiusKm });
      });
    }
    this.active = { index, entity, mesh, corona, glare, radiusKm, teff, planets, basis, rel: new Vector3() };
    this.simulate(this.jd);
  }

  deactivate(): void {
    const a = this.active;
    if (!a) return;
    const scene = this.engine.near.scene;
    const drop = (m: Mesh | Line) => { scene.remove(m); (m.material as ShaderMaterial).dispose(); if (m.geometry !== this.sphere && m.geometry !== GLOW_GEO) m.geometry.dispose(); };
    drop(a.mesh); drop(a.corona); drop(a.glare);
    for (const p of a.planets) { drop(p.mesh); drop(p.marker); drop(p.orbit); }
    this.active = null;
  }

  get activeIndex(): number { return this.active ? this.active.index : -1; }

  /** Star and planets of the close-up system, for picking. */
  activeBodies(): { entity: Entity; rel: Vector3; radiusKm: number }[] {
    const a = this.active;
    if (!a) return [];
    return [{ entity: a.entity, rel: a.rel, radiusKm: a.radiusKm }, ...a.planets.map((p) => ({ entity: p.entity, rel: p.rel, radiusKm: p.radiusKm }))];
  }

  // ------------------------------------------------------------------ frame
  simulate(jd: number): void {
    this.jd = jd;
    this.myr = (jd - J2000_JD) / 365.25e6;
    const a = this.active;
    if (a) {
      this.starPos(a.index, a.entity.anchor);
      a.planets.forEach((p, k) => this.exoPosition(a.index, k, jd, p.entity.local, a.basis));
    }
  }

  update(ctx: FrameContext): void {
    const u = this.material.uniforms;
    u.uMyr.value = this.myr;
    u.uPixelRatio.value = ctx.pixelRatio;
    u.uMagLimit.value = this.magLimit;
    u.uHide.value = this.active ? this.active.index : -1;
    this.camPc.copy(ctx.rig.anchor).addScaledVector(ctx.rig.local, 1 / PC_KM);
    if (this.constellations) {
      const cu = (this.constellations.material as ShaderMaterial).uniforms;
      const fade = Math.min(1, Math.max(0, 1 - Math.log10(Math.max(ctx.sunDistPc, 1) / 6) / 1.3));
      this.constellations.visible = this.showConstellations && fade > 0.01;
      cu.uMyr.value = this.myr;
      cu.uAlpha.value = 0.36 * fade;
    }
    const a = this.active;
    if (!a) return;
    const rel = ctx.rel(a.entity, a.rel);
    const dist = rel.length();
    const px = (a.radiusKm / Math.max(dist, 1)) * ctx.pixelScale;
    a.mesh.position.copy(rel);
    a.mesh.visible = px > 0.4;
    (a.mesh.material as ShaderMaterial).uniforms.uTime.value = ctx.time;
    a.corona.position.copy(rel);
    a.corona.visible = px > 1.5;
    const cu = (a.corona.material as ShaderMaterial).uniforms;
    cu.uPixelScale.value = ctx.pixelScale; cu.uAlpha.value = 1.6 * Math.min(1, px / 6);
    // glare billboard reproduces the catalogue point (which is hidden while the system is active)
    const dpc = Math.max(dist / PC_KM, 1e-12);
    const m = this.absMag(a.index) + 5 * Math.log10(dpc / 10);
    const b = Math.pow(10, Math.min(0.4 * (this.magLimit - m), 30));
    const gu = (a.glare.material as ShaderMaterial).uniforms;
    a.glare.position.copy(rel);
    a.glare.visible = b > 0.12 && px < 40;
    gu.uPixelScale.value = ctx.pixelScale;
    gu.uMinPx.value = Math.min(30, 1.3 + 1.15 * Math.pow(b, 0.27)) * ctx.pixelRatio * 0.9;
    gu.uAlpha.value = Math.min(2.6, b < 1 ? b * b * 0.7 : 0.7 + 0.5 * Math.log10(b)) * 0.5 * Math.min(1, Math.max(0, (40 - px) / 20));
    const systemAlpha = Math.min(1, Math.max(0, (0.05 - dpc) / 0.03));
    for (let k = 0; k < a.planets.length; k++) {
      const p = a.planets[k];
      const pr = ctx.rel(p.entity, p.rel);
      const pd = pr.length();
      const ppx = (p.radiusKm / Math.max(pd, 1)) * ctx.pixelScale;
      p.mesh.visible = ppx > 0.3;
      p.mesh.position.copy(pr);
      const pu = (p.mesh.material as ShaderMaterial).uniforms;
      pu.uSunPos.value.copy(rel); pu.uCenter.value.copy(pr); pu.uTime.value = ctx.time;
      const mu = (p.marker.material as ShaderMaterial).uniforms;
      const ma = systemAlpha * Math.min(1, Math.max(0, (4.5 - ppx) / 2.5));
      p.marker.visible = ma > 0.01;
      p.marker.position.copy(pr);
      mu.uAlpha.value = ma * 0.9; mu.uPixelScale.value = ctx.pixelScale; mu.uMinPx.value = 3.2 * ctx.pixelRatio;
      // orbit ellipse, sampled backwards in mean anomaly from the planet's current position
      const orbitPx = (p.row[2] * AU_KM / Math.max(dist, p.row[2] * AU_KM * 0.02)) * ctx.pixelScale;
      const oa = systemAlpha * Math.min(1, Math.max(0, (orbitPx - 24) / 40)) * Math.min(1, Math.max(0, 1.2 - ppx / 260));
      p.orbit.visible = oa > 0.01;
      if (p.orbit.visible) {
        (p.orbit.material as LineBasicMaterial).opacity = oa;
        const attr = p.orbit.geometry.getAttribute('position') as BufferAttribute;
        const arr = attr.array as Float32Array;
        const Mnow = hash(a.index * 3.3 + k * 5.9) * TAU + (TAU * (this.jd - J2000_JD)) / p.row[1];
        for (let i = 0; i <= 256; i++) {
          this.exoPosition(a.index, k, this.jd, _v, a.basis, Mnow - (TAU * i) / 256);
          arr[i * 3] = rel.x + _v.x; arr[i * 3 + 1] = rel.y + _v.y; arr[i * 3 + 2] = rel.z + _v.z;
        }
        attr.needsUpdate = true;
      }
    }
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    const p = { x: 0, y: 0 };
    if (ctx.sunDistPc < 4000) {
      // brightest named stars as seen from the camera
      for (const s of this.named) {
        this.starPos(s.i, _v).sub(this.camPc);
        const d = _v.length();
        const m = this.absMag(s.i) + 5 * Math.log10(Math.max(d, 1e-9) / 10);
        if (m > this.magLimit - 3.2) continue;
        if (!ctx.project(_v, p)) continue;
        const i = s.i;
        add({ x: p.x, y: p.y, text: s.name, priority: 20 - m, color: '#cfd8ee', resolve: () => this.starEntity(i), offset: 7, kind: 'star', key: `s${i}` });
      }
    }
    if (this.showConstellations && ctx.sunDistPc < 3) {
      for (const [name, x, y, z] of this.constData.labels) {
        _v.set(x, y, z);
        if (!ctx.project(_v, p)) continue;
        add({ x: p.x, y: p.y, text: name.toUpperCase(), priority: 2, color: '#6f86bd', kind: 'constellation', offset: 0, alpha: 0.75 });
      }
    }
    const a = this.active;
    if (a) {
      if (ctx.project(a.rel, p)) add({ x: p.x, y: p.y, text: a.entity.name, priority: 1100, color: hexColor(a.entity.color), entity: a.entity, offset: 8, kind: 'star' });
      const dpc = a.rel.length() / PC_KM;
      if (dpc < 0.05) {
        for (const pl of a.planets) {
          if (!ctx.project(pl.rel, p)) continue;
          const ppx = (pl.radiusKm / Math.max(pl.rel.length(), 1)) * ctx.pixelScale / ctx.pixelRatio;
          add({ x: p.x, y: p.y, text: pl.entity.name, priority: 80 + (ctx.rig.target === pl.entity ? 1000 : 0), color: hexColor(pl.entity.color), entity: pl.entity, offset: Math.min(60, Math.max(6, ppx + 4)), kind: 'planet' });
        }
      }
    }
  }

  /** Brightest star within `radiusPx` of a screen point (CSS px). */
  pick(ctx: FrameContext, x: number, y: number, radiusPx = 14): { index: number; score: number } | null {
    const d = this.data;
    const cam = this.engine.stellar.camera;
    const q = cam.quaternion.clone().invert();
    _m.makeRotationFromQuaternion(q);
    const e = _m.elements;
    const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
    let best = -1, bestScore = -Infinity;
    const cx = this.camPc.x, cy = this.camPc.y, cz = this.camPc.z, myr = this.myr;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const rx = d[o] + d[o + 3] * myr - cx, ry = d[o + 1] + d[o + 4] * myr - cy, rz = d[o + 2] + d[o + 5] * myr - cz;
      const vz = e[2] * rx + e[6] * ry + e[10] * rz;
      if (vz >= 0) continue;
      const vx = e[0] * rx + e[4] * ry + e[8] * rz, vy = e[1] * rx + e[5] * ry + e[9] * rz;
      const sx = ((vx * f) / (-vz * cam.aspect) * 0.5 + 0.5) * ctx.width;
      const sy = ((-vy * f) / -vz * 0.5 + 0.5) * ctx.height;
      const dx = sx - x, dy = sy - y;
      const r2 = dx * dx + dy * dy;
      if (r2 > radiusPx * radiusPx) continue;
      const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const m = d[o + 6] + 5 * Math.log10(Math.max(dist, 1e-9) / 10);
      if (m > this.magLimit + 0.5) continue;
      const score = -m - Math.sqrt(r2) * 0.35;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best >= 0 ? { index: best, score: bestScore } : null;
  }

  // ------------------------------------------------------------------ info panels
  private starInfo(i: number, e: Entity): InfoData {
    const nm = this.starName(i);
    const host = this.exoByStar.get(i);
    const props = starProps(this.absMag(i), this.colorIndex(i));
    const teff = host?.t ?? props.teff;
    const radius = host?.r ?? props.radius;
    const pos = this.starPos(i, new Vector3());
    const dpc = pos.length();
    const { ra, dec } = worldToRaDec(pos);
    const rows: InfoRow[] = [];
    if (nm.spect) rows.push({ k: 'Spectral type', v: nm.spect });
    else rows.push({ k: 'Spectral class', v: `~${props.spectralClass}`, hint: 'from colour' });
    rows.push({ k: 'Distance from Sun', v: `${sig(dpc * PC_KM / LY_KM, 4)} ly`, hint: `${sig(dpc, 4)} pc` });
    rows.push({ k: 'Effective temperature', v: `${sig(teff, 3)} K`, hint: host?.t ? 'measured' : 'from B−V colour' });
    rows.push({ k: 'Luminosity', v: `${sig(props.luminosity, 3)} L☉`, hint: 'estimated' });
    rows.push({ k: 'Radius', v: `${sig(radius, 3)} R☉`, hint: host?.r ? 'measured' : 'Stefan–Boltzmann' });
    if (host?.m) rows.push({ k: 'Mass', v: `${sig(host.m, 3)} M☉` });
    rows.push({ k: 'Absolute magnitude', v: sig(this.absMag(i), 3) });
    rows.push({ k: 'Apparent magnitude (Earth)', v: sig(this.absMag(i) + 5 * Math.log10(dpc / 10), 3) });
    const h = Math.floor(ra / 15), mnt = Math.floor((ra / 15 - h) * 60);
    rows.push({ k: 'RA / Dec (J2000)', v: `${h}h ${String(mnt).padStart(2, '0')}m  ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(1)}°` });
    const d = this.data, o = i * STRIDE;
    const speed = Math.hypot(d[o + 3], d[o + 4], d[o + 5]) * 0.9778; // pc/Myr -> km/s
    if (speed > 0) rows.push({ k: 'Velocity relative to Sun', v: `${sig(speed, 3)} km/s` });
    const hz = habitableZone(props.luminosity, teff);
    rows.push({ k: 'Habitable zone', v: `${sig(hz[0], 2)} – ${sig(hz[1], 2)} AU`, hint: 'Kopparapu et al. 2013' });
    return {
      title: nm.name, subtitle: e.subtitle, rows,
      blurb: nm.alt.length ? `Also catalogued as ${nm.alt.slice(0, 4).join(', ')}.` : undefined,
      notes: ['Position and motion: HYG 4.1 (Hipparcos / Gaia / Gliese). Radius and luminosity are estimates unless marked measured.'],
      links: host ? host.p.map((row, k) => ({ label: `${host.n} ${row[0]}`, get: () => this.exoPlanetEntity(i, k) })) : [],
    };
  }

  private exoInfo(hostIndex: number, k: number, e: Entity): InfoData {
    const host = this.exoByStar.get(hostIndex)!;
    const row = host.p[k];
    const [, per, a, rade, masse, ecc, incl, teq, method, year, est] = row;
    const props = starProps(this.absMag(hostIndex), this.colorIndex(hostIndex));
    const teff = host.t ?? props.teff;
    const lum = host.r && host.t ? host.r * host.r * (host.t / 5772) ** 4 : props.luminosity;
    const rows: InfoRow[] = [];
    rows.push({ k: 'Radius', v: `${sig(rade, 3)} R⊕`, hint: est & 2 ? 'estimated from mass' : `${sig((rade * REARTH_KM) / RJUP_KM, 2)} R♃` });
    if (masse != null) rows.push({ k: 'Mass', v: masse > 60 ? `${sig(masse / 317.83, 3)} M♃` : `${sig(masse, 3)} M⊕`, hint: 'or minimum mass' });
    if (masse != null && !(est & 2)) rows.push({ k: 'Mean density', v: `${sig((5.513 * masse) / rade ** 3, 3)} g/cm³` });
    rows.push({ k: 'Orbital period', v: fmtDuration(per) });
    rows.push({ k: 'Semi-major axis', v: `${sig(a, 3)} AU`, hint: est & 1 ? 'from Kepler’s third law' : fmtDist(a * AU_KM) });
    if (ecc > 0) rows.push({ k: 'Eccentricity', v: sig(ecc, 3) });
    if (incl != null) rows.push({ k: 'Inclination to sky plane', v: `${sig(incl, 4)}°` });
    const ins = lum / (a * a);
    rows.push({ k: 'Insolation', v: `${sig(ins, 3)} × Earth` });
    rows.push({ k: 'Equilibrium temperature', v: teq != null ? `${sig(teq, 3)} K` : `${sig(278.6 * Math.pow(0.7, 0.25) * Math.pow(ins, 0.25), 3)} K`, hint: teq != null ? 'catalogue' : 'albedo 0.3 assumed' });
    const hz = habitableZone(lum, teff);
    rows.push({ k: 'In habitable zone', v: a >= hz[0] && a <= hz[1] ? 'Yes (conservative)' : a < hz[0] ? 'No — too hot' : 'No — too cold' });
    rows.push({ k: 'Discovery', v: `${method}${year ? `, ${year}` : ''}` });
    rows.push({ k: 'Distance from Sun', v: `${sig(e.anchor.length() * PC_KM / LY_KM, 4)} ly` });
    const style = exoStyle(row);
    return {
      title: e.name, subtitle: `${style.label} · exoplanet`, rows,
      notes: [
        'Data: NASA Exoplanet Archive (Planetary Systems Composite).',
        `Appearance is illustrative (${style.label.toLowerCase()}); no exoplanet surface has been imaged. Orbit orientation and phase are not known and are placed arbitrarily.`,
      ],
      links: [{ label: host.n, get: () => this.starEntity(hostIndex) }, ...host.p.map((r, j) => ({ label: `${host.n} ${r[0]}`, get: () => this.exoPlanetEntity(hostIndex, j) })).filter((_, j) => j !== k)],
    };
  }
}

/** Illustrative appearance class from radius and equilibrium temperature (gas giants: Sudarsky et al. 2000). */
function exoStyle(row: ExoPlanetRow): { type: number; color: Color; label: string } {
  const r = row[3];
  const t = row[7] ?? 300;
  if (r < 1.7) {
    if (t > 1300) return { type: 1, color: new Color(0.42, 0.16, 0.10), label: 'Lava world' };
    if (t > 350) return { type: 1, color: new Color(0.62, 0.50, 0.42), label: 'Rocky planet' };
    if (t > 180) return { type: 1, color: new Color(0.52, 0.56, 0.60), label: 'Temperate rocky planet' };
    return { type: 2, color: new Color(0.86, 0.90, 0.95), label: 'Icy rocky planet' };
  }
  if (r < 4) return { type: 3, color: t > 800 ? new Color(0.80, 0.66, 0.58) : new Color(0.62, 0.78, 0.92), label: 'Sub-Neptune' };
  if (r < 7) return { type: 4, color: t > 800 ? new Color(0.45, 0.55, 0.85) : new Color(0.50, 0.72, 0.95), label: 'Neptune-like ice giant' };
  if (t < 150) return { type: 4, color: new Color(0.88, 0.74, 0.58), label: 'Gas giant, class I (ammonia clouds)' };
  if (t < 250) return { type: 4, color: new Color(0.90, 0.92, 0.96), label: 'Gas giant, class II (water clouds)' };
  if (t < 800) return { type: 4, color: new Color(0.30, 0.45, 0.85), label: 'Gas giant, class III (cloudless)' };
  if (t < 1400) return { type: 4, color: new Color(0.36, 0.33, 0.36), label: 'Hot Jupiter, class IV (alkali metals)' };
  return { type: 4, color: new Color(0.55, 0.50, 0.50), label: 'Hot Jupiter, class V (silicate clouds)' };
}
function exoColor(row: ExoPlanetRow): Color { return exoStyle(row).color; }

export { solveKepler };
