// Planet / moon surface, ring, atmosphere and star-surface shaders (near layer, kilometres,
// logarithmic depth).  All lighting is done in camera-relative world space.

import { BLACKBODY, LOGDEPTH_FRAG, LOGDEPTH_FRAG_PARS, LOGDEPTH_VERT, LOGDEPTH_VERT_PARS, NOISE } from './common';

export const BODY_VERT = /* glsl */ `
${LOGDEPTH_VERT_PARS}
uniform vec3 uOblate;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * (position * uOblate));
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERT}
}
`;

const SHADOWS = /* glsl */ `
uniform vec3 uSunPos;      // camera-relative, km
uniform float uSunRadius;  // km
uniform vec4 uOcc[4];      // occluders: xyz camera-relative km, w radius km
uniform int uOccCount;

// Fraction of the solar disc visible from P past a spherical occluder (umbra + penumbra).
float eclipse(vec3 P, vec4 occ){
  vec3 toS = uSunPos - P;
  vec3 toO = occ.xyz - P;
  float dS = length(toS), dO = length(toO);
  if (dO >= dS || dO < occ.w) return 1.0;
  float aS = asin(clamp(uSunRadius / dS, 0.0, 1.0));
  float aO = asin(clamp(occ.w / dO, 0.0, 1.0));
  float sep = atan(length(cross(toS, toO)), dot(toS, toO));
  if (sep >= aS + aO) return 1.0;
  if (sep <= abs(aO - aS)) return aO >= aS ? 0.0 : 1.0 - (aO * aO) / (aS * aS);
  float a2 = aS * aS, b2 = aO * aO, d2 = sep * sep;
  float A = a2 * acos(clamp((d2 + a2 - b2) / (2.0 * sep * aS), -1.0, 1.0))
          + b2 * acos(clamp((d2 + b2 - a2) / (2.0 * sep * aO), -1.0, 1.0))
          - 0.5 * sqrt(max(0.0, (-sep + aS + aO) * (sep + aS - aO) * (sep - aS + aO) * (sep + aS + aO)));
  return clamp(1.0 - A / (3.14159265 * a2), 0.0, 1.0);
}
float eclipses(vec3 P){
  float s = 1.0;
  for (int i = 0; i < 4; i++) { if (i < uOccCount) s *= eclipse(P, uOcc[i]); }
  return s;
}
`;

export const BODY_FRAG = /* glsl */ `
${LOGDEPTH_FRAG_PARS}
${NOISE}
${SHADOWS}
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uRegolith;
uniform float uLight;
uniform float uTime;
uniform float uSeed;
uniform float uTemp;
// ring shadow
uniform vec3 uCenter;      // planet centre, camera-relative km
uniform vec3 uPole;        // world-space spin axis
uniform float uRingInner;
uniform float uRingOuter;
uniform sampler2D uRingMap;
#ifdef EARTH
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform mat4 modelMatrix;
#endif
uniform float uLive;       // 1 = animated weather, cloud shadows and aurorae (advanced mode)
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;

vec2 sphereUV(vec3 d){
  float uA = atan(-d.z, d.x) / 6.28318530718 + 0.5;
  float uB = fract(uA + 0.5) - 0.5;
  float u = fwidth(uA) < fwidth(uB) - 0.0005 ? uA : uB;   // hide the mip seam at the antimeridian
  return vec2(u, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
}

#ifdef PROCEDURAL
float craters(vec3 p, float scale){
  vec3 q = p * scale; vec3 c = floor(q); float m = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
    vec3 o = c + vec3(float(x), float(y), float(z));
    vec3 h = hash33(o + uSeed);
    float r = 0.18 + 0.3 * h.x * h.x;
    float d = length(q - (o + 0.2 + 0.6 * h.yzx)) / r;
    m += smoothstep(1.0, 0.75, d) * (smoothstep(0.55, 0.95, d) * 0.9 - 0.35) * step(0.45, h.z);
  }
  return m;
}
vec3 proceduralAlbedo(vec3 d){
  vec3 p = d + uSeed * 3.1;
#if PROCEDURAL == 1
  // cratered regolith
  float n = fbm(p * 2.2) * 0.5 + fbm(p * 9.0) * 0.25;
  float c = craters(d, 5.0) * 0.5 + craters(d, 13.0) * 0.3 + craters(d, 31.0) * 0.15;
  return uTint * clamp(0.78 + 0.45 * n + 0.5 * c, 0.15, 1.6);
#elif PROCEDURAL == 2
  // ice shell with dark lineae
  float n = fbm(p * 3.0);
  float ridges = 1.0 - abs(snoise(p * 6.0 + n * 1.5));
  ridges = pow(ridges, 8.0) + 0.6 * pow(1.0 - abs(snoise(p * 13.0 - n)), 10.0);
  vec3 ice = uTint * (0.9 + 0.18 * n);
  vec3 dark = uTint * vec3(0.62, 0.45, 0.34);
  return mix(ice, dark, clamp(ridges * 0.8 + smoothstep(0.1, 0.6, fbm(p * 1.3)) * 0.35, 0.0, 1.0));
#elif PROCEDURAL == 3
  // thick photochemical haze
  float band = 0.04 * sin(d.y * 9.0) + 0.05 * fbm(vec3(p.x * 1.5, p.y * 5.0, p.z * 1.5));
  return uTint * (0.92 + band) * mix(vec3(1.0), vec3(0.75, 0.82, 1.0), smoothstep(0.75, 1.0, abs(d.y)) * 0.25);
#else
  // gas / ice giant cloud bands (illustrative; colours follow Sudarsky classes via uTint)
  float lat = d.y;
  float warp = fbm(vec3(p.x * 2.0, lat * 7.0, p.z * 2.0)) * 0.08;
  float bands = sin((lat + warp) * 22.0 + uSeed * 20.0) * 0.5 + sin((lat + warp * 2.0) * 9.0 + uSeed * 7.0) * 0.5;
  float turb = fbm(vec3(p.x * 6.0, lat * 26.0, p.z * 6.0));
  vec3 a = uTint, b = uTint * vec3(0.72, 0.66, 0.62);
  vec3 col = mix(a, b, smoothstep(-0.6, 0.6, bands + 0.6 * turb));
  col += vec3(1.0, 0.45, 0.15) * smoothstep(1300.0, 2400.0, uTemp) * 0.5 * (0.5 + 0.5 * turb); // thermal glow of hot Jupiters
  return col;
#endif
}
#endif

void main(){
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(-vWorld);
  vec3 toSun = uSunPos - vWorld;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  float sunAng = uSunRadius / dSun;
  float ndl = dot(N, L);
  float mu0 = clamp(ndl + sunAng, 0.0, 1.0);          // extended source softens the terminator
  float mu = max(dot(N, V), 1e-3);
  float lambert = mu0;
  float lunar = 2.0 * mu0 / (mu0 + mu);               // Lommel-Seeliger
  float diffuse = mix(lambert, lunar, uRegolith * 0.65);

  vec3 d = normalize(vObj);
#ifdef PROCEDURAL
  vec3 albedo = proceduralAlbedo(d);
#else
  vec2 uv = sphereUV(d);
#ifdef GASGIANT
  // Zonal winds: alternating east-west jets advect the cloud map. Two phases of the same flow are
  // cross-faded so the shear never accumulates (speeds are exaggerated to be visible).
  float jet = sin(d.y * 19.0) * 0.6 + sin(d.y * 7.0 + 1.3) * 0.4;
  float cyc = uTime * 0.03 * uLive;
  float p1 = fract(cyc), p2 = fract(cyc + 0.5);
  float swirl = snoise(vec3(d.xz * 9.0, d.y * 30.0 + cyc)) * 0.0012 * uLive;
  vec3 ga = texture2D(uMap, vec2(uv.x + jet * 0.03 * (p1 - 0.5), uv.y + swirl)).rgb;
  vec3 gb = texture2D(uMap, vec2(uv.x + jet * 0.03 * (p2 - 0.5), uv.y + swirl)).rgb;
  vec3 albedo = mix(ga, gb, abs(p1 - 0.5) * 2.0) * uTint;
#else
  vec3 albedo = texture2D(uMap, uv).rgb * uTint;
#endif
#endif

  float shadow = eclipses(vWorld);
#ifdef RING_SHADOW
  float denom = dot(L, uPole);
  if (abs(denom) > 1e-4) {
    float t = dot(uCenter - vWorld, uPole) / denom;
    if (t > 0.0) {
      float r = length(vWorld + L * t - uCenter);
      float x = (r - uRingInner) / (uRingOuter - uRingInner);
      if (x > 0.0 && x < 1.0) shadow *= 1.0 - 0.9 * texture2D(uRingMap, vec2(x, 0.5)).a;
    }
  }
#endif

  vec3 col = albedo * diffuse * shadow * uLight;

#ifdef EARTH
  // clouds drift slowly eastward relative to the ground
  vec2 cuv = uv + vec2(uTime * 0.0005 * uLive, 0.0);
  float clouds = texture2D(uClouds, cuv).r;
  // cloud shadows: look up the cloud deck a little way toward the Sun
  vec3 Lo = normalize(transpose(mat3(modelMatrix)) * L);
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(0.0, 0.0, 1e-5));
  vec3 north = cross(d, east);
  float cosLat = max(sqrt(1.0 - d.y * d.y), 0.2);
  vec2 suv = cuv + vec2(dot(Lo, east) / (6.2832 * cosLat), dot(Lo, north) / 3.1416) * 0.006;
  col *= 1.0 - 0.5 * uLive * texture2D(uClouds, suv).r * (1.0 - clouds);
  float ocean = smoothstep(0.02, 0.10, albedo.b - max(albedo.r, albedo.g * 0.82)) * step(dot(albedo, vec3(0.333)), 0.35);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 260.0) * 0.85 + pow(max(dot(N, H), 0.0), 40.0) * 0.07;
  float fres = pow(1.0 - mu, 5.0);
  col += vec3(1.0, 0.95, 0.85) * (spec + fres * 0.06 * mu0) * ocean * (1.0 - clouds) * step(0.0, ndl) * shadow * uLight;
  col = mix(col, vec3(1.0) * (0.25 + 0.75 * mu0) * mu0 * shadow * uLight * 0.95, clamp(clouds * clouds * 1.25, 0.0, 1.0));
  float night = 1.0 - smoothstep(-0.12, 0.06, ndl);
  vec3 lights = texture2D(uNight, uv).rgb;
  col += lights * lights * vec3(1.0, 0.82, 0.55) * 1.6 * (night + (1.0 - shadow) * step(0.0, ndl)) * (1.0 - clouds * 0.75);
  // aurorae: ovals ~23 degrees from the geomagnetic poles (80.7N 72.7W and its antipode)
  float ml = abs(dot(d, vec3(0.0481, 0.9869, 0.1543)));
  float oval = exp(-pow((ml - 0.9205) / 0.016, 2.0));
  float curtain = 0.45 + 0.55 * snoise(vec3(d * 38.0 + vec3(0.0, uTime * 0.25, 0.0)));
  col += vec3(0.12, 1.0, 0.42) * oval * max(curtain, 0.0) * night * 0.55 * uLive;
#endif
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------
export const RING_VERT = /* glsl */ `
${LOGDEPTH_VERT_PARS}
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  vLocal = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERT}
}
`;

export const RING_FRAG = /* glsl */ `
${LOGDEPTH_FRAG_PARS}
uniform sampler2D uRingMap;
uniform vec3 uSunPos;
uniform float uSunRadius;
uniform vec3 uCenter;
uniform vec3 uPole;
uniform vec3 uTint;
uniform float uPlanetRadius;   // equatorial, km
uniform float uPolarRatio;     // polar / equatorial
uniform float uRingInner;
uniform float uRingOuter;
uniform float uLight;
varying vec3 vWorld;
varying vec2 vLocal;
void main(){
  ${LOGDEPTH_FRAG}
  float r = length(vLocal);
  float x = (r - uRingInner) / (uRingOuter - uRingInner);
  if (x <= 0.0 || x >= 1.0) discard;
  vec4 tex = texture2D(uRingMap, vec2(x, 0.5));
  float tau = tex.a;
  vec3 L = normalize(uSunPos - vWorld);
  vec3 V = normalize(-vWorld);
  // shadow of the oblate planet: intersect the sun ray with the spheroid in stretched space
  vec3 rel = vWorld - uCenter;
  vec3 relS = rel + uPole * dot(rel, uPole) * (1.0 / uPolarRatio - 1.0);
  vec3 LS = L + uPole * dot(L, uPole) * (1.0 / uPolarRatio - 1.0);
  float lsl = length(LS); LS /= lsl;
  float b = dot(relS, LS);
  float perp = sqrt(max(0.0, dot(relS, relS) - b * b));
  float shadow = b < 0.0 ? smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.015, perp) : 1.0;
  // lit side vs. unlit side (diffuse transmission through optically thin regions)
  float sideSun = dot(L, uPole), sideView = dot(V, uPole);
  float sameSide = step(0.0, sideSun * sideView);
  float muS = abs(sideSun);
  float lit = mix(0.12 + 0.55 * (1.0 - tau) * tau * 4.0 * 0.5, 0.55 + 0.45 * muS, sameSide);
  // forward scattering when looking toward the sun through the rings
  float fwd = pow(max(dot(-V, L), 0.0), 12.0) * (1.0 - sameSide) * 0.8;
  vec3 col = tex.rgb * uTint * (lit + fwd) * shadow * uLight;
  float alpha = clamp(tau * 1.05, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

// ---------------------------------------------------------------------------------------------
// Atmosphere: single scattering (Rayleigh + Mie), ray-marched in the planet's unit-sphere space.
// After Nishita et al. (1993); structure follows the public-domain glsl-atmosphere by wwwtyro.
// ---------------------------------------------------------------------------------------------
export const ATMO_VERT = /* glsl */ `
${LOGDEPTH_VERT_PARS}
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERT}
}
`;

export const ATMO_FRAG = /* glsl */ `
${LOGDEPTH_FRAG_PARS}
uniform mat4 uInvModel;     // world (camera-relative) -> planet unit-sphere space
uniform vec3 uSunDirObj;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform float uHR;
uniform float uHM;
uniform float uTop;         // outer radius in planet radii
uniform float uG;
uniform float uIntensity;
varying vec3 vWorld;
const int VSTEPS = ATMO_STEPS;
const int LSTEPS = 4;

vec2 raySphere(vec3 ro, vec3 rd, float R){
  float b = dot(ro, rd); float c = dot(ro, ro) - R * R; float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
void main(){
  ${LOGDEPTH_FRAG}
  vec3 ro = (uInvModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 rd = normalize(mat3(uInvModel) * vWorld);
  vec2 ta = raySphere(ro, rd, uTop);
  if (ta.x > ta.y) discard;
  vec2 tp = raySphere(ro, rd, 1.0);
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;
  bool ground = tp.x < tp.y && tp.x > 0.0;
  if (ground) t1 = tp.x;
  float ds = (t1 - t0) / float(VSTEPS);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(rd, uSunDirObj);
  float pR = 0.0596831 * (1.0 + mu * mu);
  float g2 = uG * uG;
  float pM = 0.1193662 * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));
  for (int i = 0; i < VSTEPS; i++){
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float h = max(length(p) - 1.0, 0.0);
    float dR = exp(-h / uHR) * ds, dM = exp(-h / uHM) * ds;
    odR += dR; odM += dM;
    // light ray toward the sun
    vec2 tl = raySphere(p, uSunDirObj, uTop);
    vec2 tg = raySphere(p, uSunDirObj, 0.9985);
    float lit = (tg.x < tg.y && tg.y > 0.0) ? 0.0 : 1.0;      // sample is inside the planet's shadow
    if (lit > 0.0) {
      float dl = tl.y / float(LSTEPS);
      float lR = 0.0, lM = 0.0;
      for (int j = 0; j < LSTEPS; j++){
        vec3 q = p + uSunDirObj * dl * (float(j) + 0.5);
        float hq = max(length(q) - 1.0, 0.0);
        lR += exp(-hq / uHR) * dl; lM += exp(-hq / uHM) * dl;
      }
      vec3 att = exp(-(uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM)));
      sumR += dR * att; sumM += dM * att;
    }
  }
  vec3 col = uIntensity * (pR * uBetaR * sumR + pM * uBetaM * sumM);
  vec3 T = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
  float alpha = 1.0 - dot(T, vec3(0.3333));
  gl_FragColor = vec4(col, alpha * (ground ? 0.55 : 0.5));
}
`;

// ---------------------------------------------------------------------------------------------
// Star photosphere
// ---------------------------------------------------------------------------------------------
export const STAR_VERT = /* glsl */ `
${LOGDEPTH_VERT_PARS}
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * position);
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERT}
}
`;

export const STAR_FRAG = /* glsl */ `
${LOGDEPTH_FRAG_PARS}
${NOISE}
${BLACKBODY}
uniform float uTeff;
uniform float uTime;
uniform float uGain;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
void main(){
  ${LOGDEPTH_FRAG}
  vec3 N = normalize(vNormalW);
  float mu = clamp(dot(N, normalize(-vWorld)), 0.0, 1.0);
  // granulation and slowly evolving active regions
  vec3 p = normalize(vObj);
  float gran = snoise(p * 42.0 + vec3(0.0, uTime * 0.06, 0.0)) * 0.5 + snoise(p * 95.0 - vec3(uTime * 0.09)) * 0.25;
  float cells = fbm(p * 5.0 + vec3(uTime * 0.012));
  float spots = smoothstep(0.52, 0.72, fbm(p * 2.6 + 11.0)) * smoothstep(0.75, 0.2, abs(p.y));
  float T = uTeff * (1.0 + 0.035 * gran + 0.05 * cells) * (1.0 - 0.22 * spots);
  // limb darkening: the limb shows cooler, higher layers (Eddington approximation)
  float ld = 0.4 + 0.6 * mu;
  T *= pow(ld, 0.25);
  vec3 col = blackbody(T) * ld * (0.85 + 0.3 * gran + 0.25 * cells);
  gl_FragColor = vec4(col * uGain, 1.0);
}
`;

/** Soft additive glow billboard (stellar corona / glare / planet marker). */
export const GLOW_VERT = /* glsl */ `
${LOGDEPTH_VERT_PARS}
uniform float uSizeKm;      // physical half-size
uniform float uMinPx;       // minimum half-size in device px
uniform float uPixelScale;
varying vec2 vUv;
void main(){
  vUv = position.xy;
  vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = max(length(mv.xyz), 1e-6);
  float hs = max(uSizeKm, uMinPx * dist / uPixelScale);
  mv.xy += position.xy * hs;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERT}
}
`;

export const GLOW_FRAG = /* glsl */ `
${LOGDEPTH_FRAG_PARS}
uniform vec3 uColor;
uniform float uPower;
uniform float uInner;       // normalised radius of the solid body (no glow drawn inside)
uniform float uAlpha;
varying vec2 vUv;
void main(){
  ${LOGDEPTH_FRAG}
  float r = length(vUv);
  if (r > 1.0) discard;
  float x = max(r, uInner) / max(uInner, 1e-3);
  float g = pow(1.0 / x, uPower) * smoothstep(1.0, 0.55, r);
  gl_FragColor = vec4(uColor * g * uAlpha, 1.0);
}
`;
