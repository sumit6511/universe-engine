// Nebulae, star clusters and pulsars: instanced procedural billboards at measured 3D positions.

import { AdditiveBlending, BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { LY_KM, PC_KM } from '../core/constants';
import { raDecToWorld } from '../core/frames';
import { DEEP_SKY, type DeepSkyDef } from '../data/deepsky';
import type { Engine, FrameContext, System } from '../engine/engine';
import { Entity } from '../engine/entity';
import type { AddLabel } from '../engine/labels';
import { NOISE, REL, RELATIVITY } from '../shaders/common';
import { sig } from '../ui/format';

const TYPE_ID: Record<DeepSkyDef['type'], number> = { emission: 0, planetary: 1, remnant: 2, open: 3, globular: 4, pulsar: 5 };
const TYPE_LABEL: Record<DeepSkyDef['type'], string> = {
  emission: 'Emission nebula', planetary: 'Planetary nebula', remnant: 'Supernova remnant', open: 'Open star cluster', globular: 'Globular cluster', pulsar: 'Pulsar',
};
const _v = new Vector3();

export class DeepSky implements System {
  show = false;
  objects: { def: DeepSkyDef; entity: Entity; rel: Vector3 }[] = [];
  private mesh: Mesh;
  private material: ShaderMaterial;

  private engineRef: Engine;
  constructor(engine: Engine) {
    this.engineRef = engine;
    const n = DEEP_SKY.length;
    const iPos = new Float32Array(n * 3), iParams = new Float32Array(n * 4);
    DEEP_SKY.forEach((def, i) => {
      const e = new Entity(`dso:${i}`, def.name, 'region');
      raDecToWorld(def.ra, def.dec, def.dist, e.anchor);
      // pulsars are city-sized: give them a visible stand-in size for navigation only
      const r = def.type === 'pulsar' ? 0.02 : def.radius;
      e.radiusKm = r * PC_KM;
      e.minDistKm = e.radiusKm * 1.3;
      e.viewDistKm = e.radiusKm * (def.type === 'pulsar' ? 60 : 4.2);
      e.subtitle = TYPE_LABEL[def.type];
      e.color = def.type === 'emission' ? 0xff8fa8 : def.type === 'planetary' ? 0x8fe8d8 : def.type === 'remnant' ? 0xffb38a : def.type === 'pulsar' ? 0xb6c8ff : 0xdfe6ff;
      e.rank = 30;
      e.getInfo = () => ({
        title: def.name, subtitle: e.subtitle + (def.alt ? ` · ${def.alt}` : ''), blurb: def.blurb,
        rows: [
          { k: 'Distance from Sun', v: `${sig((def.dist * PC_KM) / LY_KM, 3)} ly`, hint: `${sig(def.dist, 3)} pc` },
          ...(def.type === 'pulsar'
            ? [{ k: 'Spin period', v: def.period! < 0.1 ? `${sig(def.period! * 1000, 4)} ms` : `${sig(def.period!, 4)} s`, hint: `${sig(1 / def.period!, 3)} rotations per second` }, { k: 'True size', v: '~20 km across' }]
            : [{ k: 'Diameter', v: `${sig((def.radius * 2 * PC_KM) / LY_KM, 2)} ly` }, { k: 'Apparent size from Earth', v: `${sig(((def.radius * 2) / def.dist) * 57.2958 * 60, 2)} arcmin` }]),
          { k: 'Light left it', v: `${sig((def.dist * PC_KM) / LY_KM, 3)} years ago` },
        ],
        notes: ['Position and size are measured; the image is a procedural impression of the object type, not a photograph.',
          ...(def.type === 'pulsar' ? ['The flash is slowed for display when the true spin is faster than the screen can show.'] : [])],
      });
      this.objects.push({ def, entity: e, rel: new Vector3() });
      iPos.set([e.anchor.x, e.anchor.y, e.anchor.z], i * 3);
      // displayed pulse rate, capped at 3 Hz
      iParams.set([r, TYPE_ID[def.type], (i * 0.6180339) % 1, def.period ? Math.min(3, 1 / def.period) : 0], i * 4);
    });
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iPos', new InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iParams', new InstancedBufferAttribute(iParams, 4));
    geo.instanceCount = n;
    this.material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uPixelScale: { value: 1000 }, uPixelRatio: { value: 1 }, uGain: { value: 1 }, uTime: { value: 0 }, uBeta: REL.uBeta },
      vertexShader: /* glsl */ `
        ${RELATIVITY}
        attribute vec3 iPos; attribute vec4 iParams;
        uniform float uPixelScale, uPixelRatio, uGain;
        varying vec2 vUv; varying vec4 vParams; varying float vFlux; varying float vPx;
        void main(){
          vec4 c = modelViewMatrix * vec4(iPos, 1.0);
          float d = max(length(c.xyz), 1e-9);
          float dop; c.xyz = aberrate(c.xyz, dop);
          float R = iParams.x * (iParams.y > 4.5 ? 40.0 : 1.35);      // pulsars: draw the beam/glow, not the 20 km star
          float px = R / d * uPixelScale;
          float s = max(px, 2.4 * uPixelRatio);
          vPx = px;
          vFlux = pow(px / s, 1.1) * uGain * relExposure(dop);
          vec3 f = c.xyz / d;
          vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
          vec3 u = cross(r, f);
          vec3 p = c.xyz + (r * position.x + u * position.y) * (s / uPixelScale * d);
          vUv = position.xy; vParams = iParams;
          gl_Position = projectionMatrix * vec4(p, 1.0);
          gl_Position.z = 0.0;
          if (c.z > 0.0 || vFlux < 4e-3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${NOISE}
        uniform float uTime;
        varying vec2 vUv; varying vec4 vParams; varying float vFlux; varying float vPx;
        void main(){
          float type = vParams.y, seed = vParams.z * 31.0;
          float r = length(vUv);
          if (r > 1.0) discard;
          vec3 q = vec3(vUv * 2.2, seed);
          vec3 col = vec3(0.0);
          if (type < 0.5) {
            // H II region: hydrogen-alpha red with oxygen teal in the excited core, cut by dust
            float n = fbm(q) * 0.6 + fbm(q * 2.3 + 4.0) * 0.4;
            float cloud = smoothstep(-0.25, 0.55, n) * smoothstep(1.0, 0.25, r + 0.25 * fbm(q * 1.4 + 9.0));
            float dust = smoothstep(0.15, 0.6, fbm(q * 1.8 - 3.0));
            col = mix(vec3(1.0, 0.22, 0.34), vec3(0.45, 0.85, 0.80), smoothstep(0.55, 0.05, r) * 0.6) * cloud * (1.0 - 0.75 * dust) * 0.75;
            col += vec3(0.8, 0.9, 1.0) * exp(-r * r * 60.0) * 0.6;             // ionising cluster
          } else if (type < 1.5) {
            // planetary nebula: limb-brightened shell around a white dwarf
            float shell = exp(-pow((r - 0.62) / 0.14, 2.0)) * (0.75 + 0.35 * snoise(vec3(vUv * 6.0, seed)));
            col = vec3(0.25, 0.95, 0.80) * shell * 0.9 + vec3(1.0, 0.35, 0.3) * exp(-pow((r - 0.82) / 0.10, 2.0)) * 0.5;
            col += vec3(0.15, 0.5, 0.7) * smoothstep(0.62, 0.0, r) * 0.25 + vec3(0.9, 0.95, 1.0) * exp(-r * r * 400.0);
          } else if (type < 2.5) {
            // supernova remnant: thin shocked filaments on an expanding shell
            float a = atan(vUv.y, vUv.x);
            float fil = pow(1.0 - abs(snoise(vec3(a * 2.5, r * 7.0, seed))), 7.0) + 0.6 * pow(1.0 - abs(snoise(vec3(a * 5.0 + 2.0, r * 13.0, seed + 5.0))), 9.0);
            float shell = smoothstep(0.25, 0.85, r) * smoothstep(1.0, 0.86, r);
            col = mix(vec3(1.0, 0.45, 0.25), vec3(0.35, 0.75, 1.0), snoise(vec3(vUv * 3.0, seed)) * 0.5 + 0.5) * fil * shell * 1.1;
            col += vec3(0.6, 0.5, 0.9) * exp(-r * r * 6.0) * 0.06;
          } else if (type < 4.5) {
            // star cluster: individual stars (open) or a dense ball with a steep core (globular)
            float glob = step(3.5, type);
            float cells = mix(9.0, 26.0, glob);
            vec2 g = vUv * cells; vec2 id = floor(g); vec2 fr = fract(g) - 0.5;
            float h = hash21(id + seed);
            vec2 off = (vec2(hash21(id + seed + 3.1), hash21(id + seed + 7.7)) - 0.5) * 0.7;
            float dens = mix(smoothstep(1.0, 0.1, r), 1.0 / pow(1.0 + (r / 0.22) * (r / 0.22), 1.3), glob);
            float star = exp(-dot(fr - off, fr - off) * mix(60.0, 26.0, glob)) * step(1.0 - dens * mix(0.75, 1.0, glob), h);
            vec3 sc = mix(mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), step(0.82, h)), vec3(1.0, 0.88, 0.68), glob);
            col = sc * star * 1.6 + mix(vec3(0.4, 0.55, 1.0) * 0.05, vec3(1.0, 0.85, 0.6) * 0.5, glob) * dens * smoothstep(1.0, 0.6, r);
          } else {
            // pulsar: lighthouse beams sweeping past, shown as a flash
            float ph = fract(uTime * vParams.w);
            float flash = exp(-pow(min(ph, 1.0 - ph) / 0.09, 2.0));
            float beam = exp(-abs(vUv.x) * 60.0) * smoothstep(1.0, 0.0, abs(vUv.y));
            col = vec3(0.7, 0.8, 1.0) * (exp(-r * r * 90.0) * (0.5 + 1.5 * flash) + beam * flash * 0.9 + exp(-r * 6.0) * 0.08);
          }
          if (vPx < 2.4) col = (type < 0.5 ? vec3(1.0, 0.4, 0.5) : type < 1.5 ? vec3(0.4, 1.0, 0.85) : type < 2.5 ? vec3(1.0, 0.6, 0.4) : vec3(0.8, 0.86, 1.0)) * exp(-r * r * 3.0) * 0.7;
          gl_FragColor = vec4(col * vFlux, 1.0);
        }`,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    engine.stellar.root.add(this.mesh);
  }

  update(ctx: FrameContext): void {
    this.mesh.visible = this.show && this.engineRef.skyDim > 0.05;
    if (!this.show) return;
    const u = this.material.uniforms;
    u.uPixelScale.value = ctx.pixelScale; u.uPixelRatio.value = ctx.pixelRatio; u.uTime.value = ctx.time;
    // faint from inside the disc, clearer once they are the subject of the view
    const scalePc = ctx.distKm / PC_KM;
    u.uGain.value = this.engineRef.skyDim * (0.55 + 0.6 * Math.min(1, Math.max(0, Math.log10(Math.max(scalePc, 1e-3) / 0.05) / 2)));
    for (const o of this.objects) ctx.rel(o.entity, o.rel);
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    if (!this.show || ctx.sunDistPc > 60000 || this.engineRef.skyDim < 0.35) return;
    const p = { x: 0, y: 0 };
    for (const o of this.objects) {
      const d = o.rel.length();
      const px = ((o.entity.radiusKm * (o.def.type === 'pulsar' ? 40 : 1)) / Math.max(d, 1)) * ctx.pixelScale / ctx.pixelRatio;
      const target = ctx.rig.target === o.entity;
      if (px < 3.5 && !target) continue;
      if (!ctx.project(_v.copy(o.rel), p, true)) continue;
      add({ x: p.x, y: p.y, text: o.def.name, priority: target ? 1100 : 27 + Math.min(20, px * 0.2), color: '#' + o.entity.color.toString(16).padStart(6, '0'), entity: o.entity, offset: Math.min(70, Math.max(8, px + 5)), kind: 'galaxy', key: o.entity.id });
    }
  }

  /** Object under a screen point, if any. */
  pick(ctx: FrameContext, x: number, y: number): Entity | null {
    if (!this.show) return null;
    const p = { x: 0, y: 0 };
    let best: Entity | null = null, bestR = Infinity;
    for (const o of this.objects) {
      if (!ctx.project(_v.copy(o.rel), p, true)) continue;
      const px = ((o.entity.radiusKm * (o.def.type === 'pulsar' ? 40 : 1)) / Math.max(o.rel.length(), 1)) * ctx.pixelScale / ctx.pixelRatio;
      const r = Math.hypot(p.x - x, p.y - y);
      if (px >= 3 && r < Math.max(12, px * 0.7) && r < bestR) { bestR = r; best = o.entity; }
    }
    return best;
  }
}
