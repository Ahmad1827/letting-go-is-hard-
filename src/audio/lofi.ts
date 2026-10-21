/**
 * Endless lo-fi office music, generated live with Web Audio: jazzy electric
 * piano chords, a soft bassline, lazy swung drums and vinyl crackle, all run
 * through a warm low-pass. No audio files, nothing to license.
 */

const BPM = 74;
const BEAT = 60 / BPM;
const SIXTEENTH = BEAT / 4;
const SWING = 0.2; // how late the off-beat sixteenths land, as a fraction of a sixteenth

/** Chord progressions as MIDI note voicings; each chord lasts one bar. */
const PROGRESSIONS: number[][][] = [
  // Fmaj9  Em7  Dm9  Cmaj9
  [[53, 57, 60, 64, 67], [52, 55, 59, 62, 66], [50, 53, 57, 60, 64], [48, 52, 55, 59, 62]],
  // Dm9  G13  Cmaj9  A7(b9)
  [[50, 53, 57, 60, 64], [43, 53, 57, 59, 64], [48, 52, 55, 59, 62], [45, 55, 58, 61, 64]],
  // Ebmaj9  Dm7  Gm9  C9
  [[51, 55, 58, 62, 65], [50, 53, 57, 60, 64], [43, 50, 53, 57, 58], [48, 52, 55, 58, 62]],
];
const PENTATONIC = [72, 74, 76, 79, 81, 84];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Lofi {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private crackle: AudioBufferSourceNode | null = null;
  private timer: number | undefined;
  private step = 0;
  private next = 0;
  private bar = 0;
  private progression = PROGRESSIONS[0];
  private volume = 0.5;
  private watchdog: number | undefined;
  private lastClock = 0;
  private stalledFor = 0;
  playing = false;
  /** Called when the sound device stops taking audio, so the UI can say so. */
  onStall: (() => void) | null = null;

  start() {
    if (this.playing) return;
    if (!this.ctx) this.build();
    void this.ctx!.resume();
    this.playing = true;
    this.next = this.ctx!.currentTime + 0.1;
    this.out.gain.setTargetAtTime(this.volume * 0.8, this.ctx!.currentTime, 0.8);
    this.startCrackle();
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.lastClock = this.ctx!.currentTime;
    this.stalledFor = 0;
    this.watchdog = window.setInterval(() => this.checkClock(), 1000);
  }

  /**
   * Some audio setups (WSL's audio bridge to Windows, a sleeping Bluetooth headset)
   * stop taking sound, which freezes the audio clock and the music with it. Stop
   * cleanly and say so; retrying against a hung sound server could freeze the app.
   */
  private checkClock() {
    const ctx = this.ctx;
    if (!ctx || !this.playing || ctx.state !== 'running') return;
    this.stalledFor = ctx.currentTime > this.lastClock + 0.05 ? 0 : this.stalledFor + 1;
    this.lastClock = ctx.currentTime;
    if (this.stalledFor < 3) return;
    this.stop();
    void ctx.close();
    this.ctx = null;
    this.onStall?.();
  }

  stop() {
    if (!this.playing || !this.ctx) return;
    this.playing = false;
    window.clearInterval(this.timer);
    window.clearInterval(this.watchdog);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    this.crackle?.stop(this.ctx.currentTime + 1.5);
    this.crackle = null;
  }

  /** Browsers keep audio suspended until the first click or key press. */
  resume() {
    if (this.playing) void this.ctx?.resume();
  }

    setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.playing) this.out.gain.setTargetAtTime(v * 0.8, this.ctx.currentTime, 0.1);
  }

  private build() {
    const ctx = (this.ctx = new AudioContext());
    // the warm, slightly muffled lo-fi sound comes from this filter
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    tone.Q.value = 0.4;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(tone).connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Schedule everything due in the next 120ms (the usual Web Audio lookahead pattern). */
  private schedule() {
    const ctx = this.ctx!;
    while (this.next < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const t = this.next + (s % 2 ? SWING * SIXTEENTH : 0);
      this.playStep(s, t);
      this.next += SIXTEENTH;
      this.step++;
      if (this.step % 16 === 0) {
        this.bar++;
        if (this.bar % 8 === 0) this.progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
      }
    }
  }

  private playStep(s: number, t: number) {
    const chord = this.progression[this.bar % 4];
    const r = Math.random;
    // keys: on the one, sometimes a push on the "and" of two
    if (s === 0) this.chord(chord, t, 0.9);
    if (s === 6 && r() < 0.45) this.chord(chord.slice(1), t, 0.5);
    // bass: root on one, fifth or octave walking in
    if (s === 0) this.bass(chord[0] - 12, t, BEAT * 1.8);
    if (s === 10 && r() < 0.7) this.bass(chord[0] - 12 + (r() < 0.5 ? 7 : 12), t, BEAT * 0.9);
    if (s === 14 && r() < 0.3) this.bass(chord[0] - 12 + 10, t, BEAT * 0.4);
    // drums: lazy boom-bap
    if (s === 0 || (s === 10 && r() < 0.8) || (s === 7 && r() < 0.2)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t, 1);
    if ((s === 15 || s === 3) && r() < 0.15) this.snare(t, 0.25);
    if (s % 2 === 0) this.hat(t, s % 4 === 0 ? 0.5 : 0.3);
    else if (r() < 0.25) this.hat(t, 0.15);
    // now and then a few soft notes on top
    if ((s === 2 || s === 8 || s === 11) && r() < 0.18) this.bell(PENTATONIC[Math.floor(r() * PENTATONIC.length)], t);
  }

  private chord(notes: number[], t: number, vel: number) {
    notes.forEach((n, i) => this.epiano(n, t + i * 0.012 + Math.random() * 0.01, BEAT * 3.5, vel * (0.75 + Math.random() * 0.25)));
  }

  /** Electric piano: a sine with a little FM bell on the attack, and tape wobble. */
  private epiano(midi: number, t: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const f = hz(midi);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const amp = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 2;
    modGain.gain.setValueAtTime(f * 1.4, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
    mod.connect(modGain).connect(car.frequency);
    // wow & flutter
    const wow = ctx.createOscillator();
    const wowGain = ctx.createGain();
    wow.frequency.value = 0.6;
    wowGain.gain.value = 6;
    wow.connect(wowGain).connect(car.detune);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.07 * vel, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.025 * vel, t + 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(amp).connect(this.out);
    for (const o of [car, mod, wow]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private bass(midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = hz(midi);
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.15, t + dur * 0.5);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(amp).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const amp = ctx.createGain();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    amp.gain.setValueAtTime(0.55, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(amp).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number, vel: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.8;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.22 * vel, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp).connect(amp).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.22);
    const body = ctx.createOscillator();
    const bodyAmp = ctx.createGain();
    body.frequency.value = 185;
    bodyAmp.gain.setValueAtTime(0.12 * vel, t);
    bodyAmp.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    body.connect(bodyAmp).connect(this.out);
    body.start(t);
    body.stop(t + 0.1);
  }

  private hat(t: number, vel: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.06 * vel, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp).connect(amp).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.06);
  }

  private bell(midi: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const amp = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = hz(midi);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(amp).connect(this.out);
    o.start(t);
    o.stop(t + 1.5);
  }

  /** Dusty vinyl: quiet hiss plus random pops, looping under everything. */
  private startCrackle() {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 0.0004) d[i] += (Math.random() * 2 - 1) * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    src.connect(lp).connect(this.out);
    src.start();
    this.crackle = src;
  }
}
