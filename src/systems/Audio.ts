import { Storage } from './Storage';

const _ = null;

/**
 * Fully procedural WebAudio, arcade-fighter edition: every SFX is a layered
 * oscillator/noise envelope — heavy hits run through a waveshaper drive bus —
 * and the music is an original CPS-arcade style fight theme (funk slap bass,
 * FM-flavoured brass stabs, vibrato lead) scheduled on a 16th-note grid.
 * No audio assets. The chain runs through a compressor for glue, with a
 * feedback delay bus for space.
 */
export class AudioSys {
  muted = Storage.getMuted();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private delayBus!: GainNode;
  private driveBus!: GainNode;
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
      delay.delayTime.value = 0.28125; // dotted-8th @ 160 BPM
      const fbFilter = this.ctx.createBiquadFilter();
      fbFilter.type = 'lowpass';
      fbFilter.frequency.value = 2400;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.2;
      this.delayBus.connect(delay);
      delay.connect(fbFilter);
      fbFilter.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(this.master);

      // waveshaper drive bus — explosions and heavy shots grind through this
      this.driveBus = this.ctx.createGain();
      this.driveBus.gain.value = 0.7;
      const shaper = this.ctx.createWaveShaper();
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) curve[i] = Math.tanh((i / 128 - 1) * 3.5);
      shaper.curve = curve;
      const driveLp = this.ctx.createBiquadFilter();
      driveLp.type = 'lowpass';
      driveLp.frequency.value = 2400;
      const driveOut = this.ctx.createGain();
      driveOut.gain.value = 0.45;
      this.driveBus.connect(shaper);
      shaper.connect(driveLp);
      driveLp.connect(driveOut);
      driveOut.connect(this.sfxGain);

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

  /** Sub-bass detonation: a falling sine sent to both the clean and drive buses. */
  private boom(f0: number, f1: number, dur: number, vol: number, at?: number): void {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(16, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxGain);
    g.connect(this.driveBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** FM-brass style stab: detuned saw pairs per chord tone behind a fast filter blip. */
  private brass(freqs: number[], dur: number, vol: number, at: number, dest?: GainNode): void {
    if (!this.ctx) return;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 1;
    flt.frequency.setValueAtTime(500, at);
    flt.frequency.exponentialRampToValueAtTime(3800, at + 0.03);
    flt.frequency.exponentialRampToValueAtTime(900, at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const fq of freqs) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fq;
        o.detune.value = det;
        o.connect(flt);
        o.start(at);
        o.stop(at + dur + 0.05);
      }
    }
    flt.connect(g);
    g.connect(dest ?? this.musicGain);
  }

  /** Slap-funk bass pluck: saw+square through a snapping filter, with a thumb click. */
  private slap(freq: number, dur: number, vol: number, at: number): void {
    if (!this.ctx) return;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 5;
    flt.frequency.setValueAtTime(1600, at);
    flt.frequency.exponentialRampToValueAtTime(160, at + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const type of ['sawtooth', 'square'] as OscillatorType[]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(flt);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
    flt.connect(g);
    g.connect(this.musicGain);
    this.musicNoise(0.012, 0.09, 4000, 'highpass', at);
  }

  /** Vibrato lead voice: detuned square+saw pair with a delayed-onset LFO. */
  private lead(f: number, dur: number, vol: number, at: number): void {
    if (!this.ctx) return;
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = this.ctx.createGain();
    vibGain.gain.setValueAtTime(0, at);
    vibGain.gain.linearRampToValueAtTime(f * 0.012, at + Math.min(0.18, dur * 0.7));
    vib.connect(vibGain);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.setValueAtTime(vol, at + Math.max(0.02, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const [type, det] of [['square', -5], ['sawtooth', 6]] as [OscillatorType, number][]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      vibGain.connect(o.frequency);
      o.connect(g);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
    g.connect(this.musicGain);
    g.connect(this.delayBus);
    vib.start(at);
    vib.stop(at + dur + 0.05);
  }

  /** Soft string pad bed under each bar. */
  private pad(freqs: number[], dur: number, vol: number, at: number): void {
    if (!this.ctx) return;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 750;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.08);
    g.gain.setValueAtTime(vol, at + dur - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const fq of freqs) {
      for (const det of [-9, 9]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fq;
        o.detune.value = det;
        o.connect(flt);
        o.start(at);
        o.stop(at + dur + 0.05);
      }
    }
    flt.connect(g);
    g.connect(this.musicGain);
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
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rt = 0.96 + Math.random() * 0.08; // detune so streams don't sound robotic
    switch (weapon) {
      case 'plasma':
        this.tone('sawtooth', 300 * rt, 48, 0.2, 0.2, t, this.driveBus);
        this.tone('sawtooth', 306 * rt, 52, 0.2, 0.14, t);
        this.boom(130, 50, 0.14, 0.3, t);
        break;
      case 'rockets':
        this.noise(0.3, 0.28, 1100, 'lowpass', t, 260);
        this.tone('sawtooth', 150 * rt, 34, 0.24, 0.16, t, this.driveBus);
        this.noise(0.05, 0.12, 3800, 'highpass', t);
        break;
      case 'chain':
        this.tone('square', 2500 * rt, 240, 0.06, 0.12, t, undefined, true);
        this.noise(0.04, 0.12, 5000, 'highpass', t);
        break;
      case 'charge':
        this.tone('sawtooth', 84, 600 * rt, 0.16, 0.24, t, this.driveBus);
        this.boom(90, 38, 0.22, 0.4, t);
        break;
      case 'rapid':
        this.tone('square', 1300 * rt, 520, 0.04, 0.08, t);
        break;
      default:
        this.tone('square', 1100 * rt, 190, 0.09, 0.13, t);
        this.tone('sawtooth', 2300 * rt, 460, 0.05, 0.06, t);
        this.boom(180, 70, 0.07, 0.18, t);
    }
  }

  hit(): void {
    this.tone('triangle', 560, 160, 0.05, 0.11);
    this.tone('square', 1100, 500, 0.03, 0.05);
    this.noise(0.03, 0.06, 4000, 'highpass');
  }

  explosion(size: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.boom(120 - size * 18, 24 - size * 3, 0.5 + size * 0.3, 0.65 + size * 0.15, t);
    this.noise(0.45 + size * 0.35, 0.5 + size * 0.22, 1600, 'lowpass', t, 160 - size * 30);
    this.noise(0.1, 0.22, 3400, 'highpass', t);
    this.tone('sawtooth', 220 - size * 40, 30, 0.4 + size * 0.2, 0.22, t, this.driveBus);
    if (size >= 1) {
      // metallic ring tail
      this.tone('triangle', 500, 90, 0.6, 0.1, t);
      this.tone('triangle', 509, 95, 0.6, 0.08, t);
    }
    if (size >= 2) {
      // second delayed detonation
      this.boom(80, 18, 1.5, 0.7, t + 0.14);
      this.noise(1.5, 0.35, 500, 'lowpass', t + 0.14, 70);
    }
  }

  playerHit(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone('sawtooth', 420, 50, 0.45, 0.3, t, this.driveBus);
    this.boom(95, 26, 0.5, 0.6, t);
    this.noise(0.35, 0.35, 1000, 'lowpass', t, 160);
    this.tone('square', 988, 932, 0.18, 0.07, t, undefined, true);
  }

  shieldBreak(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [1976, 1568, 1319].forEach((f, i) => this.tone('triangle', f, f * 0.5, 0.22, 0.12, t + i * 0.03, undefined, true));
    this.noise(0.22, 0.25, 2600, 'highpass', t);
    this.boom(140, 50, 0.25, 0.3, t);
  }

  powerup(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // heroic two-octave major arpeggio echoing down the delay
    [0, 4, 7, 12, 16, 19].forEach((s, i) => {
      const f = 660 * Math.pow(2, s / 12);
      this.tone('square', f, f, 0.09, 0.09, t + i * 0.045, undefined, true);
    });
    this.noise(0.25, 0.1, 6000, 'highpass', t + 0.27);
  }

  bomb(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(0.14, 0.25, 1200, 'highpass', t, 7000); // pre-flash riser
    const b = t + 0.1;
    this.boom(110, 16, 1.6, 1.0, b);
    this.tone('sawtooth', 240, 24, 1.0, 0.35, b, this.driveBus);
    this.noise(1.4, 0.7, 900, 'lowpass', b, 60);
    this.noise(0.5, 0.25, 5000, 'highpass', b);
    this.boom(70, 15, 1.2, 0.6, b + 0.5); // aftershock
    this.tone('triangle', 600, 70, 0.9, 0.1, b, undefined, true);
  }

  dash(): void {
    this.noise(0.22, 0.3, 800, 'highpass', undefined, 7000);
    this.tone('sine', 300, 1200, 0.16, 0.1, undefined, undefined, true);
  }

  zap(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone('square', 2400, 160, 0.09, 0.15, t, undefined, true);
    this.tone('sawtooth', 1200, 90, 0.07, 0.1, t);
    this.noise(0.07, 0.15, 5500, 'highpass', t);
  }

  bossWarning(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // three klaxon blasts: minor-second brass cluster over a sub pulse
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.55;
      this.brass([98, 196, 207.65], 0.4, 0.3, ti, this.sfxGain);
      this.boom(75, 40, 0.45, 0.5, ti);
      this.tone('sawtooth', 392, 415, 0.4, 0.1, ti, undefined, true);
    }
  }

  waveClear(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // stage-clear brass fanfare climbing to a held A-major chord
    this.brass([440, 554.37], 0.12, 0.16, t, this.sfxGain);
    this.brass([554.37, 659.25], 0.12, 0.16, t + 0.13, this.sfxGain);
    this.brass([659.25, 880], 0.12, 0.16, t + 0.26, this.sfxGain);
    this.brass([880, 1108.73, 1318.51], 0.55, 0.2, t + 0.42, this.sfxGain);
    [1760, 2217].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.08, t + 0.42 + i * 0.09, undefined, true));
  }

  gameOver(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // solemn brass descent into a dissonant low hold and final impact
    [440, 392, 349.23, 329.63].forEach((f, i) => this.brass([f, f / 2], 0.34, 0.2, t + i * 0.3, this.sfxGain));
    this.brass([110, 116.54], 1.4, 0.22, t + 1.25, this.sfxGain);
    this.boom(85, 20, 1.8, 0.8, t + 1.25);
    this.noise(1.8, 0.3, 420, 'lowpass', t + 1.25, 60);
  }

  select(): void {
    this.tone('square', 660, 990, 0.06, 0.1, undefined, undefined, true);
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
    const stepDur = 60 / 160 / 4; // 16th notes @ 160 BPM
    while (this.nextNote < this.ctx.currentTime + 0.14) {
      this.scheduleStep(this.step, this.nextNote, stepDur);
      this.nextNote += stepDur;
      this.step = (this.step + 1) % 128;
    }
  }

  // An original fight-theme vamp in A mixolydian: A — A — G — D | A — A — G — E
  private static ROOTS = [55, 55, 49, 73.42, 55, 55, 49, 82.41];
  private static CHORD = [0, 4, 7]; // all-major triads, stabbed two octaves up
  // slap bass line: root drive with octave pops and a fifth pickup
  private static BASS_PAT: (number | null)[] = [0, _, _, 12, _, _, 0, _, 0, _, 12, _, 7, _, 0, _];
  // 8-bar lead melody (semitones above A4): rising A-phrase, higher B-phrase,
  // E–F#–G# walk-up in bar 8 resolving back to the top of the loop
  private static MELODY: (number | null)[] = [
    12, _, _, _, 7, _, _, _, 9, _, 10, _, 9, _, 7, _,      // bar 1 (A)
    5, _, _, _, 4, _, 2, _, 0, _, _, _, _, _, _, _,        // bar 2 (A)
    10, _, _, _, 10, _, 12, _, 14, _, _, _, 12, _, 10, _,  // bar 3 (G)
    9, _, _, _, 5, _, 9, _, 12, _, _, _, _, _, _, _,       // bar 4 (D)
    12, _, _, _, 16, _, _, _, 14, _, 12, _, 14, _, _, _,   // bar 5 (A)
    16, _, _, _, 17, _, 16, _, 14, _, 12, _, _, _, _, _,   // bar 6 (A)
    14, _, _, _, 12, _, 10, _, 12, _, _, _, 14, _, _, _,   // bar 7 (G)
    16, _, _, _, 14, _, 12, _, 7, _, 9, _, 11, _, _, _,    // bar 8 (E)
  ];

  private scheduleStep(step: number, t: number, stepDur: number): void {
    if (!this.ctx) return;
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const root = AudioSys.ROOTS[bar];

    // crash cymbal at the top of the loop
    if (step === 0) this.musicNoise(0.9, 0.2, 4500, 'highpass', t);

    // kick: driving funk pattern with a click transient
    if (beat === 0 || beat === 3 || beat === 8 || beat === 10) {
      this.tone('sine', 150, 38, 0.15, 0.85, t, this.musicGain);
      this.musicNoise(0.02, 0.14, 3200, 'highpass', t);
    }
    // snare on 2 & 4, ghost push into the next bar, tom-roll fill through bar 8
    const fill = bar === 7 && beat >= 12;
    if (beat === 4 || beat === 12 || fill) {
      const v = fill ? 0.22 + (beat - 12) * 0.05 : 0.42;
      this.musicNoise(0.12, v, 1900, 'bandpass', t);
      this.tone('triangle', fill ? 260 - (beat - 12) * 35 : 200, 110, 0.09, 0.2, t, this.musicGain);
    } else if (beat === 15) {
      this.musicNoise(0.07, 0.12, 1900, 'bandpass', t);
    }
    // 16th hats, open on the "and" of 4
    this.musicNoise(beat === 14 ? 0.16 : 0.03, beat % 4 === 0 ? 0.07 : 0.045, 8200, 'highpass', t);

    // slap-funk bass
    const bs = AudioSys.BASS_PAT[beat];
    if (bs !== null) this.slap(root * Math.pow(2, bs / 12), 0.14, 0.3, t);

    // syncopated brass stabs: 1, the "and" of 2, and an accented "3-and"
    if (beat === 0 || beat === 6) this.brass(AudioSys.CHORD.map(s => root * 4 * Math.pow(2, s / 12)), 0.14, 0.12, t);
    if (beat === 10) this.brass(AudioSys.CHORD.map(s => root * 4 * Math.pow(2, s / 12)), 0.3, 0.14, t);

    // string pad bed under each bar
    if (beat === 0) this.pad(AudioSys.CHORD.map(s => root * 2 * Math.pow(2, s / 12)), stepDur * 16, 0.05, t);

    // vibrato lead — notes hold legato through the rests that follow them
    const semi = AudioSys.MELODY[step];
    if (semi !== null) {
      let hold = 1;
      while (hold < 6 && AudioSys.MELODY[(step + hold) % 128] === null) hold++;
      this.lead(440 * Math.pow(2, semi / 12), Math.min(hold, 5) * stepDur * 0.95, 0.055, t);
    }
  }
}
