// Reference frames.
//
// The engine's world ("render") frame is heliocentric with J2000 ecliptic axes,
// right-handed and Y-up:  X = ecliptic x (vernal equinox), Y = ecliptic north,
// Z = -ecliptic y.  The solar system therefore lies flat in the XZ plane and the
// Milky Way appears with its true ~60 degree tilt to the ecliptic.

import { Matrix4, Vector3 } from 'three';
import { DEG, OBLIQUITY } from './constants';

const CE = Math.cos(OBLIQUITY);
const SE = Math.sin(OBLIQUITY);

/** J2000 ecliptic cartesian -> world. */
export function eclToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, z, -y);
}

/** ICRS equatorial cartesian -> world. */
export function eqToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  const ye = y * CE + z * SE;
  const ze = -y * SE + z * CE;
  return out.set(x, ze, -ye);
}

/** Right ascension / declination (degrees) -> world direction (or position at distance d). */
export function raDecToWorld(raDeg: number, decDeg: number, d: number, out: Vector3): Vector3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return eqToWorld(d * cd * Math.cos(ra), d * cd * Math.sin(ra), d * Math.sin(dec), out);
}

/** World direction -> RA/Dec in degrees. */
export function worldToRaDec(v: Vector3): { ra: number; dec: number } {
  // invert eqToWorld
  const xe = v.x;
  const ze = v.y;
  const ye = -v.z;
  const y = ye * CE - ze * SE;
  const z = ye * SE + ze * CE;
  const r = Math.hypot(xe, y, z) || 1;
  let ra = Math.atan2(y, xe) / DEG;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(z / r) / DEG };
}

// Equatorial (ICRS) -> Galactic rotation matrix (Hipparcos, ESA 1997), row-major.
const AG = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.44482963, 0.7469822445,
  -0.867666149, -0.1980763734, 0.4559837762,
];

/** Galactic cartesian (X toward the Galactic Centre, Y toward l=90, Z toward the NGP) -> world. */
export function galToWorld(gx: number, gy: number, gz: number, out: Vector3): Vector3 {
  // equatorial = AG^T * galactic
  const x = AG[0] * gx + AG[3] * gy + AG[6] * gz;
  const y = AG[1] * gx + AG[4] * gy + AG[7] * gz;
  const z = AG[2] * gx + AG[5] * gy + AG[8] * gz;
  return eqToWorld(x, y, z, out);
}

/** Rotation matrix taking galactic cartesian vectors into the world frame. */
export function galacticToWorldMatrix(): Matrix4 {
  const ex = galToWorld(1, 0, 0, new Vector3());
  const ey = galToWorld(0, 1, 0, new Vector3());
  const ez = galToWorld(0, 0, 1, new Vector3());
  return new Matrix4().makeBasis(ex, ey, ez);
}

/** Sun's galactocentric distance (Reid et al. 2019) and height above the plane (Bennett & Bovy 2019), in parsecs. */
export const R0_PC = 8150;
export const Z0_PC = 20.8;

/** Position of the Galactic Centre (Sgr A*) in the world frame, parsecs. */
export const GALACTIC_CENTER_PC = galToWorld(R0_PC, 0, -Z0_PC, new Vector3());
export const GALACTIC_NORTH = galToWorld(0, 0, 1, new Vector3());
