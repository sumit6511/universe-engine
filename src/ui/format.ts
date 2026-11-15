import { AU_KM, LY_KM, MEARTH_KG, MJUP_KG, MSUN_KG, PC_KM } from '../core/constants';

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function sig(x: number, n = 3): string {
  if (!isFinite(x)) return '—';
  if (x === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(x)));
  if (mag >= 6 || mag < -3) {
    const m = x / 10 ** mag;
    return `${m.toFixed(n - 1)} × 10${sup(mag)}`;
  }
  return nf(Math.max(0, n - 1 - mag)).format(x);
}

function sup(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map((c) => map[c] ?? c).join('');
}

/** Human distance from kilometres, choosing km / AU / light-years. */
export function fmtDist(km: number): string {
  const a = Math.abs(km);
  if (a < 1e7) return `${sig(km, 4)} km`;
  if (a < 0.05 * AU_KM) return `${sig(km / 1e6, 3)} million km`;
  if (a < 0.1 * LY_KM) return `${sig(km / AU_KM, 3)} AU`;
  const ly = km / LY_KM;
  if (Math.abs(ly) < 1e3) return `${sig(ly, 3)} ly`;
  if (Math.abs(ly) < 1e6) return `${sig(ly / 1e3, 3)} kly`;
  if (Math.abs(ly) < 1e9) return `${sig(ly / 1e6, 3)} Mly`;
  return `${sig(ly / 1e9, 3)} Gly`;
}

export function fmtParsec(km: number): string {
  const pc = km / PC_KM;
  const a = Math.abs(pc);
  if (a < 1e-3) return `${sig(km / AU_KM, 3)} AU`;
  if (a < 1e3) return `${sig(pc, 3)} pc`;
  if (a < 1e6) return `${sig(pc / 1e3, 3)} kpc`;
  if (a < 1e9) return `${sig(pc / 1e6, 3)} Mpc`;
  return `${sig(pc / 1e9, 3)} Gpc`;
}

export function fmtMass(kg: number): string {
  if (kg > 0.05 * MSUN_KG) return `${sig(kg / MSUN_KG, 3)} M☉`;
  if (kg > 0.3 * MJUP_KG) return `${sig(kg / MJUP_KG, 3)} M♃`;
  if (kg > 0.01 * MEARTH_KG) return `${sig(kg / MEARTH_KG, 3)} M⊕`;
  return `${sig(kg, 3)} kg`;
}

export function fmtDuration(days: number): string {
  const a = Math.abs(days);
  if (a < 1 / 24) return `${sig(days * 1440, 3)} min`;
  if (a < 2) return `${sig(days * 24, 3)} h`;
  if (a < 800) return `${sig(days, 4)} d`;
  const y = days / 365.25;
  if (Math.abs(y) < 1e4) return `${sig(y, 4)} yr`;
  if (Math.abs(y) < 1e7) return `${sig(y / 1e3, 3)} kyr`;
  if (Math.abs(y) < 1e10) return `${sig(y / 1e6, 3)} Myr`;
  return `${sig(y / 1e9, 3)} Gyr`;
}

export function fmtLightTime(km: number): string {
  const s = km / 299792.458;
  if (s < 1) return `${sig(s * 1000, 3)} ms`;
  if (s < 120) return `${sig(s, 3)} light-seconds`;
  if (s < 7200) return `${sig(s / 60, 3)} light-minutes`;
  if (s < 86400 * 3) return `${sig(s / 3600, 3)} light-hours`;
  if (s < 86400 * 365.25 * 0.1) return `${sig(s / 86400, 3)} light-days`;
  return fmtDist(km).replace('ly', 'light-years').replace('kly', 'thousand light-years');
}

export function fmtTemp(k: number): string {
  return `${sig(k, 3)} K`;
}

export const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');
