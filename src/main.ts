import { Engine } from './engine/engine';
import { pickQuality } from './engine/quality';
import { SolarSystem } from './scene/solar';
import { StarField } from './scene/stars';
import { dateToJd } from './core/constants';

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;background:#000';
  document.body.style.margin = '0';
  const engine = new Engine(canvas, pickQuality());
  const j = (u: string) => fetch(u).then((r) => r.json());
  const b = (u: string) => fetch(u).then((r) => r.arrayBuffer());
  const [starBin, starMeta, hip, exo, cons, sbBin, sbMeta] = await Promise.all([
    b('./data/stars.bin'), j('./data/stars_meta.json'), b('./data/stars_hip.bin'), j('./data/exoplanets.json'), j('./data/constellations.json'),
    b('./data/smallbodies.bin'), j('./data/smallbodies.json'),
  ]);
  const solar = new SolarSystem(engine, sbMeta);
  solar.setSmallBodies(new Float32Array(sbBin), sbMeta);
  const stars = new StarField(engine, new Float32Array(starBin), starMeta, new Uint32Array(hip), exo, cons);
  stars.sunEntity = solar.sun.entity;
  engine.systems.push(solar, stars);
  const params = new URLSearchParams(location.search);
  const jd = params.get('jd') ? parseFloat(params.get('jd')!) : dateToJd(new Date());
  solar.simulate(jd);
  const focus = solar.byId.get(params.get('focus') ?? 'earth')!;
  engine.rig.setFocus(focus.entity, params.get('dist') ? parseFloat(params.get('dist')!) : focus.entity.viewDist);
  if (params.get('yaw')) engine.rig.yaw = parseFloat(params.get('yaw')!);
  if (params.get('pitch')) engine.rig.pitch = parseFloat(params.get('pitch')!);
  (window as any).ue = { engine, solar, stars };
  let last = performance.now();
  const t0 = last;
  let frames = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    engine.frame(jd, (now - t0) / 1000, dt);
    frames++;
    (window as any).ueFrames = frames;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot().catch((e) => { console.error(e); (window as any).ueError = String(e?.stack ?? e); });
