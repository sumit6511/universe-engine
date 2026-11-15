export interface Quality {
  name: 'low' | 'medium' | 'high' | 'ultra';
  maxPixelRatio: number;
  msaa: number;
  bloom: boolean;
  /** Milky Way particle count */
  galaxyParticles: number;
  /** cosmic web grid size per dimension (power of two) and fraction of particles drawn */
  webGrid: number;
  webFraction: number;
  /** black-hole geodesic integration steps */
  bhSteps: number;
  atmoSteps: number;
  sphereSegments: number;
  /** N-body lab tracer particles (square of texture size) */
  labSize: number;
}

export const QUALITY: Record<Quality['name'], Quality> = {
  low: { name: 'low', maxPixelRatio: 1, msaa: 0, bloom: true, galaxyParticles: 120_000, webGrid: 64, webFraction: 1, bhSteps: 90, atmoSteps: 8, sphereSegments: 64, labSize: 128 },
  medium: { name: 'medium', maxPixelRatio: 1.5, msaa: 4, bloom: true, galaxyParticles: 350_000, webGrid: 128, webFraction: 0.4, bhSteps: 160, atmoSteps: 12, sphereSegments: 96, labSize: 256 },
  high: { name: 'high', maxPixelRatio: 2, msaa: 4, bloom: true, galaxyParticles: 700_000, webGrid: 128, webFraction: 1, bhSteps: 240, atmoSteps: 16, sphereSegments: 128, labSize: 384 },
  ultra: { name: 'ultra', maxPixelRatio: 2.5, msaa: 4, bloom: true, galaxyParticles: 1_500_000, webGrid: 128, webFraction: 1, bhSteps: 360, atmoSteps: 20, sphereSegments: 160, labSize: 512 },
};

export function pickQuality(): Quality {
  const q = new URLSearchParams(location.search).get('q') ?? (() => { try { return localStorage.getItem('ue.quality'); } catch { return null; } })();
  if (q && q in QUALITY) return QUALITY[q as Quality['name']];
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return QUALITY.low;
  // discrete or Apple-silicon GPUs get the high preset; everything else starts at medium
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch { /* renderer string unavailable */ }
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return QUALITY.low;
  return /NVIDIA|GeForce|RTX|Radeon (RX|Pro)|Apple M\d|Arc\(TM\) A/i.test(gpu) ? QUALITY.high : QUALITY.medium;
}

/** The next preset down, or null at the bottom. */
export function lowerQuality(q: Quality): Quality | null {
  const order: Quality['name'][] = ['low', 'medium', 'high', 'ultra'];
  const i = order.indexOf(q.name);
  return i > 0 ? QUALITY[order[i - 1]] : null;
}
