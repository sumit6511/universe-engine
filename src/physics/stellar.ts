// Stellar astrophysics helpers: colour, temperature, luminosity, radius.

import { TSUN_K } from '../core/constants';

/** Effective temperature from B-V colour index (Ballesteros 2012). */
export function bvToTeff(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

export function teffToBv(t: number): number {
  let lo = -0.4, hi = 2.5;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (bvToTeff(mid) > t) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Linear-sRGB chromaticity of a black body at temperature T (K), normalised so max channel = 1.
 * Planckian locus in CIE 1960 UCS from Krystek (1985), then xy -> XYZ -> sRGB.
 */
export function blackbodyRGB(T: number, out: number[] = [0, 0, 0]): number[] {
  T = Math.max(1000, Math.min(40000, T));
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T);
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  const d = 2 * u - 8 * v + 4;
  const x = (3 * u) / d;
  const y = (2 * v) / d;
  const X = x / y, Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 + 1.057 * Z;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const m = Math.max(r, g, b) || 1;
  out[0] = r / m; out[1] = g / m; out[2] = b / m;
  return out;
}

/** Bolometric correction for V band as a function of Teff (Reed 1998). */
export function bolometricCorrection(T: number): number {
  const x = Math.log10(Math.max(2500, Math.min(45000, T))) - 4;
  return -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x * x - 3.901 * x - 0.438;
}

export interface StarProps {
  teff: number;
  luminosity: number; // L_sun (bolometric)
  radius: number; // R_sun
  spectralClass: string;
}

export function spectralClassFromTeff(T: number): string {
  const edges: [number, string][] = [[30000, 'O'], [10000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [2400, 'M']];
  for (let i = 0; i < edges.length; i++) {
    if (T >= edges[i][0]) {
      const hi = i === 0 ? 50000 : edges[i - 1][0];
      const sub = Math.max(0, Math.min(9, Math.floor((10 * (hi - T)) / (hi - edges[i][0]))));
      return edges[i][1] + sub;
    }
  }
  return 'L';
}

/** Physical properties estimated from absolute visual magnitude and B-V. */
export function starProps(absMagV: number, bv: number): StarProps {
  const teff = bvToTeff(bv);
  const mbol = absMagV + bolometricCorrection(teff);
  const luminosity = Math.pow(10, -0.4 * (mbol - 4.74));
  const radius = Math.sqrt(luminosity) * (TSUN_K / teff) ** 2;
  return { teff, luminosity, radius, spectralClass: spectralClassFromTeff(teff) };
}

/** Inner/outer edge of the conservative habitable zone in AU (Kopparapu et al. 2013, runaway/maximum greenhouse). */
export function habitableZone(luminosity: number, teff: number): [number, number] {
  const t = Math.max(2600, Math.min(7200, teff)) - 5780;
  const sIn = 1.0512 + 1.3242e-4 * t + 1.5418e-8 * t * t - 7.9895e-12 * t ** 3 - 1.8328e-15 * t ** 4;
  const sOut = 0.3438 + 5.8942e-5 * t + 1.6558e-9 * t * t - 3.0045e-12 * t ** 3 - 5.2983e-16 * t ** 4;
  return [Math.sqrt(luminosity / sIn), Math.sqrt(luminosity / sOut)];
}
