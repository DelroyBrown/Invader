import { Storage } from './Storage';

/**
 * Fully procedural WebAudio: every SFX is a layered oscillator/noise envelope
 * and the music is a scheduled synth track — no audio assets. The chain runs
 * through a compressor for glue, with a feedback delay bus for space.
 */
export class AudioSys {
  muted = Storage.getMuted();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private delayBus!: GainNode;
  private noiseBuf: AudioBuffer | null = null;

  private musicOn = false;
  private nextNote = 0;
  private step = 0;

  /** Must be called from a user gesture before any sound will play. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.24;
      comp.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(comp);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.5;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.master);

      // feedback delay bus for leads / powerups / zaps
      this.delayBus = this.ctx.createGain();
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = 0.272; // dotted-8th @ 132 BPM
      const fbFilter = this.ctx.createBiquadFilter();
      fbFilter.type = 'lowpass';
      fbFilter.frequency.value = 2400;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.34;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.22;
      this.delayBus.connect(delay);
      delay.connect(fbFilter);
      fbFilter.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(this.master);

      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    Storage.setMuted(this.muted);
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.85;
    return this.muted;
  }

  // ---- synth primitives -------------------------------------------------

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, vol: number,
    at?: number, dest?: GainNode, send = false,
  ): void {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest ?? this.sfxGain);
    if (send && this.delayBus) g.connect(this.delayBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number, vol: number, freq = 1000,
    filterType: BiquadFilterType = 'lowpass', at?: number, freqEnd?: number,
  ): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = at ?? this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Filtered saw bass note routed to the music bus. */
  private bassNote(freq: number, dur: number, vol: number, at: number): void {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, at);
    f.frequency.exponentialRampToValueAtTime(220, at + dur);
    f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private musicNoise(dur: number, vol: number, freq: number, type: BiquadFilterType, at: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    src.start(at);
    src.stop(at + dur + 0.05);
  }

  // ---- sound effects ----------------------------------------------------

  shoot(weapon: string): void {
    const rt = 0.96 + Math.random() * 0.08; // detune so streams don't sound robotic
    switch (weapon) {
      case 'plasma':
        this.tone('sawtooth', 340 * rt, 62, 0.16, 0.2);
        this.tone('sine', 130, 60, 0.12, 0.12);
        break;
      case 'rockets':
        this.noise(0.22, 0.22, 1300, 'lowpass', undefined, 320);
        this.tone('square', 175 * rt, 42, 0.16, 0.12);
        break;
      case 'chain':
        this.tone('square', 2000 * rt, 190, 0.07, 0.11, undefined, undefined, true);
        this.noise(0.05, 0.1, 4200, 'highpass');
        break;
      case 'charge':
        this.tone('sawtooth', 92, 520 * rt, 0.18, 0.22);
        this.tone('sine', 58, 46, 0.18, 0.16);
        break;
      case 'rapid':
        this.tone('square', 1150 * rt, 480, 0.045, 0.075);
        break;
      default:
        this.tone('square', 890 * rt, 275, 0.09, 0.12);
        this.tone('sine', 1650 * rt, 850, 0.03, 0.06);
    }
  }

  hit(): void {
    this.tone('triangle', 490, 175, 0.045, 0.09);
    this.noise(0.03, 0.05, 3200, 'highpass');
  }

  explosion(size: number): void {
    this.noise(0.4 + size * 0.28, 0.45 + size * 0.2, 1800, 'lowpass', undefined, 220 - size * 40);
    this.tone('sine', 130 - size * 22, 26, 0.38 + size * 0.22, 0.6);
    if (size >= 1) {
      // metallic ring tail
      this.tone('triangle', 420, 88, 0.5, 0.1);
      this.tone('triangle', 427, 92, 0.5, 0.08);
      this.tone('sawtooth', 210, 36, 0.32, 0.14);
    }
    if (size >= 2) this.noise(1.1, 0.3, 600, 'lowpass', undefined, 100);
  }

  playerHit(): void {
    this.tone('sawtooth', 330, 48, 0.34, 0.3);
    this.tone('sine', 72, 30, 0.3, 0.4);
    this.noise(0.28, 0.3, 900, 'lowpass', undefined, 200);
  }

  shieldBreak(): void {
    this.tone('triangle', 920, 190, 0.26, 0.2, undefined, undefined, true);
    this.noise(0.16, 0.15, 3000, 'highpass');
  }

  powerup(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semis = [0, 3, 5, 10, 12];
    semis.forEach((s, i) => {
      const f = 660 * Math.pow(2, s / 12);
      this.tone('triangle', f, f, 0.11, 0.12, t + i * 0.055, undefined, true);
    });
  }

  bomb(): void {
    this.tone('sine', 95, 21, 1.0, 0.8);
    this.noise(0.9, 0.55, 750, 'lowpass', undefined, 110);
    this.tone('sawtooth', 250, 26, 0.6, 0.2);
    this.tone('triangle', 500, 60, 0.7, 0.1, undefined, undefined, true);
  }

  dash(): void {
    this.noise(0.18, 0.26, 1100, 'highpass', undefined, 5600);
    this.tone('sine', 480, 940, 0.13, 0.08);
  }

  zap(): void {
    this.tone('square', 1900, 210, 0.08, 0.14, undefined, undefined, true);
    this.noise(0.06, 0.12, 5000, 'highpass');
  }

  bossWarning(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone('sawtooth', 210, 225, 0.3, 0.22, t + i * 0.6);
      this.tone('sawtooth', 105, 112, 0.3, 0.18, t + i * 0.6);
      this.tone('sawtooth', 440, 452, 0.3, 0.15, t + i * 0.6 + 0.3);
    }
  }

  waveClear(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone('triangle', f, f, 0.15, 0.14, t + i * 0.085, undefined, true));
  }

  gameOver(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [440, 349, 262, 196, 131];
    notes.forEach((f, i) => this.tone('sawtooth', f, f * 0.96, 0.45, 0.18, t + i * 0.24, undefined, true));
    this.noise(1.4, 0.25, 500, 'lowpass', undefined, 80);
  }

  select(): void {
    this.tone('square', 520, 780, 0.07, 0.1, undefined, undefined, true);
  }

  // ---- music ------------------------------------------------------------

  startMusic(): void {
    if (!this.ctx) return;
    this.musicOn = true;
    this.nextNote = this.ctx.currentTime + 0.06;
    this.step = 0;
  }

  stopMusic(): void {
    this.musicOn = false;
  }

  /** Lookahead scheduler — call every frame. */
  update(): void {
    if (!this.ctx || !this.musicOn || this.muted) return;
    const stepDur = 60 / 132 / 4; // 16th notes @ 132 BPM
    while (this.nextNote < this.ctx.currentTime + 0.14) {
      this.scheduleStep(this.step, this.nextNote);
      this.nextNote += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  // Am — F — C — G, 4 bars of 16th steps
  private static ROOTS = [55, 43.65, 65.41, 49.0];
  private static CHORDS: number[][] = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
  // two-bar lead phrase in A minor (semitones above A4), played on 8ths
  private static LEAD: (number | null)[] = [
    12, null, 15, null, 12, null, 10, null, 7, null, 10, null, 12, null, 10, null,
    5, null, 7, null, 10, null, 7, null, 3, null, 5, null, 7, null, 3, null,
  ];

  private scheduleStep(step: number, t: number): void {
    if (!this.ctx) return;
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    const root = AudioSys.ROOTS[bar];

    // kick on quarters with a click transient
    if (beat % 4 === 0) {
      this.tone('sine', 158, 42, 0.13, 0.8, t, this.musicGain);
      this.musicNoise(0.02, 0.12, 3500, 'highpass', t);
    }
    // snare backbeat
    if (beat === 4 || beat === 12) {
      this.musicNoise(0.13, 0.4, 1900, 'bandpass', t);
      this.tone('triangle', 195, 120, 0.08, 0.18, t, this.musicGain);
    }
    // hats on off-16ths, open hat at the bar's tail
    if (beat % 2 === 1) this.musicNoise(beat === 15 ? 0.12 : 0.035, beat % 4 === 3 ? 0.09 : 0.055, 7500, 'highpass', t);
    // driving octave bass on 8ths, low accents on the 1 and 3
    if (beat % 2 === 0) {
      const low = beat === 0 || beat === 8;
      this.bassNote(low ? root : root * 2, 0.14, low ? 0.26 : 0.2, t);
    }
    // chord stab at each bar start
    if (beat === 0) {
      for (const semi of AudioSys.CHORDS[bar]) {
        const f = root * 4 * Math.pow(2, semi / 12);
        this.tone('triangle', f, f * 0.995, 0.42, 0.05, t, this.musicGain, true);
      }
    }
    // lead phrase over bars 3-4, echoes through the delay
    if (bar >= 2) {
      const idx = (step - 32) % 32;
      const semi = AudioSys.LEAD[idx];
      if (semi !== null) {
        const f = 440 * Math.pow(2, semi / 12);
        this.tone('triangle', f, f * 0.99, 0.17, 0.1, t, this.musicGain, true);
      }
    }
  }
}
