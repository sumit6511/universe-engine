// Two-body orbital mechanics.

import { TAU } from '../core/constants';

/** Solve Kepler's equation M = E - e sin E for the eccentric anomaly (radians). */
export function solveKepler(M: number, e: number): number {
  M = M % TAU;
  if (M > Math.PI) M -= TAU;
  else if (M < -Math.PI) M += TAU;
  // Danby's starter is robust for all e < 1
  let E = M + 0.85 * e * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 60; i++) {
    const s = Math.sin(E);
    const c = Math.cos(E);
    const f = E - e * s - M;
    const fp = 1 - e * c;
    const fpp = e * s;
    // Halley iteration (cubic convergence)
    const d = (-f / fp);
    const dE = -f / (fp + 0.5 * d * fpp);
    E += dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

export interface Elements {
  /** semi-major axis (any length unit; output uses the same unit) */
  a: number;
  e: number;
  /** inclination, longitude of ascending node, argument of periapsis, mean anomaly (radians) */
  i: number;
  node: number;
  peri: number;
  M: number;
}

/**
 * Position from classical elements, expressed in the elements' reference frame
 * (x toward the reference direction, z along the reference pole).
 */
export function elementsToPosition(el: Elements, out: number[], E?: number): number[] {
  const Ea = E ?? solveKepler(el.M, el.e);
  const xp = el.a * (Math.cos(Ea) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(Ea);
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const cw = Math.cos(el.peri), sw = Math.sin(el.peri);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  out[0] = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  out[1] = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  out[2] = sw * si * xp + cw * si * yp;
  return out;
}

/** Orbital period (days) for semi-major axis a (AU) around a central mass (solar masses). */
export function periodDays(aAU: number, mSun = 1): number {
  return 365.256898326 * Math.sqrt((aAU * aAU * aAU) / mSun);
}

/** Vis-viva orbital speed (km/s) at radius r (km) for GM (km^3/s^2) and semi-major axis a (km). */
export function visViva(gm: number, r: number, a: number): number {
  return Math.sqrt(Math.max(0, gm * (2 / r - 1 / a)));
}
