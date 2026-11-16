// Generative ambience: a slow drone whose pitch falls as the view widens, plus filtered noise
// that rises with flight speed.  Nothing is sampled; everything is synthesised with Web Audio.

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private oscs: OscillatorNode[] = [];
  private filter!: BiquadFilterNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  on = false;

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async start(): Promise<boolean> {
    try {
      if (!this.ctx) this.build();
      await this.ctx!.resume();
      this.master.gain.setTargetAtTime(0.16, this.ctx!.currentTime, 1.2);
      this.on = true;
      return true;
    } catch {
      this.on = false;
      return false;
    }
  }

  stop(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    this.on = false;
  }

  private build(): void {
    const AC: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 500; this.filter.Q.value = 0.7;
    this.filter.connect(this.master);
    // drone: root, fifth and a slightly detuned octave, each breathing at its own rate
    [[1, 0.5, 0.07], [1.498, 0.28, 0.11], [2.006, 0.2, 0.05], [0.5, 0.35, 0.03]].forEach(([ratio, level, rate], i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = 80 * ratio;
      (o as any)._ratio = ratio;
      const g = ctx.createGain(); g.gain.value = level;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
      const lg = ctx.createGain(); lg.gain.value = level * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.filter);
      o.start(); lfo.start();
      this.oscs.push(o);
    });
    // wind: looped white noise through a band-pass
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 400; this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain(); this.wind.gain.value = 0.02;
    src.connect(this.windFilter).connect(this.wind).connect(this.master);
    src.start();
  }

  /** @param logKm log10 of the view distance in km; @param motion 0..1 (flight thrust or relativistic speed) */
  update(logKm: number, motion: number): void {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    // 110 Hz above a planet, falling about an octave per twelve powers of ten
    const base = 110 * Math.pow(2, -(Math.max(3.5, Math.min(24.5, logKm)) - 4) / 12);
    for (const o of this.oscs) o.frequency.setTargetAtTime(base * (o as any)._ratio, t, 0.8);
    this.filter.frequency.setTargetAtTime(380 + 900 * motion, t, 0.5);
    this.wind.gain.setTargetAtTime(0.015 + 0.16 * motion, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + 2200 * motion, t, 0.3);
  }
}
