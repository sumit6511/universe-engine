// Physical and astronomical constants (IAU 2012/2015 nominal values, CODATA 2018).

export const AU_KM = 149597870.7;
export const PC_KM = 3.0856775814913673e13;
export const LY_KM = 9.4607304725808e12;
export const KPC_KM = PC_KM * 1e3;
export const MPC_KM = PC_KM * 1e6;
export const C_KMS = 299792.458;
export const G_SI = 6.6743e-11;
export const MSUN_KG = 1.98847e30;
export const RSUN_KM = 695700;
export const LSUN_W = 3.828e26;
export const TSUN_K = 5772;
export const MEARTH_KG = 5.97237e24;
export const REARTH_KM = 6371.0084;
export const MJUP_KG = 1.89813e27;
export const RJUP_KM = 69911;
export const J2000_JD = 2451545.0;
export const DAY_S = 86400;
export const YEAR_D = 365.25;
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const OBLIQUITY = 23.4392911 * DEG;
/** Gaussian gravitational constant squared: GM_sun in AU^3/day^2. */
export const GM_SUN_AU3_D2 = 0.01720209895 ** 2;
/** GM_sun in km^3/s^2. */
export const GM_SUN = 1.32712440018e11;

export function jdToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}
export function dateToJd(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/** Proleptic Gregorian calendar date for any Julian date (works far outside JS Date range). */
export function jdToCalendar(jd: number): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c);
  const e = Math.floor((b - dd) / 30.6001);
  const day = b - dd - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  const secs = Math.floor(f * 86400 + 1e-6);
  return { y: year, m: month, d: day, h: Math.floor(secs / 3600), min: Math.floor((secs % 3600) / 60), s: secs % 60 };
}
