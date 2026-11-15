// Application wiring: data loading, simulation clock, navigation, picking and search.

import { Vector3 } from 'three';
import { AU_KM, KPC_KM, MPC_KM, dateToJd } from './core/constants';
import { GALACTIC_NORTH } from './core/frames';
import { Engine, type System } from './engine/engine';
import type { Entity } from './engine/entity';
import type { AddLabel } from './engine/labels';
import type { Quality } from './engine/quality';
import { CosmicWeb, WEB_BOX_MPC } from './scene/cosmicweb';
import { GalaxyField } from './scene/galaxies';
import { MilkyWay } from './scene/milkyway';
import { SolarSystem } from './scene/solar';
import { StarField } from './scene/stars';
import type { ZeldovichResult } from './workers/zeldovich.worker';

export interface SearchEntry { text: string; label: string; sub: string; weight: number; get: () => Entity | null }

const YEAR_S = 365.25 * 86400;
export const TIME_RATES: [number, string][] = [
  [1, 'real time'], [60, '1 minute / s'], [600, '10 minutes / s'], [3600, '1 hour / s'], [6 * 3600, '6 hours / s'], [86400, '1 day / s'],
  [7 * 86400, '1 week / s'], [30.4375 * 86400, '1 month / s'], [YEAR_S, '1 year / s'], [10 * YEAR_S, '10 years / s'], [100 * YEAR_S, '100 years / s'],
  [1000 * YEAR_S, '1,000 years / s'], [1e4 * YEAR_S, '10,000 years / s'], [1e5 * YEAR_S, '100,000 years / s'],
];

export class SimClock {
  jd = dateToJd(new Date());
  rateIndex = 0;
  direction = 1;
  paused = false;
  step(dt: number): void {
    if (!this.paused) this.jd += (this.direction * TIME_RATES[this.rateIndex][0] * dt) / 86400;
  }
  get rateLabel(): string {
    if (this.paused) return 'paused';
    return (this.direction < 0 ? 'reverse · ' : '') + TIME_RATES[this.rateIndex][1];
  }
  now(): void { this.jd = dateToJd(new Date()); this.rateIndex = 0; this.direction = 1; this.paused = false; }
}

type LabelSystem = System & { labels?: (ctx: Engine['ctx'], add: AddLabel) => void };

export class App {
  engine: Engine;
  clock = new SimClock();
  solar!: SolarSystem;
  stars!: StarField;
  milkyway!: MilkyWay;
  galaxies!: GalaxyField;
  web!: CosmicWeb;
  search: SearchEntry[] = [];
  selected: Entity | null = null;
  onSelect: ((e: Entity | null) => void) | null = null;
  /** extra label providers / systems registered later (black holes, ...) */
  labelSystems: LabelSystem[] = [];
  private byName = new Map<string, () => Entity | null>();
  private time = 0;
  private _v = new Vector3();

  constructor(canvas: HTMLCanvasElement, public quality: Quality) {
    this.engine = new Engine(canvas, quality);
  }

  async load(progress: (f: number, msg: string) => void, base = './'): Promise<void> {
    let done = 0;
    const total = 9;
    const tick = (msg: string) => progress(++done / (total + 2), msg);
    const j = async (u: string, msg: string) => { const r = await fetch(base + u); if (!r.ok) throw new Error(`Could not load ${u} (${r.status})`); const v = await r.json(); tick(msg); return v; };
    const b = async (u: string, msg: string) => { const r = await fetch(base + u); if (!r.ok) throw new Error(`Could not load ${u} (${r.status})`); const v = await r.arrayBuffer(); tick(msg); return v; };
    const [starBin, starMeta, hip, exo, cons, sbBin, sbMeta, galBin, galMeta] = await Promise.all([
      b('data/stars.bin', 'Star catalogue: 113,000 stars'), j('data/stars_meta.json', 'Star names'), b('data/stars_hip.bin', 'Hipparcos identifiers'),
      j('data/exoplanets.json', 'Exoplanet archive: 6,400 planets'), j('data/constellations.json', 'Constellation figures'),
      b('data/smallbodies.bin', 'Asteroid and Kuiper-belt orbits'), j('data/smallbodies.json', 'Dwarf planets'),
      b('data/galaxies.bin', 'Galaxy catalogue: 10,000 galaxies'), j('data/galaxies_meta.json', 'Galaxy names'),
    ]);
    progress(0.86, 'Building the Milky Way');
    await new Promise((r) => setTimeout(r, 0));
    const e = this.engine;
    this.solar = new SolarSystem(e, sbMeta, base + 'textures/');
    this.solar.setSmallBodies(new Float32Array(sbBin), sbMeta);
    this.stars = new StarField(e, new Float32Array(starBin), starMeta, new Uint32Array(hip), exo, cons);
    this.stars.sunEntity = this.solar.sun.entity;
    this.milkyway = new MilkyWay(e);
    this.galaxies = new GalaxyField(e, new Float32Array(galBin), galMeta);
    this.web = new CosmicWeb(e);
    e.systems.push(this.solar, this.stars, this.milkyway, this.galaxies, this.web);
    this.labelSystems.push(this.solar as LabelSystem, this.stars as LabelSystem, this.milkyway as LabelSystem, this.galaxies as LabelSystem, this.web as LabelSystem);
    progress(0.95, 'Indexing');
    this.buildSearch();
    this.solar.simulate(this.clock.jd);
    const earth = this.solar.byId.get('earth')!.entity;
    e.rig.setFocus(earth, earth.viewDist);
    // open on the sunlit side of Earth
    const sunDir = this.solar.sun.entity.local.clone().sub(earth.local).normalize();
    e.rig.yaw = Math.atan2(sunDir.x, sunDir.z) + 0.75; e.rig.pitch = -0.2;
    e.rig.onArrive = () => {};
    this.startWeb();
    progress(1, 'Ready');
  }

  /** Generate the LCDM large-scale structure in a worker (does not block first render). */
  private startWeb(): void {
    try {
      const worker = new Worker(new URL('./workers/zeldovich.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<ZeldovichResult>) => { this.web.setRealisation(ev.data); worker.terminate(); };
      worker.onerror = (err) => console.warn('Cosmic web worker failed', err.message);
      worker.postMessage({ n: this.quality.webGrid, boxMpc: WEB_BOX_MPC, seed: 1420405751, smoothMpc: 3.2 });
    } catch (err) {
      console.warn('Cosmic web unavailable', err);
    }
  }

  // ---------------------------------------------------------------- navigation
  /** Fly to an entity and show its details. */
  goTo(e: Entity, distKm?: number, seconds?: number): Promise<void> {
    this.select(e);
    const idx = this.stars.systemIndexOf(e);
    if (idx > 0 && e.kind === 'exoplanet') this.stars.exoPlanetEntity(idx, parseInt(e.id.split(':')[2], 10)); // ensure position exists
    return this.engine.rig.flyTo(e, distKm, seconds);
  }

  select(e: Entity | null): void {
    this.selected = e;
    this.onSelect?.(e);
  }

  find(name: string): Entity | null {
    return this.byName.get(name.toLowerCase())?.() ?? null;
  }

  register(name: string, get: () => Entity | null): void {
    this.byName.set(name.toLowerCase(), get);
  }

  addSearch(entry: SearchEntry): void {
    this.search.push(entry);
    this.register(entry.label, entry.get);
  }

  private buildSearch(): void {
    const add = (label: string, sub: string, weight: number, get: () => Entity | null, extra = '') => {
      this.search.push({ text: `${label} ${extra}`.toLowerCase(), label, sub, weight, get });
      if (!this.byName.has(label.toLowerCase())) this.byName.set(label.toLowerCase(), get);
    };
    for (const b of this.solar.bodies) add(b.def.name, b.entity.subtitle, 100 + b.entity.rank, () => b.entity, b.def.id);
    add('Milky Way', 'Our galaxy', 190, () => this.milkyway.entity, 'galaxy galactic centre');
    add('Observable Universe', 'Cosmology', 150, () => this.web.entity, 'cmb cosmic microwave background big bang');
    for (const e of this.galaxies.regions()) add(e.name, e.subtitle, 120, () => e);
    const GREEK_FULL: Record<string, string> = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega' };
    const seen = new Set<number>();
    for (const s of this.stars.namedStars()) {
      seen.add(s.i);
      const nm = this.stars.starName(s.i);
      const alt = nm.alt.map((a) => a.replace(/[α-ω]/g, (g) => GREEK_FULL[g] + ' ')).join(' ') + ' ' + nm.alt.join(' ');
      add(s.name, 'Star', 80 - Math.min(20, s.i / 500), () => this.stars.starEntity(s.i), alt);
    }
    for (let i = 1; i < 6000; i++) {
      if (seen.has(i)) continue;
      const nm = this.stars.starName(i);
      if (/^(HIP|HYG|HD)/.test(nm.name)) continue;
      add(nm.name, 'Star', 40 - i / 300, () => this.stars.starEntity(i), nm.name.replace(/[α-ω]/g, (g) => GREEK_FULL[g] + ' ') + ' ' + nm.alt.join(' '));
    }
    for (const h of this.stars.exoHosts()) {
      if (!seen.has(h.s)) add(h.n, `Star · ${h.p.length} planet${h.p.length > 1 ? 's' : ''}`, 35, () => this.stars.starEntity(h.s));
      h.p.forEach((row, k) => add(`${h.n} ${row[0]}`, 'Exoplanet', 30, () => this.stars.exoPlanetEntity(h.s, k)));
    }
    for (let i = 0; i < this.galaxies.count; i++) {
      const nm = this.galaxies.galaxyName(i);
      const txt = this.galaxies.searchText(i);
      const named = !/^(NGC|IC) /.test(nm);
      this.search.push({ text: txt, label: nm, sub: 'Galaxy', weight: named ? 70 : 10, get: () => this.galaxies.galaxyEntity(i) });
      if (named && !this.byName.has(nm.toLowerCase())) this.byName.set(nm.toLowerCase(), () => this.galaxies.galaxyEntity(i));
      const mm = /\bm(\d+)\b/.exec(txt);
      if (mm) this.byName.set(`m${mm[1]}`, () => this.galaxies.galaxyEntity(i));
    }
  }

  query(q: string, limit = 9): SearchEntry[] {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const scored: { e: SearchEntry; s: number }[] = [];
    for (const e of this.search) {
      const i = e.text.indexOf(q);
      if (i < 0) continue;
      const lab = e.label.toLowerCase();
      let s = e.weight;
      if (lab === q) s += 1000;
      else if (lab.startsWith(q)) s += 400;
      else if (i === 0 || e.text[i - 1] === ' ') s += 150;
      s -= e.label.length * 0.5;
      scored.push({ e, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => x.e);
  }

  // ---------------------------------------------------------------- picking
  pick(x: number, y: number): Entity | null {
    const ctx = this.engine.ctx;
    const p = { x: 0, y: 0 };
    let best: Entity | null = null, bestScore = -Infinity;
    const consider = (e: Entity, rel: Vector3, radiusKm: number, markerVisible: boolean) => {
      if (!ctx.project(rel, p)) return;
      const d = rel.length();
      const discPx = ((radiusKm / Math.max(d, 1)) * ctx.pixelScale) / ctx.pixelRatio;
      const r = Math.hypot(p.x - x, p.y - y);
      if (r > Math.max(discPx, markerVisible ? 12 : 0)) return;
      // nearer bodies win; points inside a resolved disc beat marker hits
      const score = (r <= discPx ? 1e6 : 0) - Math.log10(d) * 10 - r;
      if (score > bestScore) { bestScore = score; best = e; }
    };
    if (ctx.sunDistPc < 0.06) for (const b of this.solar.bodies) consider(b.entity, b.rel, b.def.radius, true);
    for (const b of this.stars.activeBodies()) consider(b.entity, b.rel, b.radiusKm, true);
    if (best) return best;
    const scaleKpc = ctx.distKm / KPC_KM;
    const star = scaleKpc < 40 ? this.stars.pick(ctx, x, y) : null;
    const gal = scaleKpc > 0.5 || !star ? this.galaxies.pick(ctx, x, y) : null;
    if (gal && (!star || scaleKpc > 20)) return this.galaxies.galaxyEntity(gal.index);
    if (star) return this.stars.starEntity(star.index);
    return null;
  }

  /** Resolved discs on screen (CSS px), used to hide labels of background objects behind them. */
  occluders(): { x: number; y: number; r: number }[] {
    const ctx = this.engine.ctx;
    const out: { x: number; y: number; r: number }[] = [];
    const p = { x: 0, y: 0 };
    const add = (rel: Vector3, radiusKm: number) => {
      const r = ((radiusKm / Math.max(rel.length(), 1)) * ctx.pixelScale) / ctx.pixelRatio;
      if (r > 5 && ctx.project(rel, p)) out.push({ x: p.x, y: p.y, r });
    };
    if (ctx.sunDistPc < 0.06) for (const b of this.solar.bodies) add(b.rel, b.def.radius);
    for (const b of this.stars.activeBodies()) add(b.rel, b.radiusKm);
    return out;
  }

  // ---------------------------------------------------------------- frame
  frame(dt: number): void {
    this.time += dt;
    if (!this.engine.override) this.clock.step(dt);
    // keep the close-up star system matched to where the camera is (or is heading)
    const rig = this.engine.rig;
    if (rig.focus) {
      const f = rig.flight;
      const near = f ? (f.t < 0.5 ? f.from : f.to) : rig.focus;
      const idx = this.stars.systemIndexOf(near);
      if (idx !== this.stars.activeIndex && !(idx <= 0 && this.stars.activeIndex <= 0)) this.stars.activate(idx);
    }
    this.engine.frame(this.clock.jd, this.time, dt);
  }

  /** Scale stops for the powers-of-ten ruler. */
  scaleStops(): { name: string; log: number; go: () => void }[] {
    const sun = this.solar.sun.entity;
    const mw = this.milkyway.entity;
    const localBody = (): Entity => {
      const t = this.engine.rig.target;
      if (t.kind === 'planet' || t.kind === 'moon' || t.kind === 'dwarf' || t.kind === 'exoplanet') return t;
      return this.solar.byId.get('earth')!.entity;
    };
    const planetOf = (e: Entity): Entity => (e.kind === 'moon' && e.parent ? e.parent : e);
    return [
      { name: 'Planet', log: 4.45, go: () => { const b = localBody(); this.goTo(b, b.viewDist); } },
      { name: 'Moons', log: 6.2, go: () => { const b = planetOf(localBody()); this.goTo(b, Math.max(b.radiusKm * 60, 1.4e6)); } },
      { name: 'Inner planets', log: 8.85, go: () => this.goTo(sun, 4.6 * AU_KM) },
      { name: 'Solar system', log: 10.1, go: () => this.goTo(sun, 85 * AU_KM) },
      { name: 'Nearby stars', log: 14.25, go: () => this.goTo(sun, 1.8e14) },
      { name: 'Milky Way', log: 18.15, go: () => { this.faceOnGalaxy(0.45); this.goTo(mw, 46 * KPC_KM); } },
      { name: 'Local Group', log: 19.85, go: () => this.goTo(mw, 2.3 * MPC_KM) },
      { name: 'Virgo Supercluster', log: 21.3, go: () => this.goTo(mw, 65 * MPC_KM) },
      { name: 'Cosmic web', log: 22.15, go: () => this.goTo(mw, 450 * MPC_KM) },
      { name: 'Observable universe', log: 24.09, go: () => this.goTo(this.web.entity, this.web.entity.viewDist) },
    ];
  }

  /** Turn the camera to look down on the galactic plane (tilt = radians away from exactly face-on). */
  faceOnGalaxy(tilt = 0): void {
    const n = GALACTIC_NORTH;
    const rig = this.engine.rig;
    const yaw = Math.atan2(n.x, n.z), pitch = -Math.asin(n.y) + tilt;
    // ease there over the flight
    const y0 = rig.yaw, p0 = rig.pitch;
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 2500);
      const u = t * t * (3 - 2 * t);
      rig.yaw = y0 + dy * u; rig.pitch = p0 + (pitch - p0) * u;
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }

  rel(e: Entity): Vector3 { return this.engine.ctx.rel(e, this._v); }
}
