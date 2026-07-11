import { Player, WEAPONS } from './entities/Player';
import { Enemy } from './entities/Enemy';
import type { Bullet } from './entities/Bullet';
import { PowerUp, POWERUP_INFO } from './entities/PowerUp';
import { Boss, type BossKind } from './entities/Boss';
import { Input } from './systems/Input';
import { AudioSys } from './systems/Audio';
import { Particles } from './systems/Particles';
import { WaveManager } from './systems/Waves';
import { Storage } from './systems/Storage';
import { handleCollisions } from './systems/Collision';
import { drawHUD } from './ui/HUD';
import { drawSoft } from './utils/gfx';
import { clamp, dist2, pick, rand } from './utils/math';

type GameState =
  | 'menu' | 'tutorial' | 'playing' | 'paused'
  | 'waveclear' | 'bossintro' | 'gameover';

interface Star { x: number; y: number; size: number; speed: number; color: string; tw: number }
interface Nebula { x: number; y: number; r: number; color: string; phase: number }
interface ShootingStar { x: number; y: number; vx: number; vy: number; t: number }
interface TextFx { x: number; y: number; str: string; color: string; t: number; max: number; size: number }
interface LightningFx { pts: { x: number; y: number }[]; t: number; max: number; color: string }

const FONT = 'Orbitron, "Segoe UI", monospace';
const BOSS_ORDER: BossKind[] = ['mothership', 'serpent', 'core'];

export default class Game {
  width = 0;
  height = 0;

  state: GameState = 'menu';
  input: Input;
  audio = new AudioSys();
  particles = new Particles();
  waves = new WaveManager();

  player: Player;
  enemies: Enemy[] = [];
  playerBullets: Bullet[] = [];
  enemyBullets: Bullet[] = [];
  powerups: PowerUp[] = [];
  boss: Boss | null = null;

  score = 0;
  dispScore = 0;
  scorePop = 0;
  highScore = Storage.getHighScore();
  wave = 0;
  combo = 0;
  comboTimer = 0;
  maxCombo = 0;
  kills = 0;
  waveDamageTaken = 0;

  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private last = 0;
  private t = 0;
  private runTime = 0;
  private waveStartTime = 0;
  private stateTimer = 0;
  private prevState: GameState = 'playing';
  private deathTimer = 0;
  private bossDying = 0;
  private bossFxT = 0;
  private cineSlow = 0;
  private shakeAmt = 0;
  private flashFx = { color: '#ffffff', t: 0, max: 0.2 };
  private banner = { title: '', sub: '', t: 0, max: 2 };
  private clearLines: string[] = [];
  private texts: TextFx[] = [];
  private lightnings: LightningFx[] = [];
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];
  private shootingStars: ShootingStar[] = [];
  private shootingStarT = 3;
  private vignette: HTMLCanvasElement | null = null;
  private bgGrad: CanvasGradient | null = null;
  private dashRequested = false;
  private newRecord = false;
  private menuGlowT = 0;
  private dropPity = 0;
  private supplyT = 18;
  btnFlashT: Record<string, number> = {};

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.input = new Input(canvas);
    this.player = new Player(0, 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // mobile browser chrome collapsing / expanding and rotation
    window.visualViewport?.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 80));

    // iOS requires AudioContext.resume() inside the gesture handler itself —
    // unlocking from the next animation frame is too late
    canvas.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());

    const autoPause = () => {
      if (this.state === 'playing' || this.state === 'waveclear' || this.state === 'bossintro') {
        this.prevState = this.state;
        this.state = 'paused';
      }
    };
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoPause();
    });
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ======================= update =======================

  private update(dtRaw: number): void {
    this.t += dtRaw;
    if (this.input.anyPressed()) this.audio.unlock();
    this.audio.update();

    this.cineSlow = Math.max(0, this.cineSlow - dtRaw);
    const cine = this.cineSlow > 0 ? 0.35 : 1;
    const pdt = dtRaw * cine;
    const wdt = pdt * (this.player.slowTime > 0 ? 0.45 : 1);

    this.scorePop = Math.max(0, this.scorePop - 4 * dtRaw);
    this.dispScore += (this.score - this.dispScore) * Math.min(1, 12 * dtRaw);
    if (Math.abs(this.score - this.dispScore) < 1) this.dispScore = this.score;
    this.shakeAmt = Math.max(0, this.shakeAmt - 60 * dtRaw * (0.3 + this.shakeAmt * 0.05));
    this.flashFx.t = Math.max(0, this.flashFx.t - dtRaw);
    for (const k in this.btnFlashT) {
      if (this.btnFlashT[k] > 0) this.btnFlashT[k] -= dtRaw;
    }
    this.banner.t = Math.max(0, this.banner.t - dtRaw);
    this.updateStars(pdt);

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i];
      tx.t -= pdt;
      tx.y -= 34 * pdt;
      if (tx.t <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      this.lightnings[i].t -= dtRaw;
      if (this.lightnings[i].t <= 0) this.lightnings.splice(i, 1);
    }

    switch (this.state) {
      case 'menu': this.updateMenu(dtRaw); break;
      case 'tutorial': this.updateTutorial(); break;
      case 'playing': this.updatePlaying(pdt, wdt); break;
      case 'waveclear': this.updateWaveClear(pdt, wdt); break;
      case 'bossintro': this.updateBossIntro(pdt); break;
      case 'paused': this.updatePaused(); break;
      case 'gameover': this.updateGameOver(pdt, wdt); break;
    }

    this.input.endFrame();
  }

  private updateMenu(dt: number): void {
    this.menuGlowT -= dt;
    if (this.menuGlowT <= 0) {
      this.menuGlowT = 0.35;
      this.particles.trail(
        rand(0, this.width), rand(this.height * 0.15, this.height),
        pick(['#7df9ff', '#ff2975', '#b967ff', '#39ff88']), rand(2, 5), rand(-8, 8), rand(-30, -12),
      );
    }
    this.particles.update(dt);

    if (this.input.wasPressed('mute')) this.audio.toggleMute();
    if (this.input.wasPressed('help')) {
      this.audio.select();
      this.state = 'tutorial';
      return;
    }
    const tapHelp = this.input.taps.some((p) => Math.abs(p.y - this.height * 0.76) < 26);
    if (tapHelp) {
      this.audio.select();
      this.state = 'tutorial';
      return;
    }
    if (this.input.wasPressed('shoot') || this.input.wasPressed('confirm') || this.input.taps.length > 0) {
      this.startRun();
    }
  }

  private updateTutorial(): void {
    this.particles.update(0.016);
    if (this.input.wasPressed('mute')) { this.audio.toggleMute(); return; }
    if (this.input.anyPressed()) this.startRun();
  }

  private updatePaused(): void {
    if (this.input.wasPressed('pause') || this.input.wasPressed('shoot') || this.input.taps.length > 0) {
      this.audio.select();
      this.state = this.prevState;
    }
    if (this.input.wasPressed('mute')) this.audio.toggleMute();
  }

  private updatePlaying(pdt: number, wdt: number): void {
    this.runTime += pdt;

    if (this.input.wasPressed('pause')) {
      this.prevState = 'playing';
      this.state = 'paused';
      return;
    }
    if (this.input.wasPressed('mute')) this.audio.toggleMute();
    this.handleTouchTaps();
    if (this.state !== 'playing') return; // pause button tapped
    if (this.input.wasPressed('bomb')) this.useBomb();

    // periodic supply drop keeps builds flowing
    this.supplyT -= pdt;
    if (this.supplyT <= 0) {
      this.supplyT = rand(16, 26);
      const x = rand(60, this.width - 60);
      this.powerups.push(new PowerUp(x, -20));
      this.addText(x, 46, 'SUPPLY DROP', '#7df9ff', 13);
      this.audio.select();
    }

    this.waves.update(wdt, this);
    this.updateWorld(pdt, wdt, true);

    // combo decay
    this.comboTimer -= pdt;
    if (this.comboTimer <= 0 && this.combo > 0) this.combo = 0;

    // boss death sequence
    if (this.bossDying > 0) {
      this.bossDying -= pdt;
      this.bossFxT -= pdt;
      if (this.bossFxT <= 0 && this.boss) {
        this.bossFxT = 0.09;
        const pt = this.boss.randomPoint();
        this.particles.explosion(pt.x, pt.y, pick(['#ff9f1c', '#ffffff', this.boss.color()]), 16, 260, 3);
        this.shake(6);
        this.audio.explosion(0);
      }
      if (this.bossDying <= 0) this.finalizeBossDeath();
    }

    // player death sequence
    if (this.deathTimer > 0) {
      this.deathTimer -= pdt;
      if (this.deathTimer <= 0) {
        this.newRecord = this.score > this.highScore && this.highScore > 0;
        if (this.score > this.highScore) {
          this.highScore = Math.floor(this.score);
          Storage.setHighScore(this.highScore);
        }
        this.audio.stopMusic();
        this.audio.gameOver();
        this.state = 'gameover';
        this.stateTimer = 0.6;
      }
      return;
    }

    // wave cleared?
    if (
      !this.boss && this.bossDying <= 0 && this.player.alive &&
      this.waves.spawningDone() && this.enemies.length === 0
    ) {
      this.onWaveClear();
    }
  }

  private updateWaveClear(pdt: number, wdt: number): void {
    this.runTime += pdt;
    if (this.input.wasPressed('pause')) {
      this.prevState = 'waveclear';
      this.state = 'paused';
      return;
    }
    this.handleTouchTaps();
    if (this.state !== 'waveclear') return; // pause button tapped
    this.updateWorld(pdt, wdt, true);
    this.stateTimer -= pdt;
    if (this.stateTimer <= 0) this.nextWave();
  }

  private updateBossIntro(pdt: number): void {
    if (this.input.wasPressed('pause')) {
      this.prevState = 'bossintro';
      this.state = 'paused';
      return;
    }
    this.handleTouchTaps();
    if (this.state !== 'bossintro') return;
    this.player.update(pdt, this, false);
    this.boss?.update(pdt, this);
    this.particles.update(pdt);
    for (const pu of this.powerups) pu.update(pdt, this);
    this.powerups = this.powerups.filter((p) => !p.dead);
    this.stateTimer -= pdt;
    if (this.stateTimer <= 0) this.state = 'playing';
  }

  private updateGameOver(pdt: number, wdt: number): void {
    this.stateTimer -= pdt;
    // world keeps drifting behind the panel
    for (const e of this.enemies) e.update(wdt * 0.6, this);
    for (const b of this.enemyBullets) b.update(wdt * 0.6, this);
    this.enemyBullets = this.enemyBullets.filter((b) => !b.dead);
    this.particles.update(pdt);

    if (this.stateTimer <= 0) {
      if (this.input.wasPressed('pause')) {
        this.state = 'menu';
        return;
      }
      if (this.input.wasPressed('shoot') || this.input.wasPressed('confirm') || this.input.taps.length > 0) {
        this.startRun();
      }
    }
  }

  private updateWorld(pdt: number, wdt: number, canFire: boolean): void {
    this.player.update(pdt, this, canFire && this.state !== 'bossintro');

    for (const b of this.playerBullets) b.update(pdt, this);
    for (const b of this.enemyBullets) b.update(wdt, this);
    for (const e of this.enemies) e.update(wdt, this);
    this.boss?.update(wdt, this);
    for (const pu of this.powerups) pu.update(pdt, this);

    handleCollisions(this);
    this.particles.update(pdt);

    this.playerBullets = this.playerBullets.filter((b) => !b.dead);
    this.enemyBullets = this.enemyBullets.filter((b) => !b.dead);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.powerups = this.powerups.filter((p) => !p.dead);
  }

  private handleTouchTaps(): void {
    if (!this.input.isTouch) return;
    for (const tap of this.input.taps) {
      for (const btn of this.touchButtons()) {
        if (dist2(tap.x, tap.y, btn.x, btn.y) < btn.r * btn.r) {
          this.btnFlashT[btn.label] = 0.22;
          if (btn.label === 'BOMB') {
            this.useBomb();
          } else if (btn.label === 'PAUSE') {
            if (this.state === 'playing' || this.state === 'waveclear' || this.state === 'bossintro') {
              this.prevState = this.state;
              this.state = 'paused';
              this.audio.select();
            }
          } else {
            this.dashRequested = true;
          }
          try { navigator.vibrate?.(btn.label === 'BOMB' ? 35 : 15); } catch { /* unsupported */ }
        }
      }
    }
  }

  // ======================= flow =======================

  private startRun(): void {
    this.audio.unlock();
    this.audio.select();
    this.audio.startMusic();
    this.score = 0;
    this.dispScore = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.kills = 0;
    this.wave = 0;
    this.runTime = 0;
    this.deathTimer = 0;
    this.bossDying = 0;
    this.newRecord = false;
    this.dropPity = 0;
    this.supplyT = 18;
    this.enemies = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.powerups = [];
    this.texts = [];
    this.lightnings = [];
    this.boss = null;
    this.particles.clear();
    this.waves.reset();
    this.player = new Player(this.width / 2, this.height - 100);
    this.nextWave();
  }

  private nextWave(): void {
    this.wave++;
    this.waveDamageTaken = 0;
    this.waveStartTime = this.runTime;

    if (this.wave % 5 === 0) {
      const kind = BOSS_ORDER[(this.wave / 5 - 1) % BOSS_ORDER.length];
      this.boss = new Boss(kind, this, this.wave);
      this.state = 'bossintro';
      this.stateTimer = 2.8;
      this.audio.bossWarning();
      this.banner = { title: '!! WARNING !!', sub: this.boss.name, t: 2.8, max: 2.8 };
    } else {
      this.waves.startWave(this.wave, this);
      this.state = 'playing';
      this.banner = { title: `WAVE ${this.wave}`, sub: '', t: 1.8, max: 1.8 };
    }
  }

  private onWaveClear(): void {
    let bonus = 100 * this.wave;
    this.clearLines = [`WAVE BONUS +${bonus}`];
    if (this.waveDamageTaken === 0) {
      const perfect = 250 + 25 * this.wave;
      bonus += perfect;
      this.clearLines.push(`PERFECT +${perfect}`);
    }
    if (this.runTime - this.waveStartTime < 30) {
      bonus += 150;
      this.clearLines.push('SPEED BONUS +150');
    }
    this.score += bonus;
    this.scorePop = 1;
    this.player.heal(10, this);
    this.audio.waveClear();
    this.state = 'waveclear';
    this.stateTimer = 2.4;
  }

  onPlayerDeath(): void {
    this.particles.explosion(this.player.x, this.player.y, '#7df9ff', 50, 400, 4);
    this.particles.explosion(this.player.x, this.player.y, '#ff9f1c', 30, 300, 3);
    this.particles.ring(this.player.x, this.player.y, '#ffffff', 600);
    this.shake(30);
    this.flash('#ff2040', 0.3);
    this.cineSlow = 1.2;
    this.audio.explosion(2);
    this.deathTimer = 1.7;
  }

  onBossDefeated(boss: Boss): void {
    this.bossDying = 1.8;
    this.bossFxT = 0;
    this.cineSlow = 0.6;
    this.audio.explosion(2);
    void boss;
  }

  private finalizeBossDeath(): void {
    if (!this.boss) return;
    const b = this.boss;
    this.particles.explosion(b.x, b.y, '#ffffff', 70, 500, 5);
    this.particles.ring(b.x, b.y, '#ffffff', 800);
    this.particles.ring(b.x, b.y, b.color(), 550);
    this.flash('#ffffff', 0.3);
    this.shake(26);
    this.audio.explosion(2);
    const bonus = 5000 + this.wave * 100;
    this.addScore(bonus, b.x, b.y);
    this.addText(this.width / 2, this.height * 0.4, 'BOSS DESTROYED', '#ffd700', 30);
    for (let i = 0; i < 3; i++) {
      this.powerups.push(new PowerUp(b.x + (i - 1) * 50, b.y + rand(-20, 20)));
    }
    // sweep remaining hostile fire into score sparks
    for (const eb of this.enemyBullets) {
      this.particles.sparks(eb.x, eb.y, '#ffd700', 3);
      eb.dead = true;
    }
    this.player.heal(20, this);
    this.boss = null;
  }

  // ======================= actions & scoring =======================

  comboMult(): number {
    const base = 1 + Math.min(this.combo, 40) * 0.05;
    return this.player.multiTime > 0 ? base * 2 : base;
  }

  addScore(base: number, x?: number, y?: number): void {
    const gained = Math.round(base * this.comboMult());
    this.score += gained;
    this.scorePop = 1;
    if (x !== undefined && y !== undefined) {
      this.addText(x, y, `+${gained}`, '#ffd700', clamp(11 + gained / 150, 11, 22));
    }
  }

  addText(x: number, y: number, str: string, color: string, size = 14): void {
    this.texts.push({ x, y, str, color, t: 0.9, max: 0.9, size });
  }

  addLightning(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const pts = [{ x: x1, y: y1 }];
    const segs = 6;
    for (let i = 1; i < segs; i++) {
      const f = i / segs;
      const nx = x1 + (x2 - x1) * f;
      const ny = y1 + (y2 - y1) * f;
      const perp = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
      const off = rand(-14, 14);
      pts.push({ x: nx + Math.cos(perp) * off, y: ny + Math.sin(perp) * off });
    }
    pts.push({ x: x2, y: y2 });
    this.lightnings.push({ pts, t: 0.15, max: 0.15, color });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(30, Math.max(this.shakeAmt, amount));
  }

  flash(color: string, t: number): void {
    this.flashFx = { color, t, max: t };
  }

  consumeDashRequest(): boolean {
    const r = this.dashRequested;
    this.dashRequested = false;
    return r;
  }

  touchButtons(): { x: number; y: number; r: number; label: string; color: string }[] {
    if (!this.input.isTouch) return [];
    return [
      { x: this.width - 62, y: this.height - 126, r: 40, label: 'BOMB', color: '#ff5c5c' },
      { x: 62, y: this.height - 126, r: 40, label: 'DASH', color: '#26d8ff' },
      { x: this.width - 32, y: 86, r: 22, label: 'PAUSE', color: '#9ab8d8' },
    ];
  }

  killEnemy(e: Enemy): void {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.combo++;
    this.comboTimer = 3;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.addScore(e.score, e.x, e.y);

    const big = e.r >= 18;
    this.particles.explosion(e.x, e.y, e.color, big ? 40 : 22, big ? 320 : 230, big ? 4 : 3);
    if (big) this.particles.ring(e.x, e.y, e.color, 420);
    this.shake(clamp(2 + e.r * 0.15, 2, 9));
    this.audio.explosion(e.kind === 'elite' ? 2 : big ? 1 : 0);

    if (e.kind === 'splitter') {
      for (let i = 0; i < 3; i++) {
        this.enemies.push(new Enemy('mini', e.x + (i - 1) * 22, e.y + rand(-8, 8), this.wave));
      }
    }
    if (e.kind === 'elite') {
      this.cineSlow = 0.25;
      this.particles.ring(e.x, e.y, '#ffffff', 650);
      for (let i = 0; i < 2; i++) this.powerups.push(new PowerUp(e.x + (i - 0.5) * 44, e.y));
      this.dropPity = 0;
    } else {
      // generous drops with a pity floor so a build is never starved
      this.dropPity++;
      const small = e.kind === 'swarm' || e.kind === 'mini';
      if (Math.random() < (small ? 0.07 : 0.18) || this.dropPity >= 14) {
        this.powerups.push(new PowerUp(e.x, e.y));
        this.dropPity = 0;
      }
    }
  }

  explodeAt(x: number, y: number, radius: number, dmg: number, color: string): void {
    this.particles.explosion(x, y, color, 24, 280, 3.5);
    this.particles.ring(x, y, color, 380);
    this.shake(5);
    for (const e of this.enemies) {
      if (e.dead || e.entering) continue;
      if (dist2(x, y, e.x, e.y) < (radius + e.r) ** 2) {
        e.hp -= dmg;
        e.flash = 0.08;
        if (e.hp <= 0) this.killEnemy(e);
      }
    }
  }

  applyPowerUp(pu: PowerUp): void {
    const p = this.player;
    const info = POWERUP_INFO[pu.type];
    let label: string = info.name;

    switch (pu.type) {
      case 'health': p.heal(35, this); break;
      case 'shield': p.shieldTime = 10; break;
      case 'rapid': p.rapidTime = 8; break;
      case 'multi': p.multiTime = 10; break;
      case 'slow': p.slowTime = 6; break;
      case 'magnet': p.magnetTime = 10; break;
      case 'bomb': p.bombs = Math.min(4, p.bombs + 1); break;
      case 'weapon': {
        if (p.weapon === pu.weapon) {
          p.weaponLevel = Math.min(3, p.weaponLevel + 1);
          label = 'WEAPON UP!';
        } else {
          p.weapon = pu.weapon;
          label = WEAPONS[pu.weapon].name;
        }
        break;
      }
      case 'upgrade': {
        if (p.weaponLevel < 3) {
          p.weaponLevel++;
        } else {
          this.addScore(500);
          label = 'MAXED +BONUS';
        }
        break;
      }
    }

    this.audio.powerup();
    this.particles.ring(p.x, p.y, info.color, 350);
    this.particles.ring(p.x, p.y, '#ffffff', 520);
    this.particles.sparks(p.x, p.y, info.color, 16);
    this.cineSlow = Math.max(this.cineSlow, 0.12);
    this.flash(info.color, 0.07);
    this.addText(p.x, p.y - 34, label, info.color, 16);
  }

  useBomb(): void {
    const p = this.player;
    if (p.bombs <= 0 || !p.alive) return;
    if (this.state !== 'playing' && this.state !== 'waveclear') return;
    p.bombs--;

    this.audio.bomb();
    this.flash('#ffffff', 0.22);
    this.shake(24);
    this.cineSlow = 0.35;
    this.particles.ring(p.x, p.y, '#ffffff', 900);
    this.particles.ring(p.x, p.y, '#ff9f1c', 650);
    this.particles.ring(p.x, p.y, '#7df9ff', 450);
    this.particles.explosion(p.x, p.y, '#ffffff', 40, 500, 4);

    let sweep = 0;
    for (const b of this.enemyBullets) {
      if (!b.dead) {
        this.particles.sparks(b.x, b.y, '#ffd700', 3);
        b.dead = true;
        sweep += 10;
      }
    }
    if (sweep > 0) this.addScore(sweep, p.x, p.y - 50);

    for (const e of [...this.enemies]) {
      if (e.dead) continue;
      e.hp -= 160;
      e.flash = 0.15;
      if (e.hp <= 0) this.killEnemy(e);
    }
    if (this.boss) this.boss.hurt(200, this);
  }

  // ======================= rendering =======================

  private resize(): void {
    // canvas CSS box is the source of truth — tracks dvh viewport on mobile
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    // phones/tablets: cap total fill-rate so 'lighter' blending stays smooth
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (coarse) {
      const budget = 4_000_000;
      if (this.width * this.height * dpr * dpr > budget) {
        dpr = Math.max(1, Math.sqrt(budget / (this.width * this.height)));
      }
    }
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    if (this.player) {
      this.player.x = clamp(this.player.x, 20, this.width - 20);
      this.player.y = clamp(this.player.y, this.height * 0.35, this.height - 46);
    }

    // starfield
    this.stars = [];
    const count = clamp(Math.round((this.width * this.height) / 4500), 80, 260);
    for (let i = 0; i < count; i++) {
      const layer = Math.random();
      this.stars.push({
        x: rand(0, this.width),
        y: rand(0, this.height),
        size: 0.6 + layer * 1.8,
        speed: 18 + layer * 90,
        color: pick(['#ffffff', '#9ecbff', '#c9a8ff', '#7df9ff']),
        tw: rand(1.5, 5),
      });
    }

    // nebula clouds
    this.nebulae = [];
    for (let i = 0; i < 5; i++) {
      this.nebulae.push({
        x: rand(0, this.width),
        y: rand(-this.height * 0.2, this.height),
        r: rand(160, 380),
        color: pick(['#243a8f', '#5a1f8f', '#146078', '#701a55', '#1c2f7a']),
        phase: rand(0, Math.PI * 2),
      });
    }

    // vignette + scanlines overlay
    const v = document.createElement('canvas');
    v.width = this.width;
    v.height = this.height;
    const vg = v.getContext('2d')!;
    const grad = vg.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,10,0)');
    grad.addColorStop(1, 'rgba(0,0,12,0.55)');
    vg.fillStyle = grad;
    vg.fillRect(0, 0, this.width, this.height);
    vg.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < this.height; y += 4) vg.fillRect(0, y, this.width, 1);
    this.vignette = v;

    const bg = this.ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, '#05060f');
    bg.addColorStop(0.6, '#090b1e');
    bg.addColorStop(1, '#130a28');
    this.bgGrad = bg;
  }

  private updateStars(dt: number): void {
    const mul = this.state === 'menu' || this.state === 'tutorial' ? 0.4 : 1;
    for (const s of this.stars) {
      s.y += s.speed * mul * dt;
      if (s.y > this.height + 2) {
        s.y = -2;
        s.x = rand(0, this.width);
      }
    }
    for (const n of this.nebulae) {
      n.y += 7 * mul * dt;
      n.x += Math.sin(this.t * 0.06 + n.phase) * 6 * dt;
      if (n.y - n.r > this.height) {
        n.y = -n.r;
        n.x = rand(0, this.width);
      }
    }
    this.shootingStarT -= dt;
    if (this.shootingStarT <= 0) {
      this.shootingStarT = rand(4, 9);
      this.shootingStars.push({
        x: rand(this.width * 0.1, this.width * 0.9),
        y: -10,
        vx: rand(-90, 90),
        vy: rand(420, 640),
        t: 1,
      });
    }
    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const ss = this.shootingStars[i];
      ss.t -= dt;
      ss.x += ss.vx * dt;
      ss.y += ss.vy * dt;
      if (ss.t <= 0 || ss.y > this.height + 20) this.shootingStars.splice(i, 1);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = this.bgGrad ?? '#05060f';
    ctx.fillRect(0, 0, this.width, this.height);

    // screen shake
    if (this.shakeAmt > 0.2) {
      ctx.translate(rand(-this.shakeAmt, this.shakeAmt) * 0.5, rand(-this.shakeAmt, this.shakeAmt) * 0.5);
    }

    // nebula clouds
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const n of this.nebulae) {
      drawSoft(ctx, n.x, n.y, n.r, n.color, 0.33);
    }
    ctx.restore();

    // starfield with twinkle
    for (const s of this.stars) {
      ctx.globalAlpha = (0.4 + s.size * 0.25) * (0.72 + 0.28 * Math.sin(this.t * s.tw + s.x));
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.size, s.size * 2.2);
    }
    ctx.globalAlpha = 1;

    // shooting stars
    if (this.shootingStars.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const ss of this.shootingStars) {
        const tx = ss.x - ss.vx * 0.13;
        const ty = ss.y - ss.vy * 0.13;
        ctx.globalAlpha = ss.t * 0.35;
        ctx.strokeStyle = '#7df9ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ss.x, ss.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = ss.t * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (this.state === 'menu') {
      this.particles.render(ctx);
      this.drawMenu(ctx);
    } else if (this.state === 'tutorial') {
      this.drawTutorial(ctx);
    } else {
      this.drawWorld(ctx);
    }

    // full-screen flash
    if (this.flashFx.t > 0) {
      ctx.globalAlpha = (this.flashFx.t / this.flashFx.max) * 0.45;
      ctx.fillStyle = this.flashFx.color;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    // state overlays
    if (this.state === 'paused') this.drawPaused(ctx);
    if (this.state === 'gameover') this.drawGameOver(ctx);
    if (this.state === 'bossintro') this.drawBossIntro(ctx);

    if (this.audio.muted) {
      ctx.fillStyle = '#5a7a9a';
      ctx.font = `500 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('MUTED [M]', this.width / 2, this.height - 8);
    }
  }

  private drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const pu of this.powerups) pu.draw(ctx);
    for (const e of this.enemies) e.draw(ctx, this);
    this.boss?.draw(ctx, this);
    for (const b of this.enemyBullets) b.draw(ctx);
    for (const b of this.playerBullets) b.draw(ctx);
    this.player.draw(ctx);
    this.particles.render(ctx);

    // chain lightning
    if (this.lightnings.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const l of this.lightnings) {
        ctx.globalAlpha = l.t / l.max;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        l.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // floating text
    for (const tx of this.texts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (tx.t / tx.max) * 1.6);
      ctx.fillStyle = tx.color;
      ctx.shadowColor = tx.color;
      ctx.shadowBlur = 8;
      ctx.font = `700 ${tx.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(tx.str, tx.x, tx.y);
      ctx.restore();
    }

    drawHUD(ctx, this);

    // wave banner
    if (this.banner.t > 0 && this.state !== 'bossintro') {
      const prog = 1 - this.banner.t / this.banner.max;
      const alpha = prog < 0.15 ? prog / 0.15 : this.banner.t < 0.4 ? this.banner.t / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#7df9ff';
      ctx.shadowBlur = 20;
      ctx.font = `900 ${Math.min(44, this.width * 0.1)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(this.banner.title, this.width / 2, this.height * 0.32);
      ctx.restore();
    }

    // wave clear panel
    if (this.state === 'waveclear') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#3dff8c';
      ctx.shadowColor = '#3dff8c';
      ctx.shadowBlur = 18;
      ctx.font = `900 ${Math.min(40, this.width * 0.095)}px ${FONT}`;
      ctx.fillText('WAVE CLEAR', this.width / 2, this.height * 0.32);
      ctx.shadowBlur = 0;
      ctx.font = `700 16px ${FONT}`;
      this.clearLines.forEach((line, i) => {
        ctx.fillStyle = i === 0 ? '#ffffff' : '#ffd700';
        ctx.fillText(line, this.width / 2, this.height * 0.32 + 36 + i * 24);
      });
      ctx.restore();
    }
  }

  private drawBossIntro(ctx: CanvasRenderingContext2D): void {
    const pulse = Math.abs(Math.sin(this.t * 6));
    ctx.save();
    ctx.fillStyle = `rgba(255, 20, 60, ${0.08 + pulse * 0.08})`;
    ctx.fillRect(0, 0, this.width, this.height);
    // hazard bars
    ctx.fillStyle = `rgba(255, 32, 80, ${0.5 + pulse * 0.5})`;
    ctx.fillRect(0, this.height * 0.24, this.width, 4);
    ctx.fillRect(0, this.height * 0.46, this.width, 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff2040';
    ctx.shadowColor = '#ff2040';
    ctx.shadowBlur = 24;
    ctx.font = `900 ${Math.min(46, this.width * 0.105)}px ${FONT}`;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.fillText('!! WARNING !!', this.width / 2, this.height * 0.33);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.font = `700 ${Math.min(22, this.width * 0.052)}px ${FONT}`;
    ctx.fillText(this.boss?.name ?? '', this.width / 2, this.height * 0.41);
    ctx.restore();
  }

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    const cx = this.width / 2;
    ctx.save();
    ctx.textAlign = 'center';

    const bob = Math.sin(this.t * 1.5) * 6;
    ctx.save();
    ctx.translate(0, bob);
    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#eaffff';
    ctx.font = `900 ${Math.min(64, this.width * 0.11)}px ${FONT}`;
    ctx.fillText('NEON VOID', cx, this.height * 0.3);
    ctx.shadowColor = '#ff2975';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2975';
    ctx.font = `700 ${Math.min(26, this.width * 0.045)}px ${FONT}`;
    ctx.fillText('I N V A D E R   S T O R M', cx, this.height * 0.3 + 42);
    ctx.restore();

    if (this.highScore > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 8;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(`HI-SCORE  ${String(this.highScore).padStart(7, '0')}`, cx, this.height * 0.44);
      ctx.shadowBlur = 0;
    }

    const pulse = 0.55 + Math.abs(Math.sin(this.t * 2.4)) * 0.45;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 14;
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText(this.input.isTouch ? 'TAP TO START' : 'PRESS SPACE TO START', cx, this.height * 0.62);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#5a7a9a';
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(this.input.isTouch ? 'TAP HERE — HOW TO PLAY' : '[H] HOW TO PLAY', cx, this.height * 0.76);
    ctx.fillStyle = '#3a5068';
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText('[M] SOUND ON/OFF', cx, this.height * 0.76 + 24);
    ctx.restore();
  }

  private drawTutorial(ctx: CanvasRenderingContext2D): void {
    const cx = this.width / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaffff';
    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 16;
    ctx.font = `900 30px ${FONT}`;
    ctx.fillText('PILOT BRIEFING', cx, this.height * 0.14);
    ctx.shadowBlur = 0;

    const lines: [string, string][] = this.input.isTouch
      ? [
          ['DRAG', 'ship mirrors your finger — auto-fire'],
          ['DASH BUTTON', 'invincible burst in your move direction'],
          ['BOMB BUTTON', 'clear the screen (limited stock)'],
          ['PAUSE BUTTON', 'top-right corner — tap again to resume'],
          ['', ''],
          ['PICKUPS', 'grab hex capsules for weapons & buffs'],
          ['COMBO', 'chain kills fast to multiply your score'],
          ['SHIELD SIDE', 'shield bugs block from one side — flank them'],
          ['MINES', 'shoot them before they burst'],
        ]
      : [
          ['W A S D / ARROWS', 'move in all directions'],
          ['SPACE', 'fire'],
          ['SHIFT', 'dash (brief invincibility)'],
          ['B or X', 'nova bomb — clears the screen'],
          ['P / ESC', 'pause'],
          ['', ''],
          ['PICKUPS', 'grab hex capsules for weapons & buffs'],
          ['COMBO', 'chain kills fast to multiply your score'],
          ['SHIELD SIDE', 'shield bugs block from one side — flank them'],
          ['MINES', 'shoot them before they burst'],
        ];

    const narrow = this.width < 560;
    let y = this.height * (narrow ? 0.21 : 0.24);
    for (const [key, desc] of lines) {
      if (key) {
        if (narrow) {
          // stacked, centered — the two-column layout overflows small phones
          ctx.textAlign = 'center';
          ctx.fillStyle = '#7df9ff';
          ctx.font = `700 13px ${FONT}`;
          ctx.fillText(key, cx, y);
          ctx.fillStyle = '#9ab8d8';
          ctx.font = `500 11px ${FONT}`;
          ctx.fillText(desc, cx, y + 15);
        } else {
          ctx.fillStyle = '#7df9ff';
          ctx.font = `700 14px ${FONT}`;
          ctx.textAlign = 'right';
          ctx.fillText(key, cx - 14, y);
          ctx.fillStyle = '#9ab8d8';
          ctx.font = `500 13px ${FONT}`;
          ctx.textAlign = 'left';
          ctx.fillText(desc, cx + 14, y);
        }
      }
      y += narrow ? 36 : 30;
    }

    ctx.textAlign = 'center';
    const pulse = 0.5 + Math.abs(Math.sin(this.t * 2.4)) * 0.5;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(this.input.isTouch ? 'TAP TO LAUNCH' : 'PRESS ANY KEY TO LAUNCH', cx, this.height * 0.88);
    ctx.restore();
  }

  private drawPaused(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 15, 0.72)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaffff';
    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 20;
    ctx.font = `900 42px ${FONT}`;
    ctx.fillText('PAUSED', this.width / 2, this.height * 0.42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9ab8d8';
    ctx.font = `500 14px ${FONT}`;
    ctx.fillText(
      this.input.isTouch ? 'TAP TO RESUME' : '[P] RESUME  ·  [M] SOUND',
      this.width / 2, this.height * 0.42 + 40,
    );
    ctx.restore();
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(20, 2, 8, 0.66)';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    const cx = this.width / 2;

    ctx.fillStyle = '#ff2040';
    ctx.shadowColor = '#ff2040';
    ctx.shadowBlur = 26;
    ctx.font = `900 ${Math.min(52, this.width * 0.09)}px ${FONT}`;
    ctx.fillText('GAME OVER', cx, this.height * 0.3);
    ctx.shadowBlur = 0;

    if (this.newRecord) {
      const pulse = 0.6 + Math.abs(Math.sin(this.t * 4)) * 0.4;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 16;
      ctx.font = `900 22px ${FONT}`;
      ctx.fillText('★ NEW RECORD ★', cx, this.height * 0.3 + 38);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    const stats: [string, string][] = [
      ['SCORE', String(Math.floor(this.score)).padStart(7, '0')],
      ['BEST', String(this.highScore).padStart(7, '0')],
      ['WAVE REACHED', String(this.wave)],
      ['KILLS', String(this.kills)],
      ['MAX COMBO', `x${(1 + Math.min(this.maxCombo, 40) * 0.05).toFixed(1)}`],
    ];
    let y = this.height * 0.44;
    for (const [label, value] of stats) {
      ctx.fillStyle = '#5a7a9a';
      ctx.font = `500 13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(label, cx - 12, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 15px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(value, cx + 12, y);
      y += 28;
    }

    if (this.stateTimer <= 0) {
      ctx.textAlign = 'center';
      const pulse = 0.5 + Math.abs(Math.sin(this.t * 2.4)) * 0.5;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#7df9ff';
      ctx.shadowBlur = 12;
      ctx.font = `700 18px ${FONT}`;
      ctx.fillText(this.input.isTouch ? 'TAP TO RETRY' : 'SPACE — RETRY  ·  ESC — MENU', cx, y + 24);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
