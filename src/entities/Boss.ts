import type Game from '../Game';
import { Bullet } from './Bullet';
import { Enemy } from './Enemy';
import type { Player } from './Player';
import { drawGlow } from '../utils/gfx';
import { angleTo, clamp, dist2, distToSegment, pick, rand, TAU } from '../utils/math';

export type BossKind = 'mothership' | 'serpent' | 'core';

export type HitResult = 'none' | 'hit' | 'block';

interface Segment { x: number; y: number }
interface Pod { a: number; hp: number; maxHp: number; dead: boolean }

const NAMES: Record<BossKind, string> = {
  mothership: 'THE MOTHERSHIP',
  serpent: 'THE VOID SERPENT',
  core: 'THE ORBITAL CORE',
};

export class Boss {
  kind: BossKind;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dispHp: number;
  dead = false;
  entering = true;
  phase = 1;
  flash = 0;

  private t = 0;
  private idleT = 1.2;
  private attack = '';
  private attackT = 0;
  private emitT = 0;
  private atkIndex = 0;
  private targetY: number;
  private cycle: number; // how many times the boss roster has looped
  private wave: number;

  // mothership sweep beam
  private beamState = 0; // 0 none, 1 warn, 2 fire
  private beamT = 0;
  private beamX = 0;
  private beamDir = 1;
  private beamW = 34;

  // serpent
  segments: Segment[] = [];

  // orbital core
  pods: Pod[] = [];
  private podSpin = 0;
  private spiralA = 0;
  private coreBeamA = 0;

  constructor(kind: BossKind, game: Game, wave: number) {
    this.kind = kind;
    this.name = NAMES[kind];
    this.wave = wave;
    this.cycle = Math.floor((wave - 5) / 15);
    const mul = 1 + this.cycle * 0.75 + wave * 0.01;

    this.x = game.width / 2;
    this.y = -160;
    this.targetY = kind === 'core' ? 190 : kind === 'serpent' ? 150 : 115;

    const baseHp = kind === 'mothership' ? 1400 : kind === 'serpent' ? 1700 : 2000;
    this.hp = this.maxHp = this.dispHp = Math.round(baseHp * mul);

    if (kind === 'serpent') {
      for (let i = 0; i < 11; i++) this.segments.push({ x: this.x, y: this.y - i * 26 });
    }
    if (kind === 'core') this.spawnPods(5, mul);
  }

  private spawnPods(count: number, mul = 1): void {
    this.pods = [];
    for (let i = 0; i < count; i++) {
      const hp = Math.round(90 * (1 + this.cycle * 0.6));
      this.pods.push({ a: (i / count) * TAU, hp, maxHp: hp, dead: false });
      void mul;
    }
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.dispHp += (this.hp - this.dispHp) * Math.min(1, 4 * dt);

    if (this.entering) {
      this.y += (this.targetY - this.y) * Math.min(1, 1.6 * dt) + 20 * dt;
      if (this.y >= this.targetY - 4) {
        this.y = this.targetY;
        this.entering = false;
      }
      if (this.kind === 'serpent') this.followSegments(dt);
      return;
    }
    if (this.dead) return;

    // phase transitions
    const frac = this.hp / this.maxHp;
    const newPhase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      game.shake(18);
      game.particles.ring(this.x, this.y, '#ffffff', 700);
      game.particles.explosion(this.x, this.y, this.color(), 40, 350, 4);
      game.audio.bossWarning();
      game.addText(this.x, this.y - 60, 'PHASE ' + newPhase, '#ff2975', 26);
      if (this.kind === 'core') this.spawnPods(this.phase === 2 ? 4 : 3);
      this.attack = '';
      this.idleT = 1.4;
    }

    switch (this.kind) {
      case 'mothership': this.updateMothership(dt, game); break;
      case 'serpent': this.updateSerpent(dt, game); break;
      case 'core': this.updateCore(dt, game); break;
    }
  }

  color(): string {
    return this.kind === 'mothership' ? '#39ff88' : this.kind === 'serpent' ? '#b967ff' : '#ff9f1c';
  }

  // ---- mothership ---------------------------------------------------------

  private updateMothership(dt: number, game: Game): void {
    this.x = game.width / 2 + Math.sin(this.t * 0.4) * game.width * 0.14;

    if (this.beamState > 0) {
      this.beamT -= dt;
      if (this.beamState === 1 && this.beamT <= 0) {
        this.beamState = 2;
        this.beamT = 2.4;
        game.audio.zap();
      } else if (this.beamState === 2) {
        // slower than the player (430) and stops short of the far wall,
        // so outrunning the sweep always leaves a safe lane
        this.beamX += this.beamDir * Math.min(330, game.width * 0.3) * dt;
        game.shake(2);
        if (this.beamT <= 0) this.beamState = 0;
      }
    }

    if (this.attack) {
      this.attackT -= dt;
      this.emitT -= dt;
      if (this.emitT <= 0) this.emitMothership(game);
      if (this.attackT <= 0) {
        this.attack = '';
        this.idleT = 1.15 - this.phase * 0.2;
      }
    } else {
      this.idleT -= dt;
      if (this.idleT <= 0) this.pickMothershipAttack(game);
    }
  }

  private pickMothershipAttack(game: Game): void {
    const list = ['fan', 'rain', 'spawn'];
    if (this.phase >= 2) list.push('sweep');
    if (this.phase >= 3) list.push('rings', 'fan');
    const atk = list[this.atkIndex++ % list.length];
    this.attack = atk;
    this.emitT = 0;
    if (atk === 'fan') this.attackT = 1.6;
    else if (atk === 'rain') this.attackT = 2.1;
    else if (atk === 'spawn') this.attackT = 0.3;
    else if (atk === 'rings') this.attackT = 1.8;
    else if (atk === 'sweep') {
      this.attackT = 1.0;
      this.beamState = 1;
      this.beamT = 1.0;
      this.beamDir = game.player.x > game.width / 2 ? -1 : 1;
      this.beamX = this.beamDir === 1 ? 50 : game.width - 50;
      game.audio.bossWarning();
    }
  }

  private emitMothership(game: Game): void {
    const speed = 190 + this.phase * 25 + this.cycle * 30;
    if (this.attack === 'fan') {
      this.emitT = 0.42;
      const base = angleTo(this.x, this.y + 20, game.player.x, game.player.y);
      const n = 4 + this.phase;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.17;
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y + 24,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          r: 5, damage: 12, kind: 'orb', color: '#39ff88', friendly: false, life: 8,
        }));
      }
    } else if (this.attack === 'rain') {
      this.emitT = 0.09;
      const hw = Math.min(game.width * 0.3, 230);
      game.enemyBullets.push(new Bullet({
        x: this.x + rand(-hw, hw), y: this.y + 26,
        vy: rand(150, 240) + this.phase * 20,
        r: 4, damage: 9, kind: 'orb', color: '#7cffcb', friendly: false, life: 8,
      }));
    } else if (this.attack === 'spawn') {
      this.emitT = 99;
      const n = 2 + this.phase;
      for (let i = 0; i < n; i++) {
        game.enemies.push(new Enemy(pick(['swarm', 'grunt'] as const), this.x + (i - n / 2) * 50, this.y + 40, this.wave));
      }
      game.particles.sparks(this.x, this.y + 30, '#39ff88', 14, Math.PI / 2, 1.6);
    } else if (this.attack === 'rings') {
      this.emitT = 0.6;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.t;
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y + 10,
          vx: Math.cos(a) * speed * 0.8, vy: Math.sin(a) * speed * 0.8,
          r: 5, damage: 11, kind: 'orb', color: '#39ff88', friendly: false, life: 8,
        }));
      }
      game.audio.explosion(0);
    }
  }

  // ---- serpent ------------------------------------------------------------

  private updateSerpent(dt: number, game: Game): void {
    const speed = 0.75 + this.phase * 0.3;
    const wx = Math.min(game.width * 0.36, 320);
    this.x = game.width / 2 + Math.sin(this.t * 0.55 * speed) * wx;
    this.y = 165 + Math.sin(this.t * 0.83 * speed + 1.7) * 95;
    this.followSegments(dt);

    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 2.1 - this.phase * 0.35 - this.cycle * 0.2;
      const pattern = this.atkIndex++ % (this.phase >= 2 ? 3 : 2);
      const bulletSpeed = 180 + this.phase * 25 + this.cycle * 25;
      if (pattern === 0) {
        // aimed shots from random body segments
        for (let i = 0; i < 3; i++) {
          const s = pick(this.segments);
          const a = angleTo(s.x, s.y, game.player.x, game.player.y);
          game.enemyBullets.push(new Bullet({
            x: s.x, y: s.y,
            vx: Math.cos(a) * bulletSpeed, vy: Math.sin(a) * bulletSpeed,
            r: 5, damage: 11, kind: 'orb', color: '#b967ff', friendly: false, life: 8,
          }));
        }
      } else if (pattern === 1) {
        // ring from the head
        const n = 10 + this.phase * 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.t;
          game.enemyBullets.push(new Bullet({
            x: this.x, y: this.y,
            vx: Math.cos(a) * bulletSpeed * 0.85, vy: Math.sin(a) * bulletSpeed * 0.85,
            r: 5, damage: 11, kind: 'orb', color: '#d59bff', friendly: false, life: 8,
          }));
        }
        game.audio.explosion(0);
      } else {
        // spiral flurry
        for (let i = 0; i < 14; i++) {
          const a = this.t * 3 + i * 0.45;
          game.enemyBullets.push(new Bullet({
            x: this.x, y: this.y,
            vx: Math.cos(a) * (bulletSpeed * 0.7 + i * 8), vy: Math.sin(a) * (bulletSpeed * 0.7 + i * 8),
            r: 4, damage: 10, kind: 'orb', color: '#ff5df1', friendly: false, life: 8,
          }));
        }
      }
    }
  }

  private followSegments(dt: number): void {
    let px = this.x;
    let py = this.y;
    const spacing = 25;
    for (const s of this.segments) {
      const a = angleTo(px, py, s.x, s.y);
      const targetX = px + Math.cos(a) * spacing;
      const targetY = py + Math.sin(a) * spacing;
      s.x += (targetX - s.x) * Math.min(1, 14 * dt);
      s.y += (targetY - s.y) * Math.min(1, 14 * dt);
      px = s.x;
      py = s.y;
    }
  }

  // ---- orbital core ---------------------------------------------------------

  private updateCore(dt: number, game: Game): void {
    this.x = game.width / 2 + Math.sin(this.t * 0.3) * Math.min(120, game.width * 0.15);
    this.podSpin += dt * (0.7 + this.phase * 0.25);

    // constant spiral emitter
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = Math.max(0.09, 0.17 - this.phase * 0.025 - this.cycle * 0.02);
      this.spiralA += 0.42;
      const speed = 165 + this.phase * 20 + this.cycle * 25;
      for (let k = 0; k < (this.phase >= 3 ? 2 : 1); k++) {
        const a = this.spiralA + k * Math.PI;
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          r: 4, damage: 10, kind: 'orb', color: '#ff9f1c', friendly: false, life: 9,
        }));
      }
    }

    // pulse rings
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 3.4 - this.phase * 0.4;
      const n = 18;
      const speed = 150 + this.phase * 20;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(0, 0.3);
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          r: 5, damage: 11, kind: 'orb', color: '#ffd23f', friendly: false, life: 9,
        }));
      }
      game.audio.explosion(0);
      game.particles.ring(this.x, this.y, '#ff9f1c', 500);
    }

    // rotating twin beams from phase 2 on
    if (this.phase >= 2) {
      if (this.beamState === 0) {
        this.beamT -= dt;
        if (this.beamT <= 0) {
          this.beamState = 1;
          this.beamT = 1.1;
          this.coreBeamA = rand(0.4, Math.PI - 0.4);
          game.audio.bossWarning();
        }
      } else if (this.beamState === 1) {
        this.beamT -= dt;
        if (this.beamT <= 0) {
          this.beamState = 2;
          this.beamT = 3.0;
          game.audio.zap();
        }
      } else {
        this.beamT -= dt;
        this.coreBeamA += dt * 0.45 * (this.phase === 3 ? 1.5 : 1);
        game.shake(1.5);
        if (this.beamT <= 0) {
          this.beamState = 0;
          this.beamT = 3.5;
        }
      }
    }
  }

  private podPos(p: Pod): { x: number; y: number } {
    const R = 95;
    return {
      x: this.x + Math.cos(p.a + this.podSpin) * R,
      y: this.y + Math.sin(p.a + this.podSpin) * R,
    };
  }

  private podsAlive(): boolean {
    return this.pods.some((p) => !p.dead);
  }

  // ---- hits -----------------------------------------------------------------

  tryHit(b: Bullet, game: Game): HitResult {
    if (this.dead || this.entering) return 'none';

    if (this.kind === 'core') {
      for (const pod of this.pods) {
        if (pod.dead) continue;
        const pos = this.podPos(pod);
        if (dist2(b.x, b.y, pos.x, pos.y) < (20 + b.r) ** 2) {
          pod.hp -= b.damage;
          this.flash = 0.06;
          game.particles.sparks(b.x, b.y, '#ff9f1c', 5);
          if (pod.hp <= 0) {
            pod.dead = true;
            game.particles.explosion(pos.x, pos.y, '#ff9f1c', 26, 260, 3);
            game.particles.ring(pos.x, pos.y, '#ff9f1c', 400);
            game.audio.explosion(1);
            game.shake(8);
            game.addScore(500, pos.x, pos.y);
            if (!this.podsAlive()) game.addText(this.x, this.y - 70, 'CORE EXPOSED!', '#ffffff', 22);
          }
          return 'hit';
        }
      }
      if (dist2(b.x, b.y, this.x, this.y) < (44 + b.r) ** 2) {
        if (this.podsAlive()) return 'block';
        this.applyDamage(b.damage * 1.5, game);
        return 'hit';
      }
      return 'none';
    }

    if (this.kind === 'serpent') {
      if (dist2(b.x, b.y, this.x, this.y) < (26 + b.r) ** 2) {
        this.applyDamage(b.damage, game);
        return 'hit';
      }
      for (const s of this.segments) {
        if (dist2(b.x, b.y, s.x, s.y) < (17 + b.r) ** 2) {
          this.applyDamage(b.damage * 0.35, game);
          game.particles.sparks(b.x, b.y, '#b967ff', 3);
          return 'hit';
        }
      }
      return 'none';
    }

    // mothership: glowing core takes double damage
    const coreHit = dist2(b.x, b.y, this.x, this.y + 12) < (30 + b.r) ** 2;
    if (coreHit) {
      this.applyDamage(b.damage * 2, game);
      game.particles.sparks(b.x, b.y, '#ffffff', 6);
      return 'hit';
    }
    const hw = Math.min(game.width * 0.26, 210);
    for (const off of [-hw * 0.55, hw * 0.55]) {
      if (dist2(b.x, b.y, this.x + off, this.y) < (44 + b.r) ** 2) {
        this.applyDamage(b.damage, game);
        return 'hit';
      }
    }
    return 'none';
  }

  /** Direct damage that bypasses hit zones (bombs). */
  hurt(dmg: number, game: Game): void {
    if (this.dead || this.entering) return;
    this.flash = 0.12;
    this.applyDamage(dmg, game);
  }

  private applyDamage(dmg: number, game: Game): void {
    this.hp -= dmg;
    this.flash = 0.06;
    if (this.hp <= 0 && !this.dead) {
      this.hp = 0;
      this.dead = true;
      this.beamState = 0;
      game.onBossDefeated(this);
    }
  }

  touchesPlayer(p: Player): boolean {
    if (this.dead || this.entering) return false;
    if (this.kind === 'serpent') {
      if (dist2(p.x, p.y, this.x, this.y) < (26 + p.r) ** 2) return true;
      return this.segments.some((s) => dist2(p.x, p.y, s.x, s.y) < (17 + p.r) ** 2);
    }
    const r = this.kind === 'core' ? 46 : 60;
    return dist2(p.x, p.y, this.x, this.y) < (r + p.r) ** 2;
  }

  beamHitsPlayer(p: Player, game: Game): boolean {
    if (this.dead) return false;
    if (this.kind === 'mothership' && this.beamState === 2) {
      return Math.abs(p.x - this.beamX) < this.beamW / 2 + p.r * 0.8;
    }
    if (this.kind === 'core' && this.beamState === 2) {
      for (const dir of [1, -1]) {
        const a = this.coreBeamA * dir + (dir === -1 ? Math.PI : 0);
        const ex = this.x + Math.cos(a) * 1500;
        const ey = this.y + Math.sin(a) * 1500;
        if (distToSegment(p.x, p.y, this.x, this.y, ex, ey) < 15 + p.r * 0.8) return true;
      }
      void game;
    }
    return false;
  }

  /** Random point on the hull — used for the death explosion chain. */
  randomPoint(): { x: number; y: number } {
    if (this.kind === 'serpent' && this.segments.length) {
      const s = pick([{ x: this.x, y: this.y }, ...this.segments]);
      return { x: s.x + rand(-14, 14), y: s.y + rand(-14, 14) };
    }
    const spread = this.kind === 'mothership' ? 180 : 90;
    return { x: this.x + rand(-spread, spread), y: this.y + rand(-50, 50) };
  }

  // ---- drawing ----------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const color = this.color();
    const stroke = this.flash > 0 ? '#ffffff' : color;

    if (this.kind === 'mothership') this.drawMothership(ctx, game, stroke);
    else if (this.kind === 'serpent') this.drawSerpent(ctx, stroke);
    else this.drawCore(ctx, game, stroke);
  }

  private drawMothership(ctx: CanvasRenderingContext2D, game: Game, stroke: string): void {
    const hw = Math.min(game.width * 0.26, 210);

    // sweep beam
    if (this.beamState === 1) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.abs(Math.sin(this.t * 18)) * 0.35;
      ctx.strokeStyle = '#ff2040';
      ctx.lineWidth = this.beamW;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      ctx.moveTo(this.beamX, this.y + 30);
      ctx.lineTo(this.beamX, game.height);
      ctx.stroke();
      ctx.restore();
    } else if (this.beamState === 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const w = this.beamW * (0.9 + Math.sin(this.t * 40) * 0.1);
      const grad = ctx.createLinearGradient(this.beamX - w, 0, this.beamX + w, 0);
      grad.addColorStop(0, '#ff204000');
      grad.addColorStop(0.5, '#ff4060');
      grad.addColorStop(1, '#ff204000');
      ctx.fillStyle = grad;
      ctx.fillRect(this.beamX - w, this.y + 20, w * 2, game.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(this.beamX - 4, this.y + 20, 8, game.height);
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, this.x, this.y, hw * 1.1, '#39ff88', 0.35 + this.flash * 3);
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    // hull
    ctx.fillStyle = '#0a1a14';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, 42, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // dome
    ctx.beginPath();
    ctx.ellipse(0, -22, hw * 0.4, 26, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    // running lights
    for (let i = -3; i <= 3; i++) {
      const lx = i * hw * 0.27;
      const on = Math.sin(this.t * 5 + i) > 0;
      ctx.fillStyle = on ? '#7cffcb' : '#1c4433';
      ctx.beginPath();
      ctx.arc(lx, 14, 5, 0, TAU);
      ctx.fill();
    }
    // weak core — glows
    const pulse = 0.6 + Math.sin(this.t * 6) * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, 0, 12, 40 * pulse + 20, '#ffffff', 0.7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.arc(0, 12, 14 + pulse * 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawSerpent(ctx: CanvasRenderingContext2D, stroke: string): void {
    // body, tail first so the head overlaps
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      const r = 17 - i * 0.7;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, s.x, s.y, r * 2, '#b967ff', 0.3);
      ctx.restore();
      ctx.fillStyle = '#150a24';
      ctx.strokeStyle = i % 2 === 0 ? stroke : '#7a3fc0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(6, r), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    // head
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, this.x, this.y, 55, '#ff5df1', 0.5 + this.flash * 3);
    ctx.restore();
    ctx.save();
    ctx.translate(this.x, this.y);
    const next = this.segments[0];
    ctx.rotate(angleTo(next.x, next.y, this.x, this.y) + Math.PI / 2);
    ctx.fillStyle = '#1a0a2e';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(20, 6);
    ctx.lineTo(12, 22);
    ctx.lineTo(-12, 22);
    ctx.lineTo(-20, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#ff5df1';
    ctx.beginPath();
    ctx.arc(-8, -2, 4, 0, TAU);
    ctx.arc(8, -2, 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawCore(ctx: CanvasRenderingContext2D, game: Game, stroke: string): void {
    // beams
    if (this.beamState > 0) {
      for (const dir of [1, -1]) {
        const a = this.coreBeamA * dir + (dir === -1 ? Math.PI : 0);
        const ex = this.x + Math.cos(a) * 1500;
        const ey = this.y + Math.sin(a) * 1500;
        ctx.save();
        if (this.beamState === 1) {
          ctx.globalAlpha = 0.25 + Math.abs(Math.sin(this.t * 18)) * 0.3;
          ctx.strokeStyle = '#ff2040';
          ctx.lineWidth = 4;
          ctx.setLineDash([14, 10]);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = '#ff6080';
          ctx.lineWidth = 26 + Math.sin(this.t * 40) * 4;
          ctx.lineCap = 'round';
        }
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (this.beamState === 2) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    const exposed = !this.podsAlive();

    // core
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, this.x, this.y, 90, exposed ? '#ffffff' : '#ff9f1c', (exposed ? 0.75 : 0.4) + this.flash * 3);
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.t * 0.4);
    ctx.fillStyle = '#241206';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const rr = i % 2 === 0 ? 46 : 38;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const pulse = 0.7 + Math.sin(this.t * (exposed ? 10 : 4)) * 0.3;
    ctx.fillStyle = exposed ? '#ffffff' : '#ff9f1c';
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(0, 0, exposed ? 22 : 16, 0, TAU);
    ctx.fill();
    ctx.restore();

    // orbit track
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 95, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // pods
    for (const pod of this.pods) {
      if (pod.dead) continue;
      const pos = this.podPos(pod);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, pos.x, pos.y, 30, '#ffd23f', 0.5);
      ctx.restore();
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(this.podSpin * 2);
      ctx.fillStyle = '#241a06';
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.fillRect(-13, -13, 26, 26);
      ctx.strokeRect(-13, -13, 26, 26);
      const frac = clamp(pod.hp / pod.maxHp, 0, 1);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(-10, 8, 20 * frac, 3);
      ctx.restore();
    }
    void game;
  }
}
