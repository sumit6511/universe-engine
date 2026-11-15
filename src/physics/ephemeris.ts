// Solar-system ephemerides.
//
//  * Planets: JPL "Approximate Positions of the Planets" Keplerian elements and rates
//    (Standish & Williams; https://ssd.jpl.nasa.gov/planets/approx_pos.html).
//    Table 1 (1800-2050 AD) is used inside its validity window, Table 2a/2b
//    (3000 BC - 3000 AD) outside it.
//  * Moon: the Astronomical Almanac low-precision series (accurate to ~0.3 deg).
//  * Natural satellites: mean orbits fitted to JPL Horizons state vectors (tools/fit_moons.py),
//    including nodal precession for Miranda and Triton and Mimas's resonant libration.
//  * Small bodies: osculating two-body elements from the JPL Small-Body Database.
//
// All results are returned in the J2000 ecliptic frame unless stated otherwise.

import { DEG, GM_SUN_AU3_D2, J2000_JD, TAU } from '../core/constants';
import { elementsToPosition, solveKepler, type Elements } from './kepler';

export type PlanetName = 'Mercury' | 'Venus' | 'EMB' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

// a [au], e, I [deg], L [deg], long.peri [deg], long.node [deg]  followed by rates per Julian century
const T1: Record<PlanetName, number[]> = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  EMB: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  Mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
};

const T2: Record<PlanetName, number[]> = {
  Mercury: [0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819, 0.0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182],
  Venus: [0.72332102, 0.00676399, 3.39777545, 181.9797085, 131.76755713, 76.67261496, -0.00000026, -0.00005107, 0.00043494, 58517.8156026, 0.05679648, -0.27274174],
  EMB: [1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389, -0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.3179526, -0.24123856],
  Mars: [1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984, 0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431],
  Jupiter: [5.20248019, 0.0485359, 1.29861416, 34.33479152, 14.27495244, 100.29282654, -0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619],
  Saturn: [9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702, -0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002],
  Uranus: [19.18797948, 0.0468574, 0.77298127, 314.20276625, 172.43404441, 73.96250215, -0.00020455, -0.0000155, -0.00180155, 428.49512595, 0.09266985, 0.05739699],
  Neptune: [30.06952752, 0.00895439, 1.7700552, 304.22289287, 46.68158724, 131.78635853, 0.00006447, 0.00000818, 0.000224, 218.46515314, 0.01009938, -0.00606302],
};

// extra terms for the mean anomaly of the outer planets (Table 2b): b, c, s, f
const T2B: Partial<Record<PlanetName, number[]>> = {
  Jupiter: [-0.00012452, 0.0606406, -0.35635438, 38.35125],
  Saturn: [0.00025899, -0.13434469, 0.87320147, 38.35125],
  Uranus: [0.00058331, -0.97731848, 0.17689245, 7.67025],
  Neptune: [-0.00041348, 0.68346318, -0.10162547, 7.67025],
};

const T1_MIN = (2378496.5 - J2000_JD) / 36525; // 1800 AD
const T1_MAX = (2469807.5 - J2000_JD) / 36525; // 2050 AD
const T2_LIMIT = 30; // +-3000 years

/** Osculating-mean Keplerian elements of a planet at Julian date jd (angles in radians, a in AU). */
export function planetElements(name: PlanetName, jd: number): Elements {
  const T = (jd - J2000_JD) / 36525;
  const useT1 = T >= T1_MIN && T <= T1_MAX;
  const tab = useT1 ? T1[name] : T2[name];
  // Outside the fitted span, freeze the slowly varying shape elements and let only the
  // mean longitude advance, so orbits stay well behaved over geological time scales.
  const Tc = Math.max(-T2_LIMIT, Math.min(T2_LIMIT, T));
  const a = tab[0] + tab[6] * Tc;
  const e = Math.max(0, tab[1] + tab[7] * Tc);
  const I = tab[2] + tab[8] * Tc;
  const L = tab[3] + tab[9] * T;
  const wbar = tab[4] + tab[10] * Tc;
  const node = tab[5] + tab[11] * Tc;
  let M = L - wbar;
  if (!useT1) {
    const b = T2B[name];
    if (b) M += b[0] * Tc * Tc + b[1] * Math.cos(b[3] * Tc * DEG) + b[2] * Math.sin(b[3] * Tc * DEG);
  }
  return { a, e, i: I * DEG, node: node * DEG, peri: (wbar - node) * DEG, M: (((M % 360) + 360) % 360) * DEG };
}

/** Heliocentric J2000-ecliptic position of a planet (AU). */
export function planetPosition(name: PlanetName, jd: number, out: number[]): number[] {
  return elementsToPosition(planetElements(name, jd), out);
}

const EARTH_MOON_MASS_RATIO = 81.30056907;
const _m = [0, 0, 0];

/**
 * Geocentric position of the Moon, J2000 ecliptic, kilometres.
 * Astronomical Almanac low-precision formulae (Meeus, Astronomical Algorithms ch. 47 gives the full theory).
 */
export function moonPosition(jd: number, out: number[]): number[] {
  const T = (jd - J2000_JD) / 36525;
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  const lam =
    218.32 + 481267.881 * T +
    6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) +
    0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T) -
    0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const beta =
    5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) -
    0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const par =
    0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) +
    0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
  const r = 6378.14 / Math.sin(par * DEG);
  // series is referred to the mean equinox of date: remove general precession in longitude
  const lamJ = (lam - 1.396971 * T) * DEG;
  const b = beta * DEG;
  out[0] = r * Math.cos(b) * Math.cos(lamJ);
  out[1] = r * Math.cos(b) * Math.sin(lamJ);
  out[2] = r * Math.sin(b);
  return out;
}

/** Heliocentric J2000-ecliptic position of the Earth's centre (AU), corrected for the Moon. */
export function earthPosition(jd: number, out: number[]): number[] {
  planetPosition('EMB', jd, out);
  moonPosition(jd, _m);
  const k = 1 / (1 + EARTH_MOON_MASS_RATIO) / 149597870.7;
  out[0] -= _m[0] * k;
  out[1] -= _m[1] * k;
  out[2] -= _m[2] * k;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Natural satellites
// ---------------------------------------------------------------------------------------------

/**
 * Mean orbit of a moon fitted to JPL Horizons state vectors (tools/fit_moons.py).
 * Everything is expressed in the J2000 ecliptic frame; longitudes are measured in the
 * orbit plane from the plane's ascending node on the ecliptic.
 */
export interface SatFit {
  a: number; // km
  e: number;
  n: number; // mean motion, deg/day
  L0: number; // mean longitude at J2000, deg
  peri: number; // longitude of periapsis, deg
  normal: number[]; // orbit normal at J2000
  /** uniform nodal precession about this axis (deg/day) */
  pole?: number[];
  prec?: number;
  /** resonant libration of the mean longitude: amp (deg), period (days), phase (rad) */
  lib?: { amp: number; period: number; phase: number };
}

function rotateAbout(v: number[], axis: number[], ang: number, out: number[]): number[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const kx = axis[1] * v[2] - axis[2] * v[1];
  const ky = axis[2] * v[0] - axis[0] * v[2];
  const kz = axis[0] * v[1] - axis[1] * v[0];
  out[0] = v[0] * c + kx * s + axis[0] * d * (1 - c);
  out[1] = v[1] * c + ky * s + axis[1] * d * (1 - c);
  out[2] = v[2] * c + kz * s + axis[2] * d * (1 - c);
  return out;
}

/** In-plane basis [x, y, normal] of a moon's orbit at jd. */
export function satFrame(f: SatFit, jd: number): number[][] {
  const n = f.normal;
  const l = Math.hypot(n[1], n[0]) || 1;
  const x0 = [-n[1] / l, n[0] / l, 0]; // z_ecl x normal
  const y0 = [n[1] * x0[2] - n[2] * x0[1], n[2] * x0[0] - n[0] * x0[2], n[0] * x0[1] - n[1] * x0[0]];
  if (!f.pole || !f.prec) return [x0, y0, n];
  const ang = f.prec * (jd - J2000_JD) * DEG;
  return [rotateAbout(x0, f.pole, ang, [0, 0, 0]), rotateAbout(y0, f.pole, ang, [0, 0, 0]), rotateAbout(n, f.pole, ang, [0, 0, 0])];
}

/** Mean longitude (deg) at jd. */
export function satMeanLongitude(f: SatFit, jd: number): number {
  const dt = jd - J2000_JD;
  let L = f.L0 + f.n * dt;
  if (f.lib) L += f.lib.amp * Math.sin((TAU * dt) / f.lib.period + f.lib.phase);
  return L;
}

/** Planetocentric position (km, J2000 ecliptic) for mean longitude L (deg) in the given orbit frame. */
export function satPositionAtL(f: SatFit, frame: number[][], L: number, out: number[]): number[] {
  const peri = f.peri * DEG;
  const E = f.e > 0 ? solveKepler(L * DEG - peri, f.e) : L * DEG - peri;
  const xp = f.a * (Math.cos(E) - f.e);
  const yp = f.a * Math.sqrt(1 - f.e * f.e) * Math.sin(E);
  const cx = xp * Math.cos(peri) - yp * Math.sin(peri);
  const cy = xp * Math.sin(peri) + yp * Math.cos(peri);
  out[0] = cx * frame[0][0] + cy * frame[1][0];
  out[1] = cx * frame[0][1] + cy * frame[1][1];
  out[2] = cx * frame[0][2] + cy * frame[1][2];
  return out;
}

/** Planetocentric position (km) of a moon in the J2000 ecliptic frame. */
export function satPosition(f: SatFit, jd: number, out: number[]): number[] {
  return satPositionAtL(f, satFrame(f, jd), satMeanLongitude(f, jd), out);
}

// ---------------------------------------------------------------------------------------------
// Small bodies (heliocentric two-body propagation)
// ---------------------------------------------------------------------------------------------

export interface SmallBodyElements {
  a: number; e: number; i: number; om: number; w: number; ma: number; epoch: number; // AU, deg, JD
}

export function smallBodyElementsAt(el: SmallBodyElements, jd: number): Elements {
  const n = Math.sqrt(GM_SUN_AU3_D2 / (el.a * el.a * el.a)); // rad/day
  let M = el.ma * DEG + n * (jd - el.epoch);
  M = ((M % TAU) + TAU) % TAU;
  return { a: el.a, e: el.e, i: el.i * DEG, node: el.om * DEG, peri: el.w * DEG, M };
}

export function smallBodyPosition(el: SmallBodyElements, jd: number, out: number[]): number[] {
  return elementsToPosition(smallBodyElementsAt(el, jd), out);
}

// ---------------------------------------------------------------------------------------------
// Rotation (IAU WGCCRE 2015)
// ---------------------------------------------------------------------------------------------

export interface RotationModel {
  ra0: number; ra1: number; // pole right ascension: deg, deg/century
  dec0: number; dec1: number;
  w0: number; wd: number; // prime meridian: deg, deg/day
}

/**
 * Body-fixed axes expressed in ICRS equatorial coordinates at jd:
 * returns [prime meridian direction, 90E direction, north pole].
 */
export function bodyAxesEquatorial(rot: RotationModel, jd: number): number[][] {
  const d = jd - J2000_JD;
  const T = d / 36525;
  const ra = (rot.ra0 + rot.ra1 * T) * DEG;
  const dec = (rot.dec0 + rot.dec1 * T) * DEG;
  const W = ((rot.w0 + rot.wd * d) % 360) * DEG;
  const P = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const Q = [-Math.sin(ra), Math.cos(ra), 0];
  const PxQ = [P[1] * Q[2] - P[2] * Q[1], P[2] * Q[0] - P[0] * Q[2], P[0] * Q[1] - P[1] * Q[0]];
  const cw = Math.cos(W), sw = Math.sin(W);
  const X = [Q[0] * cw + PxQ[0] * sw, Q[1] * cw + PxQ[1] * sw, Q[2] * cw + PxQ[2] * sw];
  const E = [P[1] * X[2] - P[2] * X[1], P[2] * X[0] - P[0] * X[2], P[0] * X[1] - P[1] * X[0]];
  return [X, E, P];
}

export { solveKepler };
