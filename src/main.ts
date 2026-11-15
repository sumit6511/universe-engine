import './style.css';
import { App } from './app';
import { pickQuality } from './engine/quality';
import { UI } from './ui/ui';

const $ = (id: string) => document.getElementById(id)!;

async function boot(): Promise<void> {
  const canvas = $('view') as HTMLCanvasElement;
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('This browser does not support WebGL 2, which Universe Engine needs.');
  const app = new App(canvas, pickQuality());
  await app.load((f, msg) => {
    $('loading-fill').style.width = `${Math.round(f * 100)}%`;
    $('loading-text').textContent = msg;
  });
  const ui = new UI(app);
  (window as any).ue = { app, ui };

  // optional modules: loaded after first paint so the universe appears quickly
  import('./scene/blackhole').then((m) => m.installBlackHoles(app)).catch((e) => console.warn('Black-hole module failed to load', e));
  import('./lab/nbody').then((m) => m.installLab(app, ui)).catch((e) => console.warn('Gravity lab failed to load', e));

  // deep links: #saturn, #m31 ...
  const fromHash = () => {
    const name = decodeURIComponent(location.hash.slice(1)).replace(/-/g, ' ');
    const e = name ? app.find(name) : null;
    if (e) app.goTo(e);
  };
  window.addEventListener('hashchange', fromHash);
  const q = new URLSearchParams(location.search);
  if (q.get('jd')) app.clock.jd = parseFloat(q.get('jd')!);
  if (q.get('pause')) app.clock.paused = true;

  let last = performance.now();
  let frames = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    app.frame(dt);
    if (!app.engine.override) ui.update(app.engine.ctx, dt);
    (window as any).ueFrames = ++frames;
    if (frames === 2) { $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 1200); fromHash(); app.select(app.engine.rig.focus); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  (window as any).ueError = String(e?.stack ?? e);
  const t = $('loading-text');
  t.classList.add('err');
  t.textContent = e?.message ?? 'Something went wrong while starting.';
});
