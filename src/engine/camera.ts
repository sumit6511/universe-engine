// Multi-scale orbit camera.
//
// The camera always orbits a focus entity at a distance stored logarithmically, so the same
// gestures work from 10 km above Deimos to 30 Gpc from the Milky Way.  All positions are kept
// as (anchor parsec, local km) pairs in double precision; see Entity.

import { Quaternion, Vector3 } from 'three';
import { MPC_KM, PC_KM } from '../core/constants';
import type { Entity } from './entity';

const MAX_DIST_KM = 3.2e4 * MPC_KM; // ~32 Gpc
const _v = new Vector3();
const _d = new Vector3();
const _qy = new Quaternion();
const _qx = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

interface Flight {
  from: Entity;
  to: Entity;
  t: number;
  duration: number;
  lnD0: number;
  lnD1: number;
  resolve?: () => void;
}

export class CameraRig {
  focus!: Entity;
  /** current and target ln(distance in km) */
  lnDist = Math.log(3e4);
  lnDistTarget = Math.log(3e4);
  yaw = 0.6;
  pitch = -0.25;
  yawVel = 0;
  pitchVel = 0;
  autoRotate = 0; // rad/s
  quaternion = new Quaternion();
  /** camera position: anchor (pc) + local (km) */
  anchor = new Vector3();
  local = new Vector3();
  /** point the camera orbits (same split) */
  focusAnchor = new Vector3();
  focusLocal = new Vector3();
  flight: Flight | null = null;
  fov = 50;
  onArrive: ((e: Entity) => void) | null = null;

  get distKm(): number {
    return Math.exp(this.lnDist);
  }

  setFocus(e: Entity, distKm?: number): void {
    this.flight = null;
    this.focus?.onFocus?.(false);
    this.focus = e;
    e.onFocus?.(true);
    if (distKm) this.lnDist = this.lnDistTarget = Math.log(distKm);
    this.clampDist();
  }

  /** Smoothly travel to another entity (zoom out, pan, zoom in). */
  flyTo(e: Entity, distKm?: number, seconds?: number): Promise<void> {
    const from = this.flight ? this.flight.to : this.focus;
    const d1 = Math.max(e.minDist, distKm ?? e.viewDist);
    if (from === e) {
      this.lnDistTarget = Math.log(d1);
      this.flight = null;
      return Promise.resolve();
    }
    e.relativeTo(from.anchor, from.local, _d);
    const sep = _d.length();
    const lnD0 = this.lnDist;
    const lnD1 = Math.log(d1);
    const lnPeak = Math.max(lnD0, lnD1, Math.log(Math.max(sep, 1) * 0.9));
    const travel = (lnPeak - lnD0 + (lnPeak - lnD1)) / Math.LN10; // decades zoomed through
    const duration = seconds ?? Math.min(9, 1.6 + 0.32 * travel);
    // make the old focus current until the pan is half done, then hand over (precision; see update)
    return new Promise((resolve) => {
      this.flight = { from, to: e, t: 0, duration, lnD0, lnD1, resolve };
    });
  }

  zoom(deltaLn: number): void {
    if (this.flight) this.flight.lnD1 = this.clampLn(this.flight.lnD1 + deltaLn, this.flight.to);
    else this.lnDistTarget = this.clampLn(this.lnDistTarget + deltaLn, this.focus);
  }

  setDistance(km: number, immediate = false): void {
    this.lnDistTarget = this.clampLn(Math.log(km), this.focus);
    if (immediate) this.lnDist = this.lnDistTarget;
  }

  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.5533, Math.min(1.5533, this.pitch + dPitch));
  }

  private clampLn(ln: number, e: Entity): number {
    return Math.max(Math.log(e.minDist), Math.min(Math.log(MAX_DIST_KM), ln));
  }
  private clampDist(): void {
    this.lnDistTarget = this.clampLn(this.lnDistTarget, this.focus);
    this.lnDist = this.clampLn(this.lnDist, this.focus);
  }

  update(dt: number): void {
    // inertia
    if (Math.abs(this.yawVel) + Math.abs(this.pitchVel) > 1e-5) {
      this.rotate(this.yawVel * dt, this.pitchVel * dt);
      const k = Math.exp(-dt * 4.5);
      this.yawVel *= k;
      this.pitchVel *= k;
    }
    if (this.autoRotate) this.yaw += this.autoRotate * dt;

    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const t = f.t;
      f.to.relativeTo(f.from.anchor, f.from.local, _d); // km, from -> to
      const sep = _d.length();
      const u = smoother(t);
      // zoom profile: interpolate ln(d) and add a hump so both ends are in view mid-flight
      const lnPeak = Math.max(f.lnD0, f.lnD1, Math.log(Math.max(sep, 1) * 0.9));
      const base = f.lnD0 + (f.lnD1 - f.lnD0) * u;
      const hump = Math.sin(Math.PI * t) ** 2;
      const mid = f.lnD0 + (f.lnD1 - f.lnD0) * 0.5;
      this.lnDist = base + Math.max(0, lnPeak - mid) * hump;
      // pan progress happens while zoomed out
      const s = smoother(Math.min(1, Math.max(0, (t - 0.18) / 0.64)));
      if (s < 0.5) {
        this.focusAnchor.copy(f.from.anchor);
        this.focusLocal.copy(f.from.local).addScaledVector(_d, s);
      } else {
        this.focusAnchor.copy(f.to.anchor);
        this.focusLocal.copy(f.to.local).addScaledVector(_d, s - 1);
      }
      if (t >= 1) {
        this.flight = null;
        this.focus.onFocus?.(false);
        this.focus = f.to;
        f.to.onFocus?.(true);
        this.lnDist = this.lnDistTarget = this.clampLn(f.lnD1, f.to);
        this.onArrive?.(f.to);
        f.resolve?.();
      }
    } else {
      this.clampDist();
      this.lnDist += (this.lnDistTarget - this.lnDist) * (1 - Math.exp(-dt * 7));
      this.focusAnchor.copy(this.focus.anchor);
      this.focusLocal.copy(this.focus.local);
    }

    _qy.setFromAxisAngle(Y, this.yaw);
    _qx.setFromAxisAngle(X, this.pitch);
    this.quaternion.copy(_qy).multiply(_qx);
    _v.set(0, 0, this.distKm).applyQuaternion(this.quaternion);
    this.anchor.copy(this.focusAnchor);
    this.local.copy(this.focusLocal).add(_v);
  }

  /** Distance from the camera to the Sun in parsecs (used for scale-dependent rendering). */
  distanceFromOriginPc(): number {
    return _v.copy(this.anchor).addScaledVector(this.local, 1 / PC_KM).length();
  }

  /** The entity the camera is (or will be) centred on. */
  get target(): Entity {
    return this.flight ? this.flight.to : this.focus;
  }
}
