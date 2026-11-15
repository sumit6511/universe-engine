// Flat LCDM background cosmology and linear perturbation theory.
// Parameters: Planck 2018 results VI, base-LCDM (TT,TE,EE+lowE+lensing).

import { C_KMS } from '../core/constants';

export const COSMO = {
  h: 0.674,
  H0: 67.4, // km/s/Mpc
  Om: 0.315,
  Ob: 0.0224 / (0.674 * 0.674),
  Or: 9.21e-5, // photons (T=2.7255 K) + 3.046 massless-equivalent neutrinos
  OL: 0,
  ns: 0.965,
  sigma8: 0.811,
  Tcmb: 2.7255,
  zStar: 1089.92, // last scattering
};
COSMO.OL = 1 - COSMO.Om - COSMO.Or;

/** Hubble time 1/H0 in Gyr. */
export const HUBBLE_TIME_GYR = 977.7922216807891 / COSMO.H0;
/** Hubble distance c/H0 in Mpc. */
export const HUBBLE_DIST_MPC = C_KMS / COSMO.H0;

/** Dimensionless Hubble rate E(a) = H(a)/H0. */
export function E(a: number): number {
  return Math.sqrt(COSMO.Or / (a * a * a * a) + COSMO.Om / (a * a * a) + COSMO.OL);
}

function simpson(f: (x: number) => number, a: number, b: number, n = 512): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i & 1 ? 4 : 2);
  return (s * h) / 3;
}

/** Age of the universe at scale factor a, in Gyr. */
export function ageAt(a: number): number {
  // t = int_0^a da' / (a' H(a'));  substitute a' = x^2 to tame the radiation-era integrand
  return HUBBLE_TIME_GYR * simpson((x) => (x === 0 ? 0 : (2 * x) / (x * x * E(x * x))), 0, Math.sqrt(a), 1024);
}

export const AGE_NOW_GYR = ageAt(1);

/** Lookback time to redshift z, in Gyr. */
export function lookbackTime(z: number): number {
  return AGE_NOW_GYR - ageAt(1 / (1 + z));
}

/** Line-of-sight comoving distance to redshift z, in Mpc. */
export function comovingDistance(z: number): number {
  if (z <= 0) return 0;
  // integrate in u = ln(1+z) for accuracy up to recombination and beyond
  const umax = Math.log(1 + z);
  return HUBBLE_DIST_MPC * simpson((u) => { const zp = Math.exp(u); return zp / E(1 / zp); }, 0, umax, 1024);
}

/** Comoving radius of the particle horizon (observable universe), Mpc. */
export const HORIZON_MPC = HUBBLE_DIST_MPC * simpson((x) => (x === 0 ? 0 : 2 / (x * x * x * E(x * x))), 0, 1, 4096);
export const LAST_SCATTERING_MPC = comovingDistance(COSMO.zStar);

/** Linear growth factor D(a), normalised to D(1) = 1 (matter + Lambda; Heath 1977). */
function growthUnnormalised(a: number): number {
  const Em = (x: number) => Math.sqrt(COSMO.Om / (x * x * x) + COSMO.OL);
  // int_0^a da' / (a' E)^3 ; substitute a' = x^(2/3)... integrand ~ a'^(3/2) near 0, already regular
  const I = simpson((x) => (x === 0 ? 0 : 1 / Math.pow(x * Em(x), 3)), 0, a, 512);
  return 2.5 * COSMO.Om * Em(a) * I;
}
const D1 = growthUnnormalised(1);
export function growthFactor(a: number): number {
  return growthUnnormalised(a) / D1;
}

/** Logarithmic growth rate f = dlnD/dlna (approximately Omega_m(a)^0.55). */
export function growthRate(a: number): number {
  const om = COSMO.Om / (a * a * a) / (COSMO.Om / (a * a * a) + COSMO.OL);
  return Math.pow(om, 0.55);
}

/** Inverse of comovingDistance by bisection: redshift at a given comoving distance (Mpc). */
export function redshiftAtDistance(dMpc: number): number {
  if (dMpc <= 0) return 0;
  if (dMpc >= HORIZON_MPC) return Infinity;
  let lo = 0, hi = 1;
  while (comovingDistance(hi) < dMpc && hi < 1e9) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (comovingDistance(mid) < dMpc) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------------------------
// Matter power spectrum: Eisenstein & Hu (1998) zero-baryon ("no-wiggle") transfer function
// ---------------------------------------------------------------------------------------------

/** Transfer function T(k) for k in 1/Mpc (EH98 eqs. 26, 28-31). */
export function transferEH(k: number): number {
  const { h, Om, Ob, Tcmb } = COSMO;
  const om = Om * h * h;
  const ob = Ob * h * h;
  const fb = Ob / Om;
  const theta = Tcmb / 2.7;
  const s = (44.5 * Math.log(9.83 / om)) / Math.sqrt(1 + 10 * Math.pow(ob, 0.75)); // Mpc
  const alpha = 1 - 0.328 * Math.log(431 * om) * fb + 0.38 * Math.log(22.3 * om) * fb * fb;
  const gammaEff = Om * h * (alpha + (1 - alpha) / (1 + Math.pow(0.43 * k * s, 4)));
  const q = ((k / h) * theta * theta) / gammaEff; // k/h is in h/Mpc
  const L0 = Math.log(2 * Math.E + 1.8 * q);
  const C0 = 14.2 + 731 / (1 + 62.5 * q);
  return L0 / (L0 + C0 * q * q);
}

function tophat(x: number): number {
  return x < 1e-3 ? 1 - (x * x) / 10 : (3 * (Math.sin(x) - x * Math.cos(x))) / (x * x * x);
}

function sigmaR2(Rmpc: number, amp: number): number {
  // sigma^2(R) = 1/(2 pi^2) int k^3 P(k) W^2(kR) dlnk
  return simpson((lnk) => {
    const k = Math.exp(lnk);
    const T = transferEH(k);
    const W = tophat(k * Rmpc);
    return (k * k * k * amp * Math.pow(k, COSMO.ns) * T * T * W * W) / (2 * Math.PI * Math.PI);
  }, Math.log(1e-5), Math.log(50), 2048);
}

const P_AMP = (COSMO.sigma8 * COSMO.sigma8) / sigmaR2(8 / COSMO.h, 1);

/** Linear matter power spectrum today, P(k) in Mpc^3 for k in 1/Mpc, normalised to sigma_8. */
export function powerSpectrum(k: number): number {
  if (k <= 0) return 0;
  const T = transferEH(k);
  return P_AMP * Math.pow(k, COSMO.ns) * T * T;
}

/** rms linear density fluctuation in spheres of radius R (Mpc) today. */
export function sigmaR(Rmpc: number): number {
  return Math.sqrt(sigmaR2(Rmpc, P_AMP));
}

/** CMB temperature at redshift z. */
export function cmbTemperature(z: number): number {
  return COSMO.Tcmb * (1 + z);
}
