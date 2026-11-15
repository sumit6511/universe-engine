// Cosmological initial conditions and first-order Lagrangian perturbation theory.
//
// 1. Draw a Gaussian random density field with the LCDM linear power spectrum
//    (Eisenstein & Hu 1998 transfer function, Planck 2018 parameters, sigma_8 normalised).
// 2. Solve for the Zel'dovich (1970) displacement field  psi(k) = i k delta(k) / k^2.
// 3. Particles then move on straight lines  x(q, a) = q + D(a) psi(q), where D is the linear
//    growth factor; the GPU evaluates this per vertex, so cosmic time can be scrubbed freely.
//
// The initial field is smoothed on the non-linear scale ("truncated" Zel'dovich approximation,
// Coles, Melott & Shandarin 1993), which keeps walls and filaments sharp after shell crossing.

import { powerSpectrum } from '../physics/cosmology';

export interface ZeldovichRequest { n: number; boxMpc: number; seed: number; smoothMpc: number }
export interface ZeldovichResult {
  n: number; boxMpc: number;
  q: Float32Array; psi: Float32Array; dens: Float32Array;
  sigmaDelta: number; rmsPsi: number; ms: number;
}

function fft1d(re: Float64Array, im: Float64Array, n: number, cosT: Float64Array, sinT: Float64Array, inverse: boolean): void {
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step], s = inverse ? sinT[k * step] : -sinT[k * step];
        const a = i + k, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

function fft3d(re: Float32Array, im: Float32Array, n: number, inverse: boolean): void {
  const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cosT[i] = Math.cos((2 * Math.PI * i) / n); sinT[i] = Math.sin((2 * Math.PI * i) / n); }
  const lr = new Float64Array(n), li = new Float64Array(n);
  const strides = [1, n, n * n];
  for (let axis = 0; axis < 3; axis++) {
    const st = strides[axis];
    const sa = strides[(axis + 1) % 3], sb = strides[(axis + 2) % 3];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const base = a * sa + b * sb;
        for (let i = 0; i < n; i++) { lr[i] = re[base + i * st]; li[i] = im[base + i * st]; }
        fft1d(lr, li, n, cosT, sinT, inverse);
        for (let i = 0; i < n; i++) { re[base + i * st] = lr[i]; im[base + i * st] = li[i]; }
      }
    }
  }
  if (inverse) {
    const inv = 1 / (n * n * n);
    for (let i = 0; i < re.length; i++) { re[i] *= inv; im[i] *= inv; }
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function zeldovich(req: ZeldovichRequest): ZeldovichResult {
  const t0 = performance.now();
  const { n, boxMpc: L, seed, smoothMpc } = req;
  const n3 = n * n * n;
  const rnd = mulberry(seed);
  const re = new Float32Array(n3), im = new Float32Array(n3);
  // white noise, unit variance
  for (let i = 0; i < n3; i += 2) {
    const u = Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))), v = 2 * Math.PI * rnd();
    re[i] = u * Math.cos(v);
    if (i + 1 < n3) re[i + 1] = u * Math.sin(v);
  }
  fft3d(re, im, n, false);
  // colour the noise:  <|delta_k|^2> = N^6 P(k) / V  in the discrete convention
  const kf = (2 * Math.PI) / L;
  const V = L * L * L;
  const kOf = (i: number) => (i <= n / 2 ? i : i - n) * kf;
  // 1D table of the amplitude as a function of |k|
  const amp = (k: number) => Math.sqrt((n3 * powerSpectrum(k)) / V) * Math.exp(-0.5 * k * k * smoothMpc * smoothMpc);
  const tabN = 4096, kmax = kf * n;
  const tab = new Float32Array(tabN + 1);
  for (let i = 1; i <= tabN; i++) tab[i] = amp((i / tabN) * kmax);
  for (let z = 0; z < n; z++) {
    const kz = kOf(z);
    for (let y = 0; y < n; y++) {
      const ky = kOf(y);
      for (let x = 0; x < n; x++) {
        const kx = kOf(x);
        const k = Math.sqrt(kx * kx + ky * ky + kz * kz);
        const idx = x + n * (y + n * z);
        const f = (k / kmax) * tabN, i0 = Math.floor(f);
        const a = k === 0 ? 0 : tab[i0] + (tab[Math.min(tabN, i0 + 1)] - tab[i0]) * (f - i0);
        re[idx] *= a; im[idx] *= a;
      }
    }
  }
  // displacement components
  const psi = new Float32Array(n3 * 3);
  const tr = new Float32Array(n3), ti = new Float32Array(n3);
  let sumPsi2 = 0;
  for (let c = 0; c < 3; c++) {
    for (let z = 0; z < n; z++) {
      const kz = z === n / 2 ? 0 : kOf(z);
      for (let y = 0; y < n; y++) {
        const ky = y === n / 2 ? 0 : kOf(y);
        for (let x = 0; x < n; x++) {
          const kx = x === n / 2 ? 0 : kOf(x);
          const k2 = kx * kx + ky * ky + kz * kz;
          const idx = x + n * (y + n * z);
          if (k2 === 0) { tr[idx] = 0; ti[idx] = 0; continue; }
          const kc = (c === 0 ? kx : c === 1 ? ky : kz) / k2;
          tr[idx] = -im[idx] * kc; // i * (re + i im) = -im + i re
          ti[idx] = re[idx] * kc;
        }
      }
    }
    fft3d(tr, ti, n, true);
    for (let i = 0; i < n3; i++) { psi[i * 3 + c] = tr[i]; sumPsi2 += tr[i] * tr[i]; }
  }
  // density contrast itself, for statistics
  fft3d(re, im, n, true);
  let s2 = 0;
  for (let i = 0; i < n3; i++) s2 += re[i] * re[i];
  const sigmaDelta = Math.sqrt(s2 / n3);

  // Eulerian density today (D = 1) by cloud-in-cell assignment, sampled back at the particles
  const cell = L / n;
  const rho = new Float32Array(n3);
  const wrap = (i: number) => ((i % n) + n) % n;
  const px = new Float32Array(n3 * 3);
  for (let z = 0, i = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
    const gx = x + 0.5 + psi[i * 3] / cell, gy = y + 0.5 + psi[i * 3 + 1] / cell, gz = z + 0.5 + psi[i * 3 + 2] / cell;
    px[i * 3] = gx; px[i * 3 + 1] = gy; px[i * 3 + 2] = gz;
    const fx = gx - 0.5, fy = gy - 0.5, fz = gz - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const dx = fx - ix, dy = fy - iy, dz = fz - iz;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = c >> 2;
      rho[wrap(ix + ox) + n * (wrap(iy + oy) + n * wrap(iz + oz))] += (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy) * (oz ? dz : 1 - dz);
    }
  }
  // random draw order, so that any prefix of the arrays is an unbiased subsample (used for LOD)
  const order = new Uint32Array(n3);
  for (let i = 0; i < n3; i++) order[i] = i;
  for (let i = n3 - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const q = new Float32Array(n3 * 3), psiOut = new Float32Array(n3 * 3), dens = new Float32Array(n3);
  for (let o = 0; o < n3; o++) {
    const i = order[o];
    const x = i % n, y = Math.floor(i / n) % n, z = Math.floor(i / (n * n));
    // Jitter the Lagrangian positions within their cell so the unperturbed particle load is not a
    // visible lattice at early times (the displacement field is smooth on the cell scale).
    q[o * 3] = (x + rnd()) * cell - L / 2; q[o * 3 + 1] = (y + rnd()) * cell - L / 2; q[o * 3 + 2] = (z + rnd()) * cell - L / 2;
    psiOut[o * 3] = psi[i * 3]; psiOut[o * 3 + 1] = psi[i * 3 + 1]; psiOut[o * 3 + 2] = psi[i * 3 + 2];
    // trilinear sample of the density at the particle's displaced position
    const fx = px[i * 3] - 0.5, fy = px[i * 3 + 1] - 0.5, fz = px[i * 3 + 2] - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const dx = fx - ix, dy = fy - iy, dz = fz - iz;
    let d = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = c >> 2;
      d += rho[wrap(ix + ox) + n * (wrap(iy + oy) + n * wrap(iz + oz))] * (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy) * (oz ? dz : 1 - dz);
    }
    dens[o] = Math.log10(Math.max(d, 0.05));
  }
  return { n, boxMpc: L, q, psi: psiOut, dens, sigmaDelta, rmsPsi: Math.sqrt(sumPsi2 / n3), ms: performance.now() - t0 };
}

if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && typeof (self as any).document === 'undefined') {
  self.onmessage = (ev: MessageEvent<ZeldovichRequest>) => {
    const r = zeldovich(ev.data);
    (self as any).postMessage(r, [r.q.buffer, r.psi.buffer, r.dens.buffer]);
  };
}
