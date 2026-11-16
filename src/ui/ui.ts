import { LIVE } from '../scene/solar';
import { Vector3 } from 'three';
// DOM user interface: labels, search, scale ruler, readouts, info panel, time controls, tour.

import type { App } from '../app';
import { TIME_RATES } from '../app';
import { AU_KM, KPC_KM, MPC_KM, PC_KM, jdToCalendar } from '../core/constants';
import type { FrameContext } from '../engine/engine';
import type { Entity } from '../engine/entity';
import type { LabelSpec } from '../engine/labels';
import { QUALITY, lowerQuality } from '../engine/quality';
import { fmtDist, fmtParsec, sig } from './format';
import { TOUR, type TourStep } from './tour';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RULER_MIN = 3.7, RULER_MAX = 24.3;

function domain(km: number): string {
  if (km < 4e5) return 'Planet';
  if (km < 2e7) return 'Moon system';
  if (km < 1.5e10) return 'Planetary system';
  if (km < 0.6 * PC_KM) return 'Outer solar system';
  if (km < 400 * PC_KM) return 'Stellar neighbourhood';
  if (km < 150 * KPC_KM) return 'Milky Way';
  if (km < 6 * MPC_KM) return 'Local Group';
  if (km < 150 * MPC_KM) return 'Local supercluster';
  if (km < 3000 * MPC_KM) return 'Cosmic web';
  return 'Observable universe';
}

export class UI {
  showLabels = true;
  private labelEls = new Map<string, { el: HTMLElement; spec: LabelSpec; used: boolean }>();
  private specs: LabelSpec[] = [];
  private stops: { name: string; log: number; go: () => void }[] = [];
  private infoEntity: Entity | null = null;
  private infoTimer = 0;
  private searchSel = 0;
  private searchItems: ReturnType<App['query']> = [];
  private tourIndex = -1;
  private tourToken = 0;
  private cosmicPlaying = false;
  private interacted = false;
  private lastDate = '';
  private frameCount = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(private app: App) {
    this.bindPointer();
    this.bindSearch();
    this.bindTime();
    this.bindSettings();
    this.bindTour();
    this.bindCosmic();
    this.buildRuler();
    app.onSelect = (e) => this.showInfo(e);
    $('info-close').onclick = () => { this.infoEntity = null; $('info').hidden = true; };
    window.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  // ------------------------------------------------------------------ input
  private bindPointer(): void {
    const canvas = this.app.engine.canvas;
    const rig = this.app.engine.rig;
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, downX = 0, downY = 0, pinch = 0, lastT = 0;
    const touched = () => { if (!this.interacted) { this.interacted = true; $('hint').classList.add('gone'); } };
    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) { moved = 0; downX = ev.clientX; downY = ev.clientY; rig.yawVel = rig.pitchVel = 0; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      canvas.classList.add('dragging');
      this.closePopovers();
    });
    // hover: find what is under the cursor a few times a second
    let hoverAt = 0;
    canvas.addEventListener('pointermove', (ev) => {
      if (pts.size || ev.pointerType === 'touch' || this.controller || !this.app.advanced) return;
      const now = performance.now();
      if (now - hoverAt < 110) return;
      hoverAt = now;
      const r = canvas.getBoundingClientRect();
      this.hoverEntity = this.app.pick(ev.clientX - r.left, ev.clientY - r.top);
      canvas.style.cursor = this.hoverEntity ? 'pointer' : '';
    });
    canvas.addEventListener('pointerleave', () => { this.hoverEntity = null; });
    canvas.addEventListener('pointermove', (ev) => {
      const p = pts.get(ev.pointerId);
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      p.x = ev.clientX; p.y = ev.clientY;
      if (pts.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        const k = 0.0052;
        (this.controller ?? rig).rotate(-dx * k, -dy * k);
        const now = performance.now();
        const dt = Math.max(1, now - lastT) / 1000; lastT = now;
        if (!this.controller) { rig.yawVel = (-dx * k) / dt * 0.35; rig.pitchVel = (-dy * k) / dt * 0.35; }
        if (moved > 4) touched();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) (this.controller ?? rig).zoom(Math.log(pinch / d) * 1.6);
        pinch = d; moved += 10; touched();
      }
    });
    const up = (ev: PointerEvent) => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      if (pts.size === 0) {
        canvas.classList.remove('dragging');
        if (moved < 5 && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 5) {
          rig.yawVel = rig.pitchVel = 0;
          if (this.controller) return;
          const r = canvas.getBoundingClientRect();
          const e = this.app.pick(ev.clientX - r.left, ev.clientY - r.top);
          if (e) { this.stopTour(); this.app.goTo(e); touched(); }
        }
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 32 : 1;
      (this.controller ?? rig).zoom(Math.max(-1.2, Math.min(1.2, ev.deltaY * unit * (ev.ctrlKey ? 0.012 : 0.0022))));
      touched();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  private onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT');
    if (ev.key === 'Escape') { this.closePopovers(); (document.activeElement as HTMLElement)?.blur(); if (this.tourIndex >= 0) this.stopTour(); return; }
    if (typing) return;
    const rig = this.app.engine.rig, c = this.app.clock;
    const key = ev.key.toLowerCase();
    if (this.app.advanced && !ev.repeat && key === 'f' && !ev.ctrlKey && !ev.metaKey) { this.setFlying(!rig.flying); return; }
    if (rig.flying && ['w', 'a', 's', 'd', 'r', 'v', 'shift'].includes(key)) { this.keys.add(key); ev.preventDefault(); return; }
    switch (ev.key) {
      case '/': ev.preventDefault(); $<HTMLInputElement>('search-input').focus(); break;
      case ' ': ev.preventDefault(); c.paused = !c.paused; break;
      case '.': case '>': c.rateIndex = Math.min(TIME_RATES.length - 1, c.rateIndex + 1); c.paused = false; break;
      case ',': case '<': c.rateIndex = Math.max(0, c.rateIndex - 1); break;
      case '+': case '=': rig.zoom(-0.5); break;
      case '-': case '_': rig.zoom(0.5); break;
      case 'ArrowLeft': rig.rotate(0.08, 0); break;
      case 'ArrowRight': rig.rotate(-0.08, 0); break;
      case 'ArrowUp': rig.rotate(0, 0.06); break;
      case 'ArrowDown': rig.rotate(0, -0.06); break;
      case 'h': case 'H': document.body.classList.toggle('ui-hidden'); break;
      case 'l': case 'L': this.showLabels = !this.showLabels; $<HTMLInputElement>('set-labels').checked = this.showLabels; break;
    }
  }

  private closePopovers(): void {
    $('settings').hidden = true;
    $('btn-settings').setAttribute('aria-expanded', 'false');
    $('search-results').hidden = true;
    $('about').hidden = true;
  }

  // ------------------------------------------------------------------ search
  private bindSearch(): void {
    const input = $<HTMLInputElement>('search-input');
    const list = $('search-results');
    const render = () => {
      this.searchItems = this.app.query(input.value);
      this.searchSel = 0;
      list.innerHTML = '';
      list.hidden = this.searchItems.length === 0;
      this.searchItems.forEach((it, i) => {
        const li = document.createElement('li');
        if (i === 0) li.className = 'sel';
        const a = document.createElement('span'); a.textContent = it.label;
        const b = document.createElement('span'); b.textContent = it.sub;
        li.append(a, b);
        li.onpointerdown = (ev) => { ev.preventDefault(); choose(i); };
        list.appendChild(li);
      });
    };
    const choose = (i: number) => {
      const it = this.searchItems[i];
      if (!it) return;
      const e = it.get();
      list.hidden = true;
      input.value = '';
      input.blur();
      if (e) { this.stopTour(); this.app.goTo(e); }
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const n = this.searchItems.length;
        if (!n) return;
        this.searchSel = (this.searchSel + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
        [...list.children].forEach((c, i) => c.classList.toggle('sel', i === this.searchSel));
      } else if (ev.key === 'Enter') { ev.preventDefault(); choose(this.searchSel); }
    });
  }

  // ------------------------------------------------------------------ time
  private bindTime(): void {
    const c = this.app.clock;
    $('time-play').onclick = () => { c.paused = !c.paused; };
    $('time-faster').onclick = () => { c.rateIndex = Math.min(TIME_RATES.length - 1, c.rateIndex + 1); c.paused = false; };
    $('time-slower').onclick = () => { c.rateIndex = Math.max(0, c.rateIndex - 1); };
    $('time-rev').onclick = () => { c.direction *= -1; c.paused = false; };
    $('time-now').onclick = () => c.now();
  }

  private fmtDate(jd: number): string {
    const c = jdToCalendar(jd);
    if (c.y > 0 && c.y < 10000) {
      const rate = TIME_RATES[this.app.clock.rateIndex][0];
      const date = `${c.y} ${MONTHS[c.m - 1]} ${String(c.d).padStart(2, '0')}`;
      if (rate >= 86400 * 365 && !this.app.clock.paused) return date;
      return `${date}  ${String(c.h).padStart(2, '0')}:${String(c.min).padStart(2, '0')}${rate < 3600 || this.app.clock.paused ? ':' + String(c.s).padStart(2, '0') : ''} UTC`;
    }
    return c.y <= 0 ? `${(1 - c.y).toLocaleString('en-US')} BCE` : `Year ${c.y.toLocaleString('en-US')}`;
  }

  // ------------------------------------------------------------------ settings
  private bindSettings(): void {
    const app = this.app;
    const btn = $('btn-settings'), panel = $('settings');
    btn.onclick = () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); };
    const chk = (id: string, fn: (v: boolean) => void) => { const el = $<HTMLInputElement>(id); el.onchange = () => fn(el.checked); };
    const rng = (id: string, fn: (v: number) => void) => { const el = $<HTMLInputElement>(id); el.oninput = () => fn(parseFloat(el.value)); };
    chk('set-orbits', (v) => (app.solar.showOrbits = v));
    chk('set-labels', (v) => (this.showLabels = v));
    chk('set-const', (v) => (app.stars.showConstellations = v));
    chk('set-belt', (v) => (app.solar.showBelt = v));
    chk('set-web', (v) => (app.web.enabled = v));
    chk('set-craft', (v) => (app.craft.show = v));
    chk('set-guides', (v) => (app.guides.show = v));
    chk('set-dso', (v) => (app.deepsky.show = v));
    chk('set-lens', (v) => { app.engine.lens.enabled = v; });
    // speed slider: beta = 1 - 10^(-4 x), so the top of the range reaches 0.9999 c
    rng('set-beta', (v) => {
      const beta = v <= 0 ? 0 : 1 - Math.pow(10, (-4 * v) / 1000);
      app.engine.beta = beta;
      const gamma = 1 / Math.sqrt(1 - beta * beta);
      $('set-beta-read').textContent = beta === 0 ? 'at rest \u00b7 drag to fly at near light speed' : `${beta.toFixed(beta > 0.99 ? 4 : 3)} c \u00b7 \u03b3 = ${sig(gamma, 3)}`;
      $('warp').hidden = beta === 0;
      $('warp-speed').textContent = `${(beta * 100).toFixed(beta > 0.99 ? 2 : 1)}% of light speed`;
      $('warp-detail').textContent = `time dilation \u00d7${sig(gamma, 3)} \u00b7 sky ahead blueshifted \u00d7${sig(gamma * (1 + beta), 3)}`;
    });
    $('btn-share').onclick = () => this.share();
    $('btn-fly').onclick = () => this.setFlying(!app.engine.rig.flying);
    $('fly-exit').onclick = () => this.setFlying(false);
    const hold = (id: string, z: number) => {
      const el = $(id);
      const set = (v: number) => (ev: Event) => { ev.preventDefault(); this.padThrust = v; };
      el.addEventListener('pointerdown', set(z)); el.addEventListener('pointerup', set(0)); el.addEventListener('pointerleave', set(0)); el.addEventListener('pointercancel', set(0));
    };
    hold('fly-fwd', 1); hold('fly-back', -1);
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    $('btn-advanced').onclick = () => this.setAdvanced(!app.advanced);
    let stored = false;
    try { stored = localStorage.getItem('ue.advanced') === '1'; } catch { /* storage unavailable */ }
    this.setAdvanced(stored || location.hash.startsWith('#at/'), false);
    rng('set-mag', (v) => (app.stars.magLimit = v));
    rng('set-exposure', (v) => (app.engine.exposure = v));
    rng('set-bloom', (v) => { app.engine.bloom.strength = v; app.engine.bloom.enabled = v > 0.01; });
    const q = $<HTMLSelectElement>('set-quality');
    q.value = app.quality.name;
    q.onchange = () => {
      if (!(q.value in QUALITY)) return;
      this.reloadWithQuality(q.value);
    };
    $('btn-lab').onclick = () => this.onLab?.();
    $('btn-about').onclick = () => { $('about').hidden = false; panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    $('about-close').onclick = () => { $('about').hidden = true; };
  }
  /** Remember the detail level and restart. Storage is preferred: some hosts drop query strings. */
  private reloadWithQuality(name: string): void {
    let stored = false;
    try { localStorage.setItem('ue.quality', name); stored = localStorage.getItem('ue.quality') === name; } catch { /* fall through to the URL */ }
    const u = new URL(location.href);
    if (stored) { u.searchParams.delete('q'); if (u.toString() === location.href) { location.reload(); return; } }
    else u.searchParams.set('q', name);
    location.replace(u.toString());
  }
  private keys = new Set<string>();
  private padThrust = 0;
  /** Free flight: WASD moves the camera itself instead of orbiting a target. */
  setFlying(on: boolean): void {
    const rig = this.app.engine.rig;
    if (on && (!this.app.advanced || this.controller)) return;
    if (on) this.stopTour();
    rig.setFlying(on);
    this.keys.clear(); this.padThrust = 0;
    $('flight').hidden = !on;
    $('btn-fly').setAttribute('aria-pressed', String(on));
    if (on) this.closePopovers();
  }
  private updateFlight(): void {
    const rig = this.app.engine.rig;
    if (!rig.flying) return;
    const k = this.keys;
    const boost = k.has('shift') ? 4 : 1;
    rig.thrust.set((k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0), (k.has('r') ? 1 : 0) - (k.has('v') ? 1 : 0), (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0) + this.padThrust).multiplyScalar(boost);
    const v = rig.speedKmS;
    const c = v / 299792.458;
    const txt = v < 0.5 ? 'holding position' : c < 0.01 ? `${sig(v, 3)} km/s` : c < 100 ? `${sig(c, 3)} c` : `${sig(c, 3)} \u00d7 light speed`;
    const el = $('flight-speed');
    if (el.textContent !== txt) el.textContent = txt;
  }

  /** Switch between the classic experience and the advanced feature set. */
  setAdvanced(on: boolean, remember = true): void {
    const app = this.app;
    app.advanced = on;
    const checked = (id: string) => $<HTMLInputElement>(id).checked;
    LIVE.value = on ? 1 : 0;
    app.craft.show = on && checked('set-craft');
    app.guides.show = on && checked('set-guides');
    app.deepsky.show = on && checked('set-dso');
    app.engine.lens.enabled = on && checked('set-lens');
    const beta = $<HTMLInputElement>('set-beta');
    if (!on) beta.value = '0';
    beta.dispatchEvent(new Event('input'));
    $('adv-settings').hidden = !on;
    const b = $('btn-advanced');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Advanced \u00b7 on' : 'Advanced';
    if (!on) this.setFlying(false);
    if (!on) { this.hoverEntity = null; this.app.engine.canvas.style.cursor = ''; }
    // leaving advanced mode while parked on a probe: go home
    if (!on && app.engine.rig.target.kind === 'spacecraft') { const sun = app.find('Sun'); if (sun) app.goTo(sun, 85 * AU_KM); }
    if (remember) { try { localStorage.setItem('ue.advanced', on ? '1' : '0'); } catch { /* not remembered */ } }
  }

  private async share(): Promise<void> {
    const u = new URL(location.href);
    u.hash = this.app.viewState();
    const b = $('btn-share');
    try {
      await navigator.clipboard.writeText(u.toString());
      b.textContent = 'Link copied';
    } catch {
      // clipboard unavailable: put the link in the address bar instead
      try { history.replaceState(null, '', u.toString()); b.textContent = 'Link is in the address bar'; } catch { b.textContent = 'Copy not available here'; }
    }
    setTimeout(() => { b.textContent = 'Copy link to this view'; }, 2200);
  }
  onLab: (() => void) | null = null;
  /** when set (gravity lab), pointer gestures drive this instead of the universe camera */
  controller: { rotate(dYaw: number, dPitch: number): void; zoom(dLn: number): void } | null = null;

  // ------------------------------------------------------------------ cosmic time
  private bindCosmic(): void {
    const slider = $<HTMLInputElement>('cosmic-slider');
    const web = this.app.web;
    // slider is linear in ln(a) from a = 0.02 (z = 49) to 1
    const toA = (v: number) => Math.exp(Math.log(0.02) * (1 - v / 1000));
    slider.oninput = () => { this.cosmicPlaying = false; web.scaleFactor = toA(parseFloat(slider.value)); this.cosmicRead(); };
    $('cosmic-play').onclick = () => {
      this.cosmicPlaying = !this.cosmicPlaying;
      if (this.cosmicPlaying && web.scaleFactor > 0.995) { slider.value = '0'; web.scaleFactor = toA(0); }
    };
  }
  private cosmicRead(): void {
    const web = this.app.web;
    const z = web.redshift;
    $('cosmic-age').textContent = `${web.age < 1 ? sig(web.age * 1000, 3) + ' Myr' : sig(web.age, 3) + ' Gyr'} after the Big Bang`;
    $('cosmic-z').textContent = z < 0.005 ? 'z = 0 · today' : `z = ${z.toFixed(z < 3 ? 2 : 1)}`;
    $('cosmic-play').textContent = this.cosmicPlaying ? 'Pause' : 'Play';
  }

  // ------------------------------------------------------------------ ruler
  private buildRuler(): void {
    this.stops = this.app.scaleStops();
    const ol = $('ruler-stops');
    for (const s of this.stops) {
      const li = document.createElement('li');
      li.style.top = `${((s.log - RULER_MIN) / (RULER_MAX - RULER_MIN)) * 100}%`;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.textContent = s.name;
      const go = () => { this.stopTour(); s.go(); };
      li.onclick = go;
      li.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
      ol.appendChild(li);
    }
  }

  // ------------------------------------------------------------------ info panel
  showInfo(e: Entity | null): void {
    this.infoEntity = e;
    const panel = $('info');
    if (!e || !e.getInfo) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.scrollTop = 0;
    this.renderInfo(true);
  }

  private renderInfo(full: boolean): void {
    const e = this.infoEntity;
    if (!e?.getInfo) return;
    const info = e.getInfo();
    if (full) {
      $('info-sub').textContent = info.subtitle;
      $('info-title').textContent = info.title;
      $('info-blurb').textContent = info.blurb ?? '';
      const links = $('info-links');
      links.innerHTML = '';
      for (const l of (info.links ?? []).slice(0, 14)) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = l.label;
        b.onclick = () => { const t = l.get(); if (t) { this.stopTour(); this.app.goTo(t); } };
        links.appendChild(b);
      }
      const notes = $('info-notes');
      notes.innerHTML = '';
      for (const n of info.notes ?? []) { const li = document.createElement('li'); li.textContent = n; notes.appendChild(li); }
    }
    const dl = $('info-rows');
    const kids = dl.children;
    if (full || kids.length !== info.rows.length * 2) {
      dl.innerHTML = '';
      for (const r of info.rows) {
        const dt = document.createElement('dt'); dt.textContent = r.k;
        const dd = document.createElement('dd'); dd.textContent = r.v;
        if (r.hint) { const s = document.createElement('small'); s.textContent = r.hint; dd.appendChild(s); }
        dl.append(dt, dd);
      }
    } else {
      info.rows.forEach((r, i) => {
        const dd = kids[i * 2 + 1] as HTMLElement;
        const want = r.v + (r.hint ? '\u0001' + r.hint : '');
        if (dd.dataset.v !== want) {
          dd.dataset.v = want;
          dd.textContent = r.v;
          if (r.hint) { const s = document.createElement('small'); s.textContent = r.hint; dd.appendChild(s); }
        }
      });
    }
  }

  // ------------------------------------------------------------------ tour
  private bindTour(): void {
    $('btn-tour').onclick = () => (this.tourIndex >= 0 ? this.stopTour() : this.tourGo(0));
    $('tour-next').onclick = () => this.tourGo(this.tourIndex + 1);
    $('tour-prev').onclick = () => this.tourGo(this.tourIndex - 1);
    $('tour-stop').onclick = () => this.stopTour();
  }

  private tourGo(i: number): void {
    if (i < 0) i = 0;
    if (i >= TOUR.length) { this.stopTour(); return; }
    this.setFlying(false);
    this.tourIndex = i;
    const step: TourStep = TOUR[i];
    const token = ++this.tourToken;
    $('tour').hidden = false;
    $('btn-tour').setAttribute('aria-pressed', 'true');
    $('tour-step').textContent = `Grand tour · ${i + 1} of ${TOUR.length}`;
    $('tour-title').textContent = step.title;
    $('tour-text').textContent = step.text;
    $('tour-next').textContent = i === TOUR.length - 1 ? 'Finish' : 'Next';
    ($('tour-prev') as HTMLButtonElement).disabled = i === 0;
    const app = this.app;
    const e = step.target(app);
    if (!e) return;
    const rig = app.engine.rig;
    if (step.rate != null) { app.clock.rateIndex = step.rate; app.clock.paused = false; app.clock.direction = 1; }
    rig.autoRotate = 0;
    app.goTo(e, step.dist ? step.dist(e) : undefined).then(() => { if (token === this.tourToken) rig.autoRotate = step.spin ?? 0.03; });
    if (step.pitch != null) this.easePitch(step.pitch, token);
    $('info').hidden = true;
  }

  private easePitch(target: number, token: number): void {
    const rig = this.app.engine.rig;
    const tick = () => {
      if (token !== this.tourToken) return;
      rig.pitch += (target - rig.pitch) * 0.04;
      if (Math.abs(target - rig.pitch) > 0.004) requestAnimationFrame(tick);
    };
    tick();
  }

  stopTour(): void {
    if (this.tourIndex < 0) return;
    this.tourIndex = -1;
    this.tourToken++;
    this.app.engine.rig.autoRotate = 0;
    $('tour').hidden = true;
    $('btn-tour').setAttribute('aria-pressed', 'false');
  }

  // ------------------------------------------------------------------ per-frame
  update(ctx: FrameContext, dt: number): void {
    const app = this.app;
    const rig = app.engine.rig;
    // readout
    const d = ctx.distKm;
    $('readout-domain').textContent = domain(d);
    const main = fmtDist(d);
    const el = $('readout-dist');
    if (el.textContent !== main) el.textContent = main;
    const alt = d > 0.05 * AU_KM && d < 0.1 * 9.46e12 ? fmtDist(d).includes('AU') ? `${sig(d / 1e6, 3)} million km` : '' : d >= 0.1 * 9.46e12 ? fmtParsec(d) : '';
    $('readout-from').textContent = `from ${rig.target.name}${alt ? ' · ' + alt : ''}`;
    // ruler
    const lg = Math.log10(Math.max(d, 1));
    $('ruler-marker').style.top = `${Math.min(100, Math.max(0, ((lg - RULER_MIN) / (RULER_MAX - RULER_MIN)) * 100))}%`;
    let nearest = 0;
    this.stops.forEach((s, i) => { if (Math.abs(s.log - lg) < Math.abs(this.stops[nearest].log - lg)) nearest = i; });
    const lis = $('ruler-stops').children;
    for (let i = 0; i < lis.length; i++) lis[i].classList.toggle('on', i === nearest && Math.abs(this.stops[i].log - lg) < 0.9);
    // time
    const ds = this.fmtDate(ctx.jd);
    if (ds !== this.lastDate) { $('time-date').textContent = ds; this.lastDate = ds; }
    $('time-rate').textContent = app.clock.rateLabel;
    $('time-play').textContent = app.clock.paused ? '▶' : '❚❚';
    $('time-rev').setAttribute('aria-pressed', String(app.clock.direction < 0));
    // cosmic time panel
    const showCosmic = app.web.ready && app.web.enabled && d > 25 * MPC_KM && this.tourIndex < 0;
    if ($('cosmic').hidden === showCosmic) { $('cosmic').hidden = !showCosmic; this.cosmicRead(); }
    if (!showCosmic && app.web.scaleFactor < 1 && d < 10 * MPC_KM) { app.web.scaleFactor = 1; $<HTMLInputElement>('cosmic-slider').value = '1000'; this.cosmicPlaying = false; }
    if (this.cosmicPlaying) {
      const slider = $<HTMLInputElement>('cosmic-slider');
      const v = Math.min(1000, parseFloat(slider.value) + dt * 110);
      slider.value = String(v);
      app.web.scaleFactor = Math.exp(Math.log(0.02) * (1 - v / 1000));
      if (v >= 1000) this.cosmicPlaying = false;
      this.cosmicRead();
    }
    // info panel live values
    this.infoTimer += dt;
    if (this.infoTimer > 0.5 && this.infoEntity && !$('info').hidden) { this.infoTimer = 0; this.renderInfo(false); }
    // fps / stats
    this.frameCount++; this.fpsTime += dt;
    if (this.fpsTime > 1) {
      this.fps = this.frameCount / this.fpsTime; this.frameCount = 0; this.fpsTime = 0;
      this.watchPerformance();
      if (!$('settings').hidden) {
        const w = app.web.stats;
        $('set-stats').textContent = `${this.fps.toFixed(0)} fps · ${app.quality.name}${w.n ? ` · web ${w.n}³, σ=${w.sigma.toFixed(2)}` : ''}`;
      }
    }
    this.updateFlight();
    this.updateHud(ctx);
    this.updateLabels(ctx);
  }

  /** Offer a lower detail level after several consecutive slow seconds. */
  private slowSeconds = 0;
  private perfAsked = false;
  private watchPerformance(): void {
    if (this.perfAsked || document.hidden) return;
    this.slowSeconds = this.fps < 17 ? this.slowSeconds + 1 : 0;
    const lower = lowerQuality(this.app.quality);
    if (this.slowSeconds < 5 || !lower) return;
    this.perfAsked = true;
    $('perf').hidden = false;
    $('perf-dismiss').onclick = () => { $('perf').hidden = true; };
    $('perf-lower').onclick = () => {
      this.reloadWithQuality(lower.name);
    };
  }

  private hoverEntity: Entity | null = null;
  private lockedOn: Entity | null = null;
  private hudV = new Vector3();
  /** Targeting brackets on the current target and on whatever is under the cursor. */
  private updateHud(ctx: FrameContext): void {
    const place = (el: HTMLElement, e: Entity | null, minHalf: number): boolean => {
      if (!e) { el.hidden = true; return false; }
      const rel = ctx.rel(e, this.hudV);
      const p = { x: 0, y: 0 };
      if (!ctx.project(rel, p)) { el.hidden = true; return false; }
      const disc = ((e.radiusKm / Math.max(rel.length(), 1)) * ctx.pixelScale) / ctx.pixelRatio;
      if (disc > Math.min(ctx.width, ctx.height) * 0.3) { el.hidden = true; return false; }
      const half = Math.max(minHalf, disc + 7);
      el.hidden = false;
      el.style.width = el.style.height = `${half * 2}px`;
      el.style.transform = `translate3d(${Math.round(p.x - half)}px, ${Math.round(p.y - half)}px, 0)`;
      return true;
    };
    if (!this.app.advanced) { $('reticle').hidden = true; $('hover').hidden = true; return; }
    const target = ctx.rig.target;
    const ret = $('reticle');
    place(ret, target.kind === 'region' ? null : target, 15);
    if (target !== this.lockedOn) { this.lockedOn = target; ret.classList.remove('lock'); void ret.offsetWidth; ret.classList.add('lock'); }
    const h = this.hoverEntity && this.hoverEntity !== target ? this.hoverEntity : null;
    if (place($('hover'), h, 11) && h) {
      const txt = `${h.name} \u00b7 ${fmtDist(ctx.rel(h, this.hudV).length())}`;
      const t = $('hover-text');
      if (t.textContent !== txt) t.textContent = txt;
    }
  }

  private updateLabels(ctx: FrameContext): void {
    const specs = this.specs;
    specs.length = 0;
    if (this.showLabels) {
      const add = (l: LabelSpec) => specs.push(l);
      for (const s of this.app.labelSystems) s.labels?.(ctx, add);
    }
    specs.sort((a, b) => b.priority - a.priority);
    // greedy declutter on a coarse occupancy grid
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const v of this.labelEls.values()) v.used = false;
    let shown = 0;
    const W = ctx.width, H = ctx.height;
    const discs = this.app.occluders();
    for (const s of specs) {
      if (shown >= 46) break;
      if (discs.length && s.kind !== 'planet' && s.kind !== 'moon' && s.kind !== 'dwarf' && s.priority < 1000) {
        let hidden = false;
        for (const c of discs) { if ((s.x - c.x) ** 2 + (s.y - c.y) ** 2 < c.r * c.r) { hidden = true; break; } }
        if (hidden) continue;
      }
      if (s.x < -40 || s.x > W + 40 || s.y < 40 || s.y > H - 30) continue;
      const centered = s.kind === 'constellation' || s.kind === 'region';
      const w = s.text.length * (centered ? 7.4 : 6.6) + 12, h = 17;
      const x0 = centered ? s.x - w / 2 : s.x + (s.offset ?? 6), y0 = s.y - h / 2;
      const box = { x0, y0, x1: x0 + w, y1: y0 + h };
      let clash = false;
      for (const p of placed) { if (box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0) { clash = true; break; } }
      if (clash) continue;
      placed.push(box);
      shown++;
      const key = s.key ?? s.text;
      let rec = this.labelEls.get(key);
      if (!rec) {
        const el = document.createElement('div');
        el.className = 'lbl';
        el.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          const sp = this.labelEls.get(key)?.spec;
          const e = sp?.entity ?? sp?.resolve?.();
          if (e) { this.stopTour(); this.app.goTo(e); }
        });
        $('labels').appendChild(el);
        rec = { el, spec: s, used: true };
        this.labelEls.set(key, rec);
      }
      rec.used = true;
      rec.spec = s;
      const el = rec.el;
      if (el.textContent !== s.text) el.textContent = s.text;
      const cls = `lbl k-${s.kind ?? 'x'}${centered ? ' center' : ''}${s.entity || s.resolve ? ' clickable' : ''}${s.entity && s.entity === this.app.engine.rig.target ? ' focus' : ''}`;
      if (el.className !== cls) el.className = cls;
      el.style.color = s.color ?? '';
      el.style.opacity = String(s.alpha ?? 1);
      el.style.transform = `translate3d(${Math.round(centered ? s.x - w / 2 + 4 : x0)}px, ${Math.round(s.y)}px, 0)`;
    }
    for (const [k, v] of this.labelEls) {
      if (!v.used) { v.el.remove(); this.labelEls.delete(k); }
    }
  }
}
