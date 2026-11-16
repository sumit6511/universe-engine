// Planetarium: stand on the surface of the Earth at a chosen place and look up.
//
// The camera sits a few metres above the IAU-oriented, rotating Earth, so the sky that comes
// out (which stars are up, where the Sun, Moon and planets are, the tilt of the Milky Way)
// follows from the same ephemerides as everything else rather than from a sky-chart formula.

import { AdditiveBlending, BackSide, CircleGeometry, DoubleSide, Matrix4, Mesh, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { DEG } from '../core/constants';
import type { Engine, FrameContext, System } from '../engine/engine';
import type { AddLabel } from '../engine/labels';
import { LOGDEPTH_FRAG, LOGDEPTH_FRAG_PARS, LOGDEPTH_VERT, LOGDEPTH_VERT_PARS } from '../shaders/common';
import type { SolarSystem } from './solar';

export const PLACES: { name: string; lat: number; lon: number }[] = [
  { name: 'Greenwich, UK', lat: 51.477, lon: 0 },
  { name: 'New York, USA', lat: 40.71, lon: -74.01 },
  { name: 'Kathmandu, Nepal', lat: 27.72, lon: 85.32 },
  { name: 'Tokyo, Japan', lat: 35.68, lon: 139.69 },
  { name: 'Sydney, Australia', lat: -33.87, lon: 151.21 },
  { name: 'Cape Town, South Africa', lat: -33.92, lon: 18.42 },
  { name: 'Paranal Observatory, Chile', lat: -24.63, lon: -70.4 },
  { name: 'Mauna Kea, Hawaii', lat: 19.82, lon: -155.47 },
  { name: 'Quito, Ecuador (equator)', lat: -0.18, lon: -78.47 },
  { name: 'North Pole', lat: 89.9, lon: 0 },
  { name: 'South Pole', lat: -89.9, lon: 0 },
];

const _up = new Vector3(), _north = new Vector3(), _east = new Vector3(), _v = new Vector3(), _m = new Matrix4();

export class Planetarium implements System {
  active = false;
  place = PLACES[0];
  /** altitude of the Sun above the horizon, degrees */
  sunAlt = 0;
  private ground: Mesh;
  private dome: Mesh;
  private frame = new Quaternion();
  private saved: [boolean, boolean] = [true, true];

  constructor(private engine: Engine, private solar: SolarSystem) {
    this.ground = new Mesh(new CircleGeometry(600, 96), new ShaderMaterial({
      side: DoubleSide,
      uniforms: { uDay: { value: 0 } },
      vertexShader: `${LOGDEPTH_VERT_PARS} varying vec2 vP; void main(){ vP = position.xy; vec4 wp = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; ${LOGDEPTH_VERT} }`,
      fragmentShader: `${LOGDEPTH_FRAG_PARS} uniform float uDay; varying vec2 vP;
        void main(){ ${LOGDEPTH_FRAG}
          float r = length(vP);
          vec3 night = vec3(0.012, 0.014, 0.02), day = vec3(0.10, 0.13, 0.09);
          gl_FragColor = vec4(mix(night, day, uDay) * (0.7 + 0.3 * smoothstep(0.0, 300.0, r)), 1.0); }`,
    }));
    this.dome = new Mesh(new SphereGeometry(1, 48, 24), new ShaderMaterial({
      side: BackSide, transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uUp: { value: new Vector3(0, 1, 0) }, uSun: { value: new Vector3(1, 0, 0) }, uDay: { value: 0 }, uTwilight: { value: 0 } },
      vertexShader: `${LOGDEPTH_VERT_PARS} varying vec3 vDir; void main(){ vDir = normalize(mat3(modelMatrix) * position); vec4 wp = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; ${LOGDEPTH_VERT} }`,
      fragmentShader: `${LOGDEPTH_FRAG_PARS} uniform vec3 uUp, uSun; uniform float uDay, uTwilight; varying vec3 vDir;
        void main(){ ${LOGDEPTH_FRAG}
          vec3 d = normalize(vDir);
          float h = max(dot(d, uUp), 0.0);
          float toSun = max(dot(d, uSun), 0.0);
          // Rayleigh-like daytime sky: deeper blue overhead, paler toward the horizon, glare near the Sun
          vec3 day = mix(vec3(0.55, 0.72, 0.95), vec3(0.12, 0.30, 0.75), pow(h, 0.45)) * uDay * 0.6;
          day += vec3(1.0, 0.9, 0.7) * pow(toSun, 24.0) * 0.3 * uDay;
          // twilight arch: warm band on the horizon toward the Sun
          vec3 dusk = mix(vec3(0.95, 0.42, 0.15), vec3(0.10, 0.14, 0.38), smoothstep(0.0, 0.35, h)) * uTwilight * (0.25 + 0.75 * pow(toSun, 3.0)) * (1.0 - smoothstep(0.0, 0.6, h) * 0.7);
          gl_FragColor = vec4(day + dusk, 1.0); }`,
    }));
    this.ground.renderOrder = -6; this.dome.renderOrder = -7;
    this.ground.frustumCulled = this.dome.frustumCulled = false;
    this.ground.visible = this.dome.visible = false;
    engine.near.scene.add(this.dome, this.ground);
  }

  enter(place = this.place): void {
    this.place = place;
    const earth = this.solar.byId.get('earth')!;
    const rig = this.engine.rig;
    rig.setFlying(false);
    rig.setFocus(earth.entity, earth.def.radius);
    rig.surface = { frame: this.frame, offset: new Vector3() };
    if (!this.active) { rig.yaw = Math.PI; rig.pitch = 0.45; } // face south, look up a little
    if (!this.active) { this.saved = [this.solar.showOrbits, this.solar.showBelt]; this.solar.showOrbits = this.solar.showBelt = false; }
    this.active = true;
    this.solar.hideBody = 'earth';
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    const rig = this.engine.rig;
    rig.surface = null;
    this.solar.hideBody = null;
    [this.solar.showOrbits, this.solar.showBelt] = this.saved;
    this.engine.skyDim = 1;
    this.ground.visible = this.dome.visible = false;
    const earth = this.solar.byId.get('earth')!.entity;
    rig.setFocus(earth, earth.viewDist);
    rig.pitch = -0.2;
  }

  /** Runs before the camera: place the observer on the rotating Earth. */
  simulate(): void {
    if (!this.active) return;
    const earth = this.solar.byId.get('earth')!;
    const q = this.solar.orientation(earth);
    const lat = this.place.lat * DEG, lon = this.place.lon * DEG;
    _up.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).applyQuaternion(q);
    _v.set(0, 1, 0).applyQuaternion(q); // spin axis
    _east.crossVectors(_v, _up).normalize();
    _north.crossVectors(_up, _east).normalize();
    // local frame: X east, Y up, Z south, so that yaw 0 looks north
    this.frame.setFromRotationMatrix(_m.makeBasis(_east, _up, _v.copy(_north).negate()));
    const rig = this.engine.rig;
    if (rig.surface) rig.surface.offset.copy(_up).multiplyScalar(earth.def.radius + 0.02);
    _v.subVectors(this.solar.sun.entity.local, earth.entity.local).normalize();
    this.sunAlt = Math.asin(Math.max(-1, Math.min(1, _v.dot(_up)))) / DEG;
  }

  update(ctx: FrameContext): void {
    if (!this.active) return;
    const day = Math.min(1, Math.max(0, (this.sunAlt + 4) / 9));
    const twilight = Math.min(1, Math.max(0, (this.sunAlt + 18) / 14)) * (1 - day * 0.8);
    // stars fade through twilight and vanish in daylight
    this.engine.skyDim = Math.max(0.0, 1 - Math.min(1, Math.max(0, (this.sunAlt + 12) / 9)));
    const earth = this.solar.byId.get('earth')!;
    const camUp = _v.copy(_up);
    this.ground.visible = this.dome.visible = true;
    // ground: a disc 20 m below the eye; dome: centred on the eye
    this.ground.position.set(0, 0, 0).addScaledVector(camUp, -0.02);
    this.ground.quaternion.copy(this.frame).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
    (this.ground.material as ShaderMaterial).uniforms.uDay.value = day;
    this.dome.position.set(0, 0, 0);
    this.dome.scale.setScalar(50);
    const du = (this.dome.material as ShaderMaterial).uniforms;
    du.uUp.value.copy(_up); du.uDay.value = day; du.uTwilight.value = twilight;
    du.uSun.value.subVectors(this.solar.sun.entity.local, earth.entity.local).normalize();
    void ctx;
  }

  labels(ctx: FrameContext, add: AddLabel): void {
    if (!this.active) return;
    const p = { x: 0, y: 0 };
    const pts: [string, number][] = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    for (const [name, az] of pts) {
      const a = az * DEG;
      _v.copy(_north).multiplyScalar(Math.cos(a)).addScaledVector(_east, Math.sin(a)).addScaledVector(_up, 0.012).multiplyScalar(1e3);
      if (ctx.project(_v, p, false)) add({ x: p.x, y: p.y, text: name, priority: name.length === 1 ? 2000 : 1500, color: '#ffd9a0', kind: 'region', offset: 0, key: 'compass' + name });
    }
  }

  /** Human description of the sky state. */
  describe(): string {
    const a = this.sunAlt;
    const state = a > 0 ? 'daylight' : a > -6 ? 'civil twilight' : a > -12 ? 'nautical twilight' : a > -18 ? 'astronomical twilight' : 'night';
    return `Sun ${a >= 0 ? '+' : '−'}${Math.abs(a).toFixed(1)}° · ${state}`;
  }
}
