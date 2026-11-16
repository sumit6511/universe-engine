// The solar system: Sun, planets, dwarf planets, 23 moons, rings, atmospheres, orbit trails and
// ~40,000 real small-body orbits propagated on the GPU.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, CustomBlending, DoubleSide, Float32BufferAttribute, Line, LineBasicMaterial,
  LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Points, Quaternion, RepeatWrapping, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, Texture, TextureLoader, Vector3, Vector4,
} from 'three';
import { AU_KM, DEG, G_SI, GM_SUN, J2000_JD, TSUN_K } from '../core/constants';
import { eclToWorld, eqToWorld } from '../core/frames';
import { BODIES, MOON_FIT, type BodyDef } from '../data/bodies';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity, type InfoData, type InfoRow } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import {
  bodyAxesEquatorial, earthPosition, moonPosition, planetElements, planetPosition, satFrame, satMeanLongitude, satPosition, satPositionAtL,
  smallBodyElementsAt, smallBodyPosition, type SmallBodyElements,
} from '../physics/ephemeris';
import { blackbodyRGB } from '../physics/stellar';
import { ATMO_FRAG, ATMO_VERT, BODY_FRAG, BODY_VERT, GLOW_FRAG, GLOW_VERT, RING_FRAG, RING_VERT, STAR_FRAG, STAR_VERT } from '../shaders/planet';
import { LOGDEPTH_FRAG, LOGDEPTH_FRAG_PARS, LOGDEPTH_VERT, LOGDEPTH_VERT_PARS } from '../shaders/common';
import { fmtDist, fmtDuration, fmtLightTime, fmtMass, hexColor, sig } from '../ui/format';

const ORBIT_SEGMENTS = 256;
const _a = [0, 0, 0];
const _b = [0, 0, 0];
const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _x = new Vector3(), _y = new Vector3(), _z = new Vector3();

/** Shared switch for animated weather, cloud shadows and aurorae. */
export const LIVE = { value: 0 };

export interface SmallBodiesMeta { count: number; stride: number; epoch: number; named: (SmallBodyElements & { name: string; kind: string; radius: number })[] }

export class Body {
  entity: Entity;
  mesh: Mesh;
  material: ShaderMaterial;
  atmo: Mesh | null = null;
  ring: Mesh | null = null;
  marker: Mesh;
  orbit: Line | null = null;
  orbitPeriod = 0; // days
  parent: Body | null = null;
  children: Body[] = [];
  occluders: Body[] = [];
  small: SmallBodyElements | null = null;
  rel = new Vector3();
  pole = new Vector3(0, 1, 0);
  /** apparent radius in device pixels this frame */
  px = 0;
  constructor(public def: BodyDef) {
    this.entity = new Entity(def.id, def.name, def.kind === 'asteroid' || def.kind === 'comet' ? def.kind : def.kind);
    this.mesh = null!; this.material = null!; this.marker = null!;
  }
}

export function makeGlow(color: number, minPx: number, power: number, inner: number, sizeKm = 0): Mesh {
  const mat = new ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: {
      uSizeKm: { value: sizeKm }, uMinPx: { value: minPx }, uPixelScale: { value: 1000 }, uColor: { value: new Color(color) },
      uPower: { value: power }, uInner: { value: inner }, uAlpha: { value: 1 },
    },
  });
  const m = new Mesh(GLOW_GEOMETRY, mat);
  m.frustumCulled = false;
  return m;
}
const GLOW_GEOMETRY = new PlaneGeometry(2, 2);

export class SolarSystem implements System {
  bodies: Body[] = [];
  byId = new Map<string, Body>();
  sun!: Body;
  sunCorona!: Mesh;
  belt: Points | null = null;
  beltMaterial: ShaderMaterial | null = null;
  beltEpoch = J2000_JD;
  showOrbits = true;
  showBelt = true;
  private loader = new TextureLoader();
  private sphere: SphereGeometry;
  private jd = J2000_JD;
  private blank: Texture;

  constructor(private engine: Engine, private smallMeta: SmallBodiesMeta, private texBase = './textures/') {
    this.sphere = new SphereGeometry(1, engine.quality.sphereSegments, engine.quality.sphereSegments / 2);
    const c = document.createElement('canvas'); c.width = c.height = 2;
    c.getContext('2d')!.fillRect(0, 0, 2, 2);
    this.blank = new CanvasTexture(c);
    for (const def of BODIES) this.addBody(def);
    for (const b of this.bodies) {
      if (b.def.parent) {
        b.parent = this.byId.get(b.def.parent)!;
        b.parent.children.push(b);
        b.entity.parent = b.parent.entity;
      }
    }
    for (const b of this.bodies) {
      if (b.def.kind === 'moon') b.occluders = [b.parent!];
      else if (b !== this.sun) b.occluders = [...b.children].sort((p, q) => q.def.radius - p.def.radius).slice(0, 4);
      this.setupOrbit(b);
      this.setupInfo(b);
    }
  }

  private tex(name: string, srgb = true): Texture {
    const t = this.loader.load(this.texBase + name);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.anisotropy = 8;
    t.minFilter = LinearMipmapLinearFilter;
    return t;
  }

  private addBody(def: BodyDef): void {
    const b = new Body(def);
    const scene = this.engine.near.scene;
    const e = b.entity;
    e.radiusKm = def.radius;
    e.color = def.color;
    e.rank = def.kind === 'star' ? 100 : def.kind === 'planet' ? 90 : def.kind === 'dwarf' ? 60 : def.kind === 'moon' ? 50 - 10 / Math.max(def.radius, 1) : 40;
    e.subtitle = def.kind === 'star' ? 'Star' : def.kind === 'planet' ? 'Planet' : def.kind === 'dwarf' ? 'Dwarf planet' : def.kind === 'moon' ? `Moon of ${BODIES.find((x) => x.id === def.parent)!.name}` : def.kind === 'comet' ? 'Comet' : 'Asteroid';
    e.minDistKm = def.radius * (def.atmosphere ? 1.18 + def.atmosphere.height : 1.22) + (def.radius < 50 ? 4 : 0);
    e.viewDistKm = def.radius * (def.ring ? 9 : def.kind === 'star' ? 7 : 4.5);
    e.searchTerms = `${def.name} ${e.subtitle}`.toLowerCase();

    const polar = 1 - (def.flattening ?? 0);
    if (def.kind === 'star') {
      b.material = new ShaderMaterial({
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
        uniforms: { uTeff: { value: TSUN_K }, uTime: { value: 0 }, uGain: { value: 1.25 } },
      });
      this.sun = b;
    } else {
      const defines: Record<string, string | number> = {};
      if (def.id === 'earth') defines.EARTH = 1;
      if (def.procedural) defines.PROCEDURAL = def.procedural === 'rock' ? 1 : def.procedural === 'ice' ? 2 : 3;
      if (def.ring) defines.RING_SHADOW = 1;
      if (['jupiter', 'saturn', 'uranus', 'neptune'].includes(def.id)) defines.GASGIANT = 1;
      const tint = def.procedural ? new Color(def.color) : new Color(1, 1, 1);
      b.material = new ShaderMaterial({
        vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, defines,
        uniforms: {
          uMap: { value: def.texture ? this.tex(def.texture) : this.blank },
          uNight: { value: def.id === 'earth' ? this.tex('earth_night.jpg') : this.blank },
          uClouds: { value: def.id === 'earth' ? this.tex('earth_clouds.jpg', false) : this.blank },
          uRingMap: { value: this.blank },
          uTint: { value: tint }, uRegolith: { value: def.regolith }, uLight: { value: 1.1 }, uTime: { value: 0 }, uSeed: { value: def.radius % 7.3 },
          uTemp: { value: 0 }, uLive: LIVE,
          uOblate: { value: new Vector3(1, 1 / (polar * polar), 1) },
          uSunPos: { value: new Vector3() }, uSunRadius: { value: 695700 },
          uOcc: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] }, uOccCount: { value: 0 },
          uCenter: { value: new Vector3() }, uPole: { value: new Vector3(0, 1, 0) }, uRingInner: { value: 0 }, uRingOuter: { value: 1 },
        },
      });
    }
    b.mesh = new Mesh(this.sphere, b.material);
    b.mesh.scale.set(def.radius, def.radius * polar, def.radius);
    b.mesh.frustumCulled = false;
    scene.add(b.mesh);

    if (def.atmosphere) {
      const at = def.atmosphere;
      const mat = new ShaderMaterial({
        vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, defines: { ATMO_STEPS: this.engine.quality.atmoSteps },
        transparent: true, depthWrite: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
        uniforms: {
          uInvModel: { value: new Matrix4() }, uSunDirObj: { value: new Vector3(1, 0, 0) },
          uBetaR: { value: new Vector3(...at.betaR) }, uBetaM: { value: new Vector3(...at.betaM) },
          uHR: { value: at.hR }, uHM: { value: at.hM }, uTop: { value: 1 + at.height }, uG: { value: at.g }, uIntensity: { value: at.intensity },
        },
      });
      b.atmo = new Mesh(this.sphere, mat);
      b.atmo.frustumCulled = false;
      b.atmo.renderOrder = 1;
      scene.add(b.atmo);
    }

    if (def.ring) {
      const rg = def.ring;
      let map: Texture;
      if (rg.texture) {
        map = this.loader.load(this.texBase + rg.texture);
        map.colorSpace = SRGBColorSpace;
      } else {
        const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1;
        const g = cv.getContext('2d')!;
        g.clearRect(0, 0, 2048, 1);
        for (const [r, w, o] of rg.ringlets ?? []) {
          const x = ((r - rg.inner) / (rg.outer - rg.inner)) * 2048;
          const px = Math.max(1.2, (w / (rg.outer - rg.inner)) * 2048);
          g.fillStyle = `rgba(255,255,255,${o})`;
          g.fillRect(x - px / 2, 0, px, 1);
        }
        map = new CanvasTexture(cv);
      }
      map.minFilter = LinearFilter; map.generateMipmaps = false;
      b.material.uniforms.uRingMap.value = map;
      b.material.uniforms.uRingInner.value = rg.inner;
      b.material.uniforms.uRingOuter.value = rg.outer;
      const seg = 192;
      const pos = new Float32Array((seg + 1) * 2 * 3);
      const idx: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        pos.set([Math.cos(t) * rg.inner, 0, Math.sin(t) * rg.inner, Math.cos(t) * rg.outer, 0, Math.sin(t) * rg.outer], i * 6);
        if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const mat = new ShaderMaterial({
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: DoubleSide, transparent: true, depthWrite: false,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
        uniforms: {
          uRingMap: { value: map }, uSunPos: { value: new Vector3() }, uSunRadius: { value: 695700 }, uCenter: { value: new Vector3() },
          uPole: { value: new Vector3(0, 1, 0) }, uTint: { value: new Color(...rg.color) }, uPlanetRadius: { value: def.radius },
          uPolarRatio: { value: polar }, uRingInner: { value: rg.inner }, uRingOuter: { value: rg.outer }, uLight: { value: 1.15 },
        },
      });
      b.ring = new Mesh(geo, mat);
      b.ring.frustumCulled = false;
      b.ring.renderOrder = 2;
      scene.add(b.ring);
    }

    if (def.kind === 'star') {
      this.sunCorona = makeGlow(0xffe2b0, 0, 2.6, 1 / 14, def.radius * 14);
      this.sunCorona.renderOrder = 3;
      scene.add(this.sunCorona);
      b.marker = makeGlow(0xffffff, 0, 2, 0.5);
      b.marker.visible = false;
    } else {
      b.marker = makeGlow(def.color, def.kind === 'planet' ? 3.4 : 2.4, 2.2, 0.42);
      b.marker.renderOrder = 4;
    }
    scene.add(b.marker);

    if (def.orbit?.type === 'small') {
      const el = this.smallMeta.named.find((n) => n.name.toLowerCase() === def.orbit!.type && false) ?? this.smallMeta.named.find((n) => n.name === (def.orbit as any).key);
      if (el) b.small = el;
    }
    this.bodies.push(b);
    this.byId.set(def.id, b);
  }

  private setupOrbit(b: Body): void {
    const o = b.def.orbit;
    if (!o) return;
    if (o.type === 'planet') b.orbitPeriod = 365.256898326 * Math.pow(planetElements(o.name, J2000_JD).a, 1.5);
    else if (o.type === 'earth') b.orbitPeriod = 365.256363;
    else if (o.type === 'moon') b.orbitPeriod = 27.321661;
    else if (o.type === 'sat') b.orbitPeriod = 360 / MOON_FIT[b.def.id].n;
    else if (b.small) b.orbitPeriod = 365.256898326 * Math.pow(b.small.a, 1.5);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array((ORBIT_SEGMENTS + 1) * 3), 3));
    const col = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
    const base = new Color(b.def.color).lerp(new Color(0x9fb4d8), 0.35);
    for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
      const s = i / ORBIT_SEGMENTS;
      const f = 0.1 + 0.9 * Math.pow(1 - s, 1.6);
      col.set([base.r * f, base.g * f, base.b * f], i * 3);
    }
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    const mat = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.6 });
    b.orbit = new Line(geo, mat);
    b.orbit.frustumCulled = false;
    this.engine.near.scene.add(b.orbit);
  }

  /** Position of a body relative to its parent at jd, in world axes, km. */
  private parentRelative(b: Body, jd: number, out: Vector3): Vector3 {
    const o = b.def.orbit;
    if (!o) return out.set(0, 0, 0);
    switch (o.type) {
      case 'planet': planetPosition(o.name, jd, _a); return eclToWorld(_a[0] * AU_KM, _a[1] * AU_KM, _a[2] * AU_KM, out);
      case 'earth': earthPosition(jd, _a); return eclToWorld(_a[0] * AU_KM, _a[1] * AU_KM, _a[2] * AU_KM, out);
      case 'moon': moonPosition(jd, _a); return eclToWorld(_a[0], _a[1], _a[2], out);
      case 'sat': satPosition(MOON_FIT[b.def.id], jd, _a); return eclToWorld(_a[0], _a[1], _a[2], out);
      case 'small':
        if (!b.small) return out.set(0, 0, 0);
        smallBodyPosition(b.small, jd, _a); return eclToWorld(_a[0] * AU_KM, _a[1] * AU_KM, _a[2] * AU_KM, out);
    }
  }

  simulate(jd: number): void {
    this.jd = jd;
    for (const b of this.bodies) {
      // BODIES lists parents before children
      this.parentRelative(b, jd, b.entity.local);
      if (b.parent) b.entity.local.add(b.parent.entity.local);
    }
  }

  private orient(b: Body, jd: number, q: Quaternion): void {
    const def = b.def;
    if (def.rot) {
      const [X, E, P] = bodyAxesEquatorial(def.rot, jd);
      eqToWorld(X[0], X[1], X[2], _x);
      eqToWorld(P[0], P[1], P[2], _y);
      eqToWorld(-E[0], -E[1], -E[2], _z);
    } else if (def.locked && b.parent) {
      // synchronous rotation: prime meridian faces the parent, pole along the orbit normal
      _x.subVectors(b.parent.entity.local, b.entity.local).normalize();
      const n = satFrame(MOON_FIT[def.id], jd)[2];
      eclToWorld(n[0], n[1], n[2], _y);
      _z.crossVectors(_x, _y).normalize();
      _y.crossVectors(_z, _x).normalize();
    } else {
      // no rotation model: spin about the ecliptic pole with a nominal period
      const ang = ((jd - J2000_JD) * 24) / 10 * Math.PI * 2 * (def.kind === 'comet' ? 0.2 : 1);
      _x.set(Math.cos(ang), 0, -Math.sin(ang)); _y.set(0, 1, 0); _z.crossVectors(_x, _y);
    }
    b.pole.copy(_y);
    q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  }

  update(ctx: FrameContext): void {
    const jd = this.jd;
    const sunRel = ctx.rel(this.sun.entity, this.sun.rel);
    const nearSun = ctx.sunDistPc < 0.2; // beyond ~40,000 AU nothing here is resolvable
    const systemAlpha = Math.min(1, Math.max(0, (0.06 - ctx.sunDistPc) / 0.04));
    for (const b of this.bodies) {
      const def = b.def;
      const rel = ctx.rel(b.entity, b.rel);
      const dist = rel.length();
      b.px = (def.radius / Math.max(dist, 1)) * ctx.pixelScale;
      const visible = nearSun && b.px > 0.3;
      b.mesh.visible = visible || b === this.sun;
      if (b.mesh.visible) {
        b.mesh.position.copy(rel);
        this.orient(b, jd, b.mesh.quaternion);
        const u = b.material.uniforms;
        if (u.uTime) u.uTime.value = ctx.time;
        if (b !== this.sun) {
          u.uSunPos.value.copy(sunRel);
          u.uCenter.value.copy(rel);
          u.uPole.value.copy(b.pole);
          let n = 0;
          for (const o of b.occluders) { (u.uOcc.value[n] as Vector4).set(o.rel.x, o.rel.y, o.rel.z, o.def.radius); n++; }
          u.uOccCount.value = n;
        }
      }
      if (b.atmo) {
        b.atmo.visible = visible && b.px > 6;
        if (b.atmo.visible) {
          const top = 1 + def.atmosphere!.height;
          b.atmo.position.copy(rel);
          b.atmo.quaternion.copy(b.mesh.quaternion);
          b.atmo.scale.copy(b.mesh.scale).multiplyScalar(top);
          b.mesh.updateMatrixWorld(true);
          const au = (b.atmo.material as ShaderMaterial).uniforms;
          (au.uInvModel.value as Matrix4).copy(b.mesh.matrixWorld).invert();
          _v.subVectors(sunRel, rel).transformDirection(au.uInvModel.value);
          au.uSunDirObj.value.copy(_v);
        }
      }
      if (b.ring) {
        b.ring.visible = visible && b.px > 2;
        if (b.ring.visible) {
          b.ring.position.copy(rel);
          b.ring.quaternion.copy(b.mesh.quaternion);
          const ru = (b.ring.material as ShaderMaterial).uniforms;
          ru.uSunPos.value.copy(sunRel); ru.uCenter.value.copy(rel); ru.uPole.value.copy(b.pole);
        }
      }
      // marker dot while the disc is unresolved
      if (b !== this.sun) {
        const mu = (b.marker.material as ShaderMaterial).uniforms;
        let alpha = systemAlpha * Math.min(1, Math.max(0, (4.5 - b.px) / 2.5));
        if (b.parent && b.parent !== this.sun) {
          // hide moon markers until the moon is separated from its planet on screen
          const sepPx = (_v.subVectors(b.entity.local, b.parent.entity.local).length() / Math.max(dist, 1)) * ctx.pixelScale;
          alpha *= Math.min(1, Math.max(0, (sepPx - 14) / 20));
        } else if (def.kind !== 'planet') {
          alpha *= 0.75;
        }
        b.marker.visible = alpha > 0.01;
        if (b.marker.visible) {
          b.marker.position.copy(rel);
          mu.uAlpha.value = alpha * 0.9;
          mu.uPixelScale.value = ctx.pixelScale;
          mu.uMinPx.value = (def.kind === 'planet' ? 3.6 : 2.6) * ctx.pixelRatio;
        }
      }
      this.updateOrbit(b, ctx, systemAlpha);
    }
    // corona
    const sunPx = this.sun.px;
    this.sunCorona.position.copy(sunRel);
    this.sunCorona.visible = sunPx > 1.5;
    const cu = (this.sunCorona.material as ShaderMaterial).uniforms;
    cu.uPixelScale.value = ctx.pixelScale;
    cu.uAlpha.value = 0.55 * Math.min(1, sunPx / 6);
    // small bodies
    if (this.belt && this.beltMaterial) {
      const a = this.showBelt ? Math.min(1, Math.max(0, (0.012 - ctx.sunDistPc) / 0.008)) : 0;
      this.belt.visible = a > 0.01;
      const u = this.beltMaterial.uniforms;
      u.uSunRel.value.copy(sunRel);
      u.uDays.value = jd - this.beltEpoch;
      u.uAlpha.value = a;
      u.uPixelRatio.value = ctx.pixelRatio;
      u.uPixelScale.value = ctx.pixelScale;
      // dim the swarm when the camera is deep inside it so individual points do not dominate
      u.uScaleAU.value = ctx.distKm / AU_KM;
    }
  }

  private updateOrbit(b: Body, ctx: FrameContext, systemAlpha: number): void {
    const line = b.orbit;
    if (!line) return;
    const parent = b.parent!;
    // apparent size of the orbit decides whether the trail is worth drawing
    const sep = _v.subVectors(b.entity.local, parent.entity.local).length();
    const camToParent = parent.rel.length();
    const px = (sep / Math.max(camToParent, sep * 0.02)) * ctx.pixelScale;
    let alpha = this.showOrbits ? systemAlpha * Math.min(1, Math.max(0, (px - 24) / 40)) : 0;
    if (b.def.kind === 'moon') alpha *= 0.75;
    if (b.def.kind !== 'planet' && b.def.kind !== 'moon') alpha *= 0.6;
    // very large on screen: keep the trail as a faint guide only
    alpha *= Math.min(1, Math.max(0.07, 1.2 - 0.42 * Math.log10(Math.max(px, 1) / 1200)));
    // fade the head of the trail out when we are right next to the body
    alpha *= Math.min(1, Math.max(0.0, 1.2 - b.px / 260));
    line.visible = alpha > 0.01;
    if (!line.visible) return;
    (line.material as LineBasicMaterial).opacity = alpha * 0.62;
    const pos = (line.geometry.getAttribute('position') as BufferAttribute);
    const arr = pos.array as Float32Array;
    const P = b.orbitPeriod;
    const o = b.def.orbit!;
    const prx = parent.rel.x, pry = parent.rel.y, prz = parent.rel.z;
    if (o.type === 'sat') {
      // uniform in mean longitude within the current (possibly precessing) orbit frame
      const fit = MOON_FIT[b.def.id];
      const frame = satFrame(fit, this.jd);
      const L0 = satMeanLongitude(fit, this.jd);
      for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
        satPositionAtL(fit, frame, L0 - (360 * i) / ORBIT_SEGMENTS, _b);
        arr[i * 3] = prx + _b[0]; arr[i * 3 + 1] = pry + _b[2]; arr[i * 3 + 2] = prz - _b[1];
      }
    } else {
      // past trajectory over one period
      for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
        this.parentRelative(b, this.jd - (P * i) / ORBIT_SEGMENTS, _v2);
        arr[i * 3] = prx + _v2.x; arr[i * 3 + 1] = pry + _v2.y; arr[i * 3 + 2] = prz + _v2.z;
      }
    }
    pos.needsUpdate = true;
  }

  /** GPU-propagated cloud of real asteroid and Kuiper-belt orbits. */
  setSmallBodies(data: Float32Array, meta: SmallBodiesMeta): void {
    const n = meta.count, st = meta.stride;
    const el1 = new Float32Array(n * 3), el2 = new Float32Array(n * 3), cls = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      el1.set([data[i * st], data[i * st + 1], data[i * st + 2]], i * 3);
      el2.set([data[i * st + 3], data[i * st + 4], data[i * st + 5]], i * 3);
      cls.set([data[i * st + 6], data[i * st + 7]], i * 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(el1, 3)); // a, e, i
    geo.setAttribute('aEl2', new BufferAttribute(el2, 3)); // node, peri, M0
    geo.setAttribute('aCls', new BufferAttribute(cls, 2)); // class, H
    this.beltEpoch = meta.epoch;
    this.beltMaterial = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uSunRel: { value: new Vector3() }, uDays: { value: 0 }, uAlpha: { value: 1 }, uPixelRatio: { value: 1 }, uScaleAU: { value: 1 }, uPixelScale: { value: 1000 } },
      vertexShader: /* glsl */ `
        ${LOGDEPTH_VERT_PARS}
        attribute vec3 aEl2; attribute vec2 aCls;
        uniform vec3 uSunRel; uniform float uDays; uniform float uPixelRatio; uniform float uScaleAU; uniform float uPixelScale;
        varying vec3 vColor;
        void main(){
          float a = position.x, e = position.y, inc = position.z;
          float n = 0.01720209895 / (a * sqrt(a));
          float M = mod(aEl2.z + n * uDays, 6.28318530718);
          float E = M + e * sin(M) * (1.0 + e * cos(M));
          for (int k = 0; k < 9; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
          float xp = a * (cos(E) - e), yp = a * sqrt(1.0 - e * e) * sin(E);
          float cO = cos(aEl2.x), sO = sin(aEl2.x), cw = cos(aEl2.y), sw = sin(aEl2.y), ci = cos(inc), si = sin(inc);
          vec3 ecl = vec3((cO*cw - sO*sw*ci)*xp + (-cO*sw - sO*cw*ci)*yp, (sO*cw + cO*sw*ci)*xp + (-sO*sw + cO*cw*ci)*yp, sw*si*xp + cw*si*yp);
          vec3 world = uSunRel + vec3(ecl.x, ecl.z, -ecl.y) * ${AU_KM.toFixed(1)};
          float cls = aCls.x;
          vColor = cls < 0.5 ? vec3(0.86, 0.78, 0.66) : cls < 1.5 ? vec3(0.62, 0.80, 0.62) : cls < 2.5 ? vec3(1.0, 0.55, 0.38) : cls < 3.5 ? vec3(0.55, 0.85, 0.85) : vec3(0.62, 0.74, 1.0);
          float bright = clamp(1.25 - (aCls.y - 3.0) / 14.0, 0.25, 1.0);
          vColor *= bright * mix(0.35, 0.8, smoothstep(0.5, 6.0, uScaleAU / max(a, 0.3)));
          // when the whole swarm shrinks to a few pixels, dim it so thousands of points do not add up to a white blob
          float orbitPx = a * ${AU_KM.toFixed(1)} / max(length(world), 1.0) * uPixelScale;
          vColor *= clamp(orbitPx / 420.0, 0.02, 1.0);
          gl_PointSize = (cls > 2.5 ? 2.0 : 1.5) * uPixelRatio * (0.8 + bright * 0.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          ${LOGDEPTH_VERT}
        }`,
      fragmentShader: /* glsl */ `
        ${LOGDEPTH_FRAG_PARS}
        uniform float uAlpha; varying vec3 vColor;
        void main(){
          ${LOGDEPTH_FRAG}
          float r = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(vColor * uAlpha * smoothstep(1.0, 0.3, r), 1.0);
        }`,
    });
    this.belt = new Points(geo, this.beltMaterial);
    this.belt.frustumCulled = false;
    this.belt.renderOrder = -1;
    this.engine.near.scene.add(this.belt);
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    if (ctx.sunDistPc > 0.05) return;
    const p = { x: 0, y: 0 };
    for (const b of this.bodies) {
      if (b === this.sun && ctx.sunDistPc > 2e-4 && false) continue;
      if (!ctx.project(b.rel, p)) continue;
      let pr = b.entity.rank;
      if (b.parent && b.parent !== this.sun) {
        const sepPx = (_v.subVectors(b.entity.local, b.parent.entity.local).length() / Math.max(b.rel.length(), 1)) * ctx.pixelScale / ctx.pixelRatio;
        if (sepPx < 26) continue;
      } else if (b.def.kind !== 'planet' && b.def.kind !== 'star') {
        // dwarf planets / small bodies only once the view is wide enough or they are close
        const orbitPx = (b.entity.local.length() / Math.max(this.sun.rel.length(), 1)) * ctx.pixelScale;
        if (orbitPx < 60 && b.px < 1) continue;
      }
      if (ctx.rig.target === b.entity) pr += 1000;
      add({ x: p.x, y: p.y, text: b.def.name, priority: pr, color: hexColor(b.def.color), entity: b.entity, offset: Math.min(60, Math.max(6, b.px / ctx.pixelRatio + 4)), kind: b.def.kind });
    }
  }

  private setupInfo(b: Body): void {
    const def = b.def;
    b.entity.getInfo = (): InfoData => {
      const rows: InfoRow[] = [];
      const jd = this.jd;
      const g = (G_SI * def.mass) / (def.radius * 1e3) ** 2;
      const vol = (4 / 3) * Math.PI * (def.radius * 1e3) ** 3;
      rows.push({ k: 'Mean radius', v: `${sig(def.radius, 5)} km` });
      rows.push({ k: 'Mass', v: fmtMass(def.mass) });
      rows.push({ k: 'Mean density', v: `${sig(def.mass / vol / 1000, 3)} g/cm³` });
      rows.push({ k: 'Surface gravity', v: `${sig(g, 3)} m/s²`, hint: `${sig(g / 9.80665, 2)} g` });
      rows.push({ k: 'Escape velocity', v: `${sig(Math.sqrt((2 * G_SI * def.mass) / (def.radius * 1e3)) / 1000, 3)} km/s` });
      if (def.rot) {
        const day = 360 / Math.abs(def.rot.wd);
        rows.push({ k: 'Rotation period', v: fmtDuration(day) + (def.rot.wd < 0 ? ' (retrograde)' : '') });
        if (b.parent && def.orbit) {
          // obliquity: angle between spin axis and orbit normal
          this.parentRelative(b, jd, _v); this.parentRelative(b, jd + b.orbitPeriod / 4, _v2);
          const nrm = _v.clone().cross(_v2).normalize();
          const P = bodyAxesEquatorial(def.rot, jd)[2];
          const pole = eqToWorld(P[0], P[1], P[2], new Vector3());
          rows.push({ k: 'Axial tilt', v: `${sig(Math.acos(Math.max(-1, Math.min(1, pole.dot(nrm)))) / DEG, 3)}°` });
        }
      } else if (def.locked) rows.push({ k: 'Rotation', v: 'Synchronous (tidally locked)' });
      if (def.kind === 'star') {
        rows.push({ k: 'Effective temperature', v: '5,772 K' }, { k: 'Luminosity', v: '3.828 × 10²⁶ W' }, { k: 'Spectral type', v: 'G2V' }, { k: 'Age', v: '4.57 Gyr' });
        rows.push({ k: 'Distance to Galactic Centre', v: '26,600 ly' });
      }
      if (b.parent && def.orbit) {
        const r = _v.subVectors(b.entity.local, b.parent.entity.local).length();
        const isHelio = b.parent === this.sun;
        let a = 0, e = 0;
        if (def.orbit.type === 'planet' || def.orbit.type === 'earth') { const el = planetElements(def.orbit.type === 'earth' ? 'EMB' : def.orbit.name, jd); a = el.a * AU_KM; e = el.e; }
        else if (def.orbit.type === 'small' && b.small) { const el = smallBodyElementsAt(b.small, jd); a = el.a * AU_KM; e = el.e; }
        else if (def.orbit.type === 'sat') { a = MOON_FIT[def.id].a; e = MOON_FIT[def.id].e; }
        else if (def.orbit.type === 'moon') { a = 384400; e = 0.0549; }
        rows.push({ k: 'Orbital period', v: fmtDuration(b.orbitPeriod) });
        rows.push({ k: 'Semi-major axis', v: fmtDist(a) });
        if (e > 0) rows.push({ k: 'Eccentricity', v: sig(e, 3) });
        rows.push({ k: `Distance from ${b.parent.def.name} now`, v: fmtDist(r) });
        const gm = isHelio ? GM_SUN : (G_SI * b.parent.def.mass) / 1e9;
        rows.push({ k: 'Orbital speed now', v: `${sig(Math.sqrt(Math.max(0, gm * (2 / r - 1 / a))), 3)} km/s` });
        if (isHelio) rows.push({ k: 'Sunlight travel time', v: fmtLightTime(r) });
        if (def.id !== 'earth') {
          const earth = this.byId.get('earth')!;
          const dE = _v.subVectors(b.entity.local, earth.entity.local).length();
          rows.push({ k: 'Distance from Earth now', v: fmtDist(dE), hint: fmtLightTime(dE) });
        }
        if (isHelio) {
          // radiative equilibrium temperature of a fast rotator
          const teq = 278.6 * Math.pow(1 - def.albedo, 0.25) / Math.sqrt(r / AU_KM);
          rows.push({ k: 'Equilibrium temperature', v: `${sig(teq, 3)} K`, hint: `Bond albedo ${def.albedo}` });
        }
      }
      const notes: string[] = [];
      if (def.textureNote) notes.push(def.textureNote);
      if (def.orbit?.type === 'small') notes.push('Orbit: two-body propagation of JPL SBDB osculating elements; accuracy degrades decades from epoch.');
      if (def.orbit?.type === 'sat') notes.push('Orbit: mean elements fitted to JPL Horizons; typically within 1-3° of the true position.');
      return {
        title: def.name, subtitle: b.entity.subtitle, blurb: def.blurb, rows, notes,
        links: [...(b.parent ? [{ label: b.parent.def.name, get: () => b.parent!.entity }] : []), ...b.children.map((c) => ({ label: c.def.name, get: () => c.entity }))],
      };
    };
  }

  /** Colour of sunlight for UI use. */
  static sunColor(): number[] { return blackbodyRGB(TSUN_K); }
}
