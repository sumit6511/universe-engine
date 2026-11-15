import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AU_KM, DEG } from '../src/core/constants';
import { solveKepler } from '../src/physics/kepler';
import { earthPosition, moonPosition, planetPosition, satPosition, smallBodyPosition, bodyAxesEquatorial, type PlanetName } from '../src/physics/ephemeris';
import { AGE_NOW_GYR, COSMO, comovingDistance, growthFactor, HORIZON_MPC, LAST_SCATTERING_MPC, lookbackTime, redshiftAtDistance, sigmaR } from '../src/physics/cosmology';
import { blackbodyRGB, bvToTeff, starProps } from '../src/physics/stellar';
import { BODY_BY_ID, MOON_FIT } from '../src/data/bodies';

// Reference state vectors from JPL Horizons (DE441), heliocentric / planetocentric, J2000 ecliptic, km.
const HZ: Record<string, Record<string, number[]>> = JSON.parse(readFileSync(new URL('./horizons.json', import.meta.url), 'utf8'));
const HZM: Record<string, Record<string, number[]>> = JSON.parse(readFileSync(new URL('./horizons_moons.json', import.meta.url), 'utf8'));
const SB = JSON.parse(readFileSync(new URL('../public/data/smallbodies.json', import.meta.url), 'utf8'));

const angle = (a: number[], b: number[]) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, d / (Math.hypot(...a) * Math.hypot(...b)))) / DEG;
};

describe('Kepler solver', () => {
  it('satisfies Kepler\'s equation for all eccentricities', () => {
    for (const e of [0, 0.01, 0.3, 0.7, 0.9, 0.967, 0.99]) {
      for (let M = -7; M < 7; M += 0.137) {
        const E = solveKepler(M, e);
        const Mw = Math.atan2(Math.sin(M), Math.cos(M));
        const back = E - e * Math.sin(E);
        expect(Math.abs(Math.atan2(Math.sin(back - Mw), Math.cos(back - Mw)))).toBeLessThan(1e-10);
      }
    }
  });
});

describe('planetary ephemeris vs JPL Horizons', () => {
  const planets: [string, PlanetName | 'Earth', number][] = [
    ['Mercury', 'Mercury', 0.05], ['Venus', 'Venus', 0.05], ['Earth', 'Earth', 0.05], ['Mars', 'Mars', 0.08],
    ['Jupiter', 'Jupiter', 0.2], ['Saturn', 'Saturn', 0.35], ['Uranus', 'Uranus', 0.2], ['Neptune', 'Neptune', 0.2],
  ];
  for (const [key, name, tolDeg] of planets) {
    it(`${key} within ${tolDeg} deg`, () => {
      for (const [jdStr, ref] of Object.entries(HZ[key])) {
        const jd = parseFloat(jdStr);
        const p = [0, 0, 0];
        if (name === 'Earth') earthPosition(jd, p);
        else planetPosition(name, jd, p);
        const km = p.map((v) => v * AU_KM);
        const err = angle(km, ref);
        const rerr = Math.abs(Math.hypot(...km) / Math.hypot(...ref) - 1);
        expect(err, `${key} @ ${jdStr}: ${err.toFixed(4)} deg`).toBeLessThan(tolDeg);
        expect(rerr).toBeLessThan(0.004);
      }
    });
  }

  it('Pluto and Ceres (two-body, SBDB elements) within 1 deg near epoch, 5 deg over +-60 yr', () => {
    for (const key of ['Pluto', 'Ceres']) {
      const el = SB.named.find((n: any) => n.name === key);
      for (const [jdStr, ref] of Object.entries(HZ[key])) {
        const p = smallBodyPosition(el, parseFloat(jdStr), [0, 0, 0]).map((v) => v * AU_KM);
        expect(angle(p, ref), `${key} @ ${jdStr}`).toBeLessThan(Math.abs(parseFloat(jdStr) - el.epoch) < 6000 ? 1.0 : 5);
      }
    }
  });

  it('Moon within 0.5 deg and 0.6% in distance', () => {
    for (const [jdStr, ref] of Object.entries(HZ.Moon)) {
      const p = moonPosition(parseFloat(jdStr), [0, 0, 0]);
      expect(angle(p, ref), `Moon @ ${jdStr}: ${angle(p, ref)}`).toBeLessThan(0.5);
      expect(Math.abs(Math.hypot(...p) / Math.hypot(...ref) - 1)).toBeLessThan(0.006);
    }
  });

  it('fitted moon orbits reproduce Horizons within 4 deg at 1969, 2000, 2026 and 2040', () => {
    for (const [id, epochs] of Object.entries(HZM)) {
      const fit = MOON_FIT[id];
      for (const [jdStr, ref] of Object.entries(epochs)) {
        const p = satPosition(fit, parseFloat(jdStr), [0, 0, 0]);
        expect(angle(p, ref), `${id} @ ${jdStr}`).toBeLessThan(4);
      }
    }
  });
});

describe('rotation models', () => {
  it('sub-solar longitude on Earth is near Greenwich at 12:00 UT, latitude ~ -23 deg at J2000', () => {
    const jd = 2451545.0;
    const e = earthPosition(jd, [0, 0, 0]);
    // direction Earth -> Sun in equatorial coordinates
    const eps = 23.4392911 * DEG;
    const s = [-e[0], -e[1] * Math.cos(eps) + e[2] * Math.sin(eps), -e[1] * Math.sin(eps) - e[2] * Math.cos(eps)];
    const [X, Ea, P] = bodyAxesEquatorial(BODY_BY_ID.get('earth')!.rot!, jd);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const n = Math.hypot(...s);
    const lon = Math.atan2(dot(s, Ea), dot(s, X)) / DEG;
    const lat = Math.asin(dot(s, P) / n) / DEG;
    expect(Math.abs(lon)).toBeLessThan(2.0);
    expect(lat).toBeGreaterThan(-23.5);
    expect(lat).toBeLessThan(-22.5);
  });

  it('Saturn ring plane crossing: Earth passes through the ring plane in March 2025', () => {
    // Saturnicentric latitude of Earth changes sign close to 2025-03-23
    const lat = (jd: number) => {
      const s = planetPosition('Saturn', jd, [0, 0, 0]);
      const e = earthPosition(jd, [0, 0, 0]);
      const eps = 23.4392911 * DEG;
      const d = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
      const q = [d[0], d[1] * Math.cos(eps) - d[2] * Math.sin(eps), d[1] * Math.sin(eps) + d[2] * Math.cos(eps)];
      const P = bodyAxesEquatorial(BODY_BY_ID.get('saturn')!.rot!, jd)[2];
      return Math.asin((q[0] * P[0] + q[1] * P[1] + q[2] * P[2]) / Math.hypot(...q)) / DEG;
    };
    const jd0 = 2460757.5; // 2025-03-23
    expect(Math.abs(lat(jd0))).toBeLessThan(0.5);
    expect(lat(jd0 - 60) * lat(jd0 + 60)).toBeLessThan(0);
  });
});

describe('cosmology (Planck 2018)', () => {
  it('age of the universe is 13.8 Gyr', () => {
    expect(AGE_NOW_GYR).toBeGreaterThan(13.75);
    expect(AGE_NOW_GYR).toBeLessThan(13.85);
  });
  it('distances: last scattering ~13.9 Gpc, particle horizon ~14.1-14.3 Gpc (46 Gly)', () => {
    expect(LAST_SCATTERING_MPC).toBeGreaterThan(13700);
    expect(LAST_SCATTERING_MPC).toBeLessThan(14000);
    expect(HORIZON_MPC).toBeGreaterThan(14000);
    expect(HORIZON_MPC).toBeLessThan(14400);
    expect(comovingDistance(1)).toBeGreaterThan(3350);
    expect(comovingDistance(1)).toBeLessThan(3450);
  });
  it('lookback time to z=1 is ~7.9 Gyr and redshift inversion round-trips', () => {
    expect(lookbackTime(1)).toBeGreaterThan(7.8);
    expect(lookbackTime(1)).toBeLessThan(8.1);
    expect(redshiftAtDistance(comovingDistance(2.5))).toBeCloseTo(2.5, 5);
  });
  it('growth factor: D(1)=1, D ~ a in the matter era', () => {
    expect(growthFactor(1)).toBeCloseTo(1, 10);
    expect(growthFactor(0.5)).toBeGreaterThan(0.6);
    expect(growthFactor(0.5)).toBeLessThan(0.63);
    expect(growthFactor(0.02) / growthFactor(0.01)).toBeCloseTo(2, 2);
  });
  it('power spectrum normalisation reproduces sigma_8', () => {
    expect(sigmaR(8 / COSMO.h)).toBeCloseTo(COSMO.sigma8, 6);
  });
});

describe('stellar physics', () => {
  it('B-V 0.65 -> 5778 K (Ballesteros 2012)', () => {
    expect(bvToTeff(0.65)).toBeCloseTo(5778, -1);
  });
  it('the Sun comes out near 1 L_sun, 1 R_sun', () => {
    const p = starProps(4.83, 0.653);
    expect(p.luminosity).toBeGreaterThan(0.85);
    expect(p.luminosity).toBeLessThan(1.25);
    expect(p.radius).toBeGreaterThan(0.9);
    expect(p.radius).toBeLessThan(1.12);
  });
  it('black-body colours run red -> white -> blue', () => {
    const cool = blackbodyRGB(3000), sun = blackbodyRGB(5772), hot = blackbodyRGB(20000);
    expect(cool[0]).toBe(1); expect(cool[2]).toBeLessThan(0.3);
    expect(Math.min(...sun)).toBeGreaterThan(0.7);
    expect(hot[2]).toBe(1); expect(hot[0]).toBeLessThan(0.75);
  });
});
