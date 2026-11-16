// Spacecraft on escape trajectories, habitable zones, and the human radio bubble.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Line, LineBasicMaterial, LineLoop, Mesh, Quaternion,
  ShaderMaterial, Vector3,
} from 'three';
import { AU_KM, C_KMS, LY_KM, PC_KM, TSUN_K, jdToCalendar } from '../core/constants';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity, type InfoData } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { habitableZone } from '../physics/stellar';
import { LOGDEPTH_FRAG, LOGDEPTH_FRAG_PARS, LOGDEPTH_VERT, LOGDEPTH_VERT_PARS } from '../shaders/common';
import { fmtDist, fmtLightTime, sig } from '../ui/format';
import { makeGlow, type SolarSystem } from './solar';
import type { StarField } from './stars';

// Heliocentric J2000-ecliptic state vectors from JPL Horizons at JD 2461041.5 (2026-01-01), km and km/s.
// These probes are far outside the planets on nearly straight escape paths, so positions are
// extrapolated linearly from this state (good to a fraction of a percent for decades either side).
const EPOCH = 2461041.5;
const CRAFT: { id: string; name: string; launch: number; r: number[]; v: number[]; blurb: string }[] = [
  { id: 'voyager1', name: 'Voyager 1', launch: 1977, r: [-4.762659739242758e9, -2.014761457045306e10, 1.457753551876435e10], v: [-2.072816913981589, -13.61111711012975, 9.834684958533998],
    blurb: 'The most distant human-made object. It crossed into interstellar space in 2012 and in late 2026 passes one light-day from the Sun. Its radio transmitter is as powerful as a refrigerator light bulb.' },
  { id: 'voyager2', name: 'Voyager 2', launch: 1977, r: [5.868355260926653e9, -1.555691440749276e10, -1.315244404280593e10], v: [4.203428908881701, -9.341334116213933, -11.3209912742229],
    blurb: 'The only spacecraft to have visited Uranus and Neptune. It entered interstellar space in 2018, heading south of the plane of the planets.' },
  { id: 'pioneer10', name: 'Pioneer 10', launch: 1972, r: [3.572051547995207e9, 2.061764103925357e10, 1.09166204893862e9], v: [1.226191726066673, 11.78164906171728, 0.6034118563252342],
    blurb: 'First spacecraft through the asteroid belt and past Jupiter. Contact was lost in 2003; it coasts on toward Aldebaran, which it would reach in about two million years.' },
  { id: 'pioneer11', name: 'Pioneer 11', launch: 1973, r: [4.256117842570765e9, -1.633252504274725e10, 4.16565200741139e9], v: [4.038025189861361, -10.10148686310618, 2.433834428395463],
    blurb: 'First spacecraft to fly past Saturn (1979). Silent since 1995.' },
  { id: 'newhorizons', name: 'New Horizons', launch: 2006, r: [2.993398464408334e9, -9.021417501871286e9, 3.310495062169785e8], v: [5.316429662287472, -12.51716468763726, 0.4926959652018441],
    blurb: 'Flew past Pluto in July 2015 and the Kuiper-belt object Arrokoth in 2019, and is still returning data from the outer Kuiper belt.' },
];
const TRAIL_YEARS = 18, TRAIL_N = 24;
const _v = new Vector3();

export class Spacecraft implements System {
  show = true;
  craft: { def: (typeof CRAFT)[number]; entity: Entity; marker: Mesh; trail: Line; rel: Vector3 }[] = [];
  private jd = EPOCH;

  constructor(private engine: Engine, private solar: SolarSystem) {
    for (const def of CRAFT) {
      const e = new Entity(`craft:${def.id}`, def.name, 'spacecraft');
      e.radiusKm = 0.005;
      e.minDistKm = 2e4;
      e.viewDistKm = 4e8;
      e.subtitle = 'Interstellar probe';
      e.color = 0x9df5d0;
      e.rank = 55;
      e.getInfo = () => this.info(def, e);
      const marker = makeGlow(0x9df5d0, 2.6, 2.2, 0.42);
      marker.renderOrder = 4;
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(new Float32Array((TRAIL_N + 1) * 3), 3));
      const col = new Float32Array((TRAIL_N + 1) * 3);
      for (let i = 0; i <= TRAIL_N; i++) { const f = Math.pow(1 - i / TRAIL_N, 1.5); col.set([0.35 * f, 0.9 * f, 0.72 * f], i * 3); }
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      const trail = new Line(g, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.6 }));
      trail.frustumCulled = false;
      engine.near.scene.add(marker, trail);
      this.craft.push({ def, entity: e, marker, trail, rel: new Vector3() });
    }
  }

  private pos(def: (typeof CRAFT)[number], jd: number, out: Vector3): Vector3 {
    const dt = (jd - EPOCH) * 86400;
    return out.set(def.r[0] + def.v[0] * dt, def.r[2] + def.v[2] * dt, -(def.r[1] + def.v[1] * dt));
  }

  simulate(jd: number): void {
    this.jd = jd;
    for (const c of this.craft) this.pos(c.def, jd, c.entity.local);
  }

  private launched(def: (typeof CRAFT)[number]): boolean { return jdToCalendar(this.jd).y >= def.launch + 12; }

  update(ctx: FrameContext): void {
    const alpha = this.show ? Math.min(1, Math.max(0, (0.06 - ctx.sunDistPc) / 0.04)) : 0;
    const sunRel = this.solar.sun.rel;
    for (const c of this.craft) {
      const on = alpha > 0.01 && this.launched(c.def);
      c.marker.visible = c.trail.visible = on;
      if (!on) continue;
      ctx.rel(c.entity, c.rel);
      c.marker.position.copy(c.rel);
      const mu = (c.marker.material as ShaderMaterial).uniforms;
      mu.uAlpha.value = alpha * 0.9; mu.uPixelScale.value = ctx.pixelScale; mu.uMinPx.value = 2.8 * ctx.pixelRatio;
      (c.trail.material as LineBasicMaterial).opacity = alpha * 0.55;
      const attr = c.trail.geometry.getAttribute('position') as BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i <= TRAIL_N; i++) {
        this.pos(c.def, this.jd - (TRAIL_YEARS * 365.25 * i) / TRAIL_N, _v);
        arr[i * 3] = sunRel.x + _v.x; arr[i * 3 + 1] = sunRel.y + _v.y; arr[i * 3 + 2] = sunRel.z + _v.z;
      }
      attr.needsUpdate = true;
    }
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    if (!this.show || ctx.sunDistPc > 0.05) return;
    const p = { x: 0, y: 0 };
    // only once the view is wide enough for the outer solar system, or when one is the target
    const wide = ctx.distKm > 25 * AU_KM;
    for (const c of this.craft) {
      const target = ctx.rig.target === c.entity;
      if ((!wide && !target) || !this.launched(c.def)) continue;
      if (ctx.project(c.rel, p)) add({ x: p.x, y: p.y, text: c.def.name, priority: target ? 1100 : 58, color: '#9df5d0', entity: c.entity, offset: 7, kind: 'craft' });
    }
  }

  bodies(): { entity: Entity; rel: Vector3; radiusKm: number }[] {
    return this.show ? this.craft.filter((c) => c.marker.visible).map((c) => ({ entity: c.entity, rel: c.rel, radiusKm: 0.005 })) : [];
  }

  private info(def: (typeof CRAFT)[number], e: Entity): InfoData {
    const r = e.local.length();
    const speed = Math.hypot(def.v[0], def.v[1], def.v[2]);
    const earth = this.solar.byId.get('earth')!.entity;
    const dE = _v.subVectors(e.local, earth.local).length();
    return {
      title: def.name, subtitle: `${e.subtitle} · launched ${def.launch}`, blurb: def.blurb,
      rows: [
        { k: 'Distance from Sun', v: `${sig(r / AU_KM, 4)} AU`, hint: fmtDist(r) },
        { k: 'Distance from Earth', v: `${sig(dE / AU_KM, 4)} AU`, hint: fmtLightTime(dE) },
        { k: 'Signal round trip', v: fmtLightTime(dE * 2) },
        { k: 'Speed relative to Sun', v: `${sig(speed, 4)} km/s`, hint: `${sig(speed / AU_KM * 86400 * 365.25, 3)} AU per year` },
        { k: 'Fraction of light speed', v: `${sig((speed / C_KMS) * 100, 2)}%` },
        { k: 'Time to cover one light-year', v: `${sig(LY_KM / speed / 86400 / 365.25, 3)} years` },
      ],
      notes: ['Position: JPL Horizons state vector (1 Jan 2026) extrapolated along a straight line. Not valid during the planetary fly-by era, so the probe is hidden before then.'],
      links: [{ label: 'Sun', get: () => this.solar.sun.entity }],
    };
  }
}

/** Habitable-zone bands around the Sun and the active star, plus the sphere our radio signals have reached. */
export class Guides implements System {
  show = true;
  private sunRing: Mesh;
  private starRing: Mesh | null = null;
  private starIndex = -1;
  private bubble: LineLoop[] = [];
  private bubbleLy = 0;
  private mat: ShaderMaterial;

  constructor(private engine: Engine, private solar: SolarSystem, private stars: StarField) {
    this.mat = new ShaderMaterial({
      transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
      uniforms: { uAlpha: { value: 1 }, uInner: { value: 1 }, uOuter: { value: 2 } },
      vertexShader: `${LOGDEPTH_VERT_PARS} varying vec2 vP; void main(){ vP = position.xz; vec4 wp = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; ${LOGDEPTH_VERT} }`,
      fragmentShader: `${LOGDEPTH_FRAG_PARS} uniform float uAlpha, uInner, uOuter; varying vec2 vP;
        void main(){ ${LOGDEPTH_FRAG}
          float r = length(vP); float t = (r - uInner) / (uOuter - uInner);
          float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.94, t);
          float rim = exp(-pow(min(t, 1.0 - t) / 0.03, 2.0));
          gl_FragColor = vec4(vec3(0.25, 0.95, 0.55) * (0.03 * edge + 0.13 * rim) * uAlpha, 1.0); }`,
    });
    this.sunRing = this.ring(habitableZone(1, TSUN_K));
    engine.near.scene.add(this.sunRing);
    // radio bubble: three great circles of unit radius, scaled each frame
    const n = 128, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.set([Math.cos(a), 0, Math.sin(a)], i * 3); }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pts, 3));
    const m = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, uniforms: { uAlpha: { value: 1 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = 0.0; }',
      fragmentShader: 'uniform float uAlpha; void main(){ gl_FragColor = vec4(vec3(0.35, 0.9, 0.72) * uAlpha, 1.0); }',
    });
    const rots: [number, number, number][] = [[0, 0, 0], [Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]];
    for (const r of rots) {
      const l = new LineLoop(g, m);
      l.rotation.set(...r); l.frustumCulled = false;
      engine.stellar.root.add(l);
      this.bubble.push(l);
    }
  }

  private ring(hz: [number, number]): Mesh {
    const seg = 160, pos = new Float32Array((seg + 1) * 6), idx: number[] = [];
    const a = hz[0] * AU_KM, b = hz[1] * AU_KM;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pos.set([Math.cos(t) * a, 0, Math.sin(t) * a, Math.cos(t) * b, 0, Math.sin(t) * b], i * 6);
      if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    const mat = this.mat.clone();
    mat.uniforms.uInner.value = a; mat.uniforms.uOuter.value = b;
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    mesh.userData.outer = b;
    return mesh;
  }

  update(ctx: FrameContext): void {
    const fade = (rel: Vector3, outer: number) => {
      const px = (outer / Math.max(rel.length(), outer * 0.05)) * ctx.pixelScale;
      return this.show ? Math.min(1, Math.max(0, (px - 30) / 60)) * Math.min(1, Math.max(0, (9000 - px) / 4000)) : 0;
    };
    const sunRel = this.solar.sun.rel;
    const a = fade(sunRel, this.sunRing.userData.outer) * Math.min(1, Math.max(0, (0.06 - ctx.sunDistPc) / 0.04));
    this.sunRing.visible = a > 0.01;
    this.sunRing.position.copy(sunRel);
    (this.sunRing.material as ShaderMaterial).uniforms.uAlpha.value = a;
    const sys = this.stars.activeHabitableZone();
    if ((sys?.index ?? -1) !== this.starIndex) {
      if (this.starRing) { this.engine.near.scene.remove(this.starRing); this.starRing.geometry.dispose(); (this.starRing.material as ShaderMaterial).dispose(); this.starRing = null; }
      this.starIndex = sys?.index ?? -1;
      if (sys) { this.starRing = this.ring(sys.hz); this.starRing.quaternion.copy(new Quaternion().setFromRotationMatrix(sys.basis)); this.engine.near.scene.add(this.starRing); }
    }
    if (this.starRing && sys) {
      const sa = fade(sys.rel, this.starRing.userData.outer);
      this.starRing.visible = sa > 0.01;
      this.starRing.position.copy(sys.rel);
      (this.starRing.material as ShaderMaterial).uniforms.uAlpha.value = sa;
    }
    // radio: first transmissions in 1895 (Marconi); the shell expands at one light-year per year
    this.bubbleLy = Math.max(0, jdToCalendar(ctx.jd).y - 1895);
    const rPc = (this.bubbleLy * LY_KM) / PC_KM;
    const scalePc = ctx.distKm / PC_KM;
    const ba = this.show && rPc > 0 ? Math.min(1, Math.max(0, Math.log10(Math.max(scalePc, 1e-6) / (rPc * 0.15)))) * Math.min(1, Math.max(0, 1 - Math.log10(Math.max(scalePc, 1e-6) / (rPc * 40)))) : 0;
    for (const l of this.bubble) {
      l.visible = ba > 0.01;
      l.scale.setScalar(Math.max(rPc, 1e-9));
      (l.material as ShaderMaterial).uniforms.uAlpha.value = 0.35 * ba;
    }
    this.bubbleAlpha = ba;
  }
  private bubbleAlpha = 0;

  labels(ctx: FrameContext, add: AddLabel): void {
    if (this.bubbleAlpha < 0.3) return;
    const p = { x: 0, y: 0 };
    const side = new Vector3(0.707, -0.707, 0).applyQuaternion(this.engine.near.camera.quaternion);
    const v = this.solar.sun.rel.clone().addScaledVector(side, this.bubbleLy * LY_KM);
    if (ctx.project(v, p, false)) add({ x: p.x, y: p.y + 14, text: `Reach of human radio · ${this.bubbleLy} light-years`, priority: 60, color: '#7fe3c0', kind: 'region', offset: 0, key: 'radio' });
  }
}

