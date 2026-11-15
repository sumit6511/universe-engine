import { describe, expect, it } from 'vitest';
import { zeldovich } from '../src/workers/zeldovich.worker';
import { powerSpectrum } from '../src/physics/cosmology';

describe('Zel\'dovich initial conditions', () => {
  const L = 640, n = 64;
  const r = zeldovich({ n, boxMpc: L, seed: 7, smoothMpc: 0 });
  it('density variance matches the integral of the input power spectrum over the sampled modes', () => {
    // expected sigma^2 = (1/V) sum_k P(k) over the discrete modes of the box
    const kf = (2 * Math.PI) / L;
    let s2 = 0;
    for (let z = -n / 2 + 1; z <= n / 2; z++) for (let y = -n / 2 + 1; y <= n / 2; y++) for (let x = -n / 2 + 1; x <= n / 2; x++) {
      const k = kf * Math.hypot(x, y, z);
      if (k > 0) s2 += powerSpectrum(k);
    }
    const expected = Math.sqrt(s2 / (L * L * L));
    expect(r.sigmaDelta / expected).toBeGreaterThan(0.97);
    expect(r.sigmaDelta / expected).toBeLessThan(1.03);
  });
  it('3D rms displacement is ~15 Mpc today, as in LCDM', () => {
    expect(r.rmsPsi).toBeGreaterThan(10);
    expect(r.rmsPsi).toBeLessThan(18);
    console.log(`sigma_delta=${r.sigmaDelta.toFixed(3)} rms psi (3D)=${r.rmsPsi.toFixed(2)} Mpc, ${r.ms.toFixed(0)} ms`);
  });
  it('mean displacement vanishes (no bulk drift of the box)', () => {
    let mx = 0;
    for (let i = 0; i < n * n * n; i++) mx += r.psi[i * 3];
    expect(Math.abs(mx / (n * n * n))).toBeLessThan(1e-3);
  });
});
