import type Game from '../Game';
import { Bullet } from './Bullet';
import { drawGlow } from '../utils/gfx';
import { angleDiff, angleTo, clamp, rand, TAU } from '../utils/math';

export type EnemyKind =
  | 'grunt' | 'diver' | 'shooter' | 'splitter' | 'mini'
  | 'shield' | 'bomber' | 'laser' | 'swarm' | 'elite';

interface Stats { hp: number; r: number; score: number; color: string; descend: number }

const STATS: Record<EnemyKind, Stats> = {
  grunt:    { hp: 20,  r: 15, score: 100,  color: '#39ff88', descend: 13 },
  diver:    { hp: 16,  r: 13, score: 150,  color: '#ff9f1c', descend: 8 },
  shooter:  { hp: 34,  r: 16, score: 200,  color: '#ff4d6d', descend: 0 },
  splitter: { hp: 40,  r: 19, score: 250,  color: '#b967ff', descend: 26 },
  mini:     { hp: 8,   r: 9,  score: 50,   color: '#d59bff', descend: 0 },
  shield:   { hp: 46,  r: 17, score: 300,  color: '#26d8ff', descend: 10 },
  bomber:   { hp: 40,  r: 18, score: 300,  color: '#ffd23f', descend: 0 },
  laser:    { hp: 55,  r: 17, score: 400,  color: '#ff2975', descend: 0 },
  swarm:    { hp: 6,   r: 8,  score: 60,   color: '#7cffcb', descend: 0 },
  elite:    { hp: 420, r: 32, score: 2000, color: '#ff5df1', descend: 0 },
};

export class Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  r: number;
  hp: number;
  maxHp: number;
  score: number;
  color: string;
  dead = false;
  flash = 0;
  entering = true;

  /** Rotating shield orientation (shield bug). */
  shieldAngle = 0;
  /** 0 = roam/formation, 1 = act (dive / charge), 2 = firing beam. */
  state = 0;
  beamW = 22;

  private t = 0;
  private stateT = 0;
  private phase: number;
  private fireT: number;
  private vx = 0;
  private vy = 0;
  private diveDelay: number;
  private dir: number;
  private attackCycle = 0;
  private wave: number;
  private sm: number; // speed multiplier from wave scaling

  constructor(kind: EnemyKind, x: number, y: number, wave: number) {
    const s = STATS[kind];
    this.kind = kind;
    this.x = x;
    this.baseX = x;
    this.baseY = y;
    const inPlace = kind === 'bomber' || kind === 'swarm' || kind === 'mini';
    this.y = inPlace ? y : -40 - rand(0, 30);
    if (this.y >= y) this.entering = false;
    this.r = s.r;
    this.wave = wave;
    const hpMul = 1 + (wave - 1) * 0.1;
    this.hp = this.maxHp = Math.round(s.hp * hpMul);
    this.score = s.score;
    this.color = s.color;
    this.sm = Math.min(2.1, 1 + wave * 0.035);
    this.phase = rand(0, TAU);
    this.fireT = rand(1, 2.5);
    this.diveDelay = rand(1.2, 3.5);
    this.dir = x < 0 ? 1 : -1;
    if (kind === 'bomber') this.entering = false;
    if (kind === 'swarm' || kind === 'mini') this.entering = false;
  }

  update(dt: number, game: Game): void {
    this.flash = Math.max(0, this.flash - dt);

    if (this.entering) {
      this.y += 280 * dt;
      if (this.y >= this.baseY) {
        this.y = this.baseY;
        this.entering = false;
      }
      return;
    }

    this.t += dt;
    const p = game.player;
    const h = game.height;

    switch (this.kind) {
      case 'grunt':
      case 'shield': {
        const amp = 34 + 10 * Math.sin(this.phase * 3);
        this.baseY += STATS[this.kind].descend * this.sm * dt;
        this.x = this.baseX + Math.sin(this.t * 1.3 * this.sm + this.phase) * amp;
        this.y = this.baseY + Math.sin(this.t * 2 + this.phase) * 4;
        if (this.kind === 'shield') this.shieldAngle = this.t * 1.6 + this.phase;
        break;
      }
      case 'diver': {
        if (this.state === 0) {
          this.baseY += STATS.diver.descend * this.sm * dt;
          this.x = this.baseX + Math.sin(this.t * 1.5 + this.phase) * 30;
          this.y = this.baseY;
          if (this.t > this.diveDelay) {
            this.state = 1;
            this.vx = 0;
            this.vy = 120;
          }
        } else {
          const want = angleTo(this.x, this.y, p.x, p.y);
          const cur = Math.atan2(this.vy, this.vx);
          const diff = angleDiff(want, cur);
          const speed = Math.min(470 * this.sm, Math.hypot(this.vx, this.vy) + 700 * dt);
          const a = cur + clamp(diff, -2.4 * dt, 2.4 * dt);
          this.vx = Math.cos(a) * speed;
          this.vy = Math.sin(a) * speed;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          game.particles.trail(this.x, this.y - 8, this.color, 2);
          if (this.y > h + 40) {
            this.y = -30;
            this.baseY = 60;
            this.x = this.baseX = rand(40, game.width - 40);
            this.state = 0;
            this.t = 0;
            this.diveDelay = rand(0.8, 2.2);
          }
        }
        break;
      }
      case 'shooter': {
        if (this.y < this.baseY) {
          this.y += 95 * this.sm * dt;
        } else {
          this.x = this.baseX + Math.sin(this.t * 0.9 + this.phase) * 70;
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireVolley(game);
            this.fireT = rand(1.6, 2.5) / Math.min(1.8, 1 + this.wave * 0.04);
          }
        }
        break;
      }
      case 'splitter': {
        this.baseY += STATS.splitter.descend * this.sm * dt;
        this.x = this.baseX + Math.sin(this.t * 1.6 + this.phase) * 50;
        this.y = this.baseY;
        break;
      }
      case 'mini': {
        const dx = p.x - this.x;
        this.vx = clamp(this.vx + Math.sign(dx) * 420 * dt, -230 * this.sm, 230 * this.sm);
        this.x += this.vx * dt;
        this.y += (105 + Math.sin(this.t * 6 + this.phase) * 35) * this.sm * dt;
        break;
      }
      case 'bomber': {
        this.x += 125 * this.sm * this.dir * dt;
        this.y = this.baseY + Math.sin(this.t * 2 + this.phase) * 18;
        if (this.x > game.width + 30) { this.dir = -1; this.baseY += 34; }
        if (this.x < -30) { this.dir = 1; this.baseY += 34; }
        this.fireT -= dt;
        if (this.fireT <= 0 && this.x > 30 && this.x < game.width - 30) {
          this.fireT = 1.7;
          game.enemyBullets.push(new Bullet({
            x: this.x, y: this.y + 12, vy: 75, r: 8,
            kind: 'mine', color: '#ff5c5c', friendly: false, life: 30, fuse: rand(2.8, 3.6),
          }));
        }
        break;
      }
      case 'laser': {
        this.stateT += dt;
        if (this.state === 0) {
          // drift toward player x, settle at beam altitude
          this.x += clamp(p.x - this.x, -70 * dt, 70 * dt);
          this.y += clamp(this.baseY - this.y, -60 * dt, 60 * dt);
          if (this.stateT > 1.5) {
            this.state = 1;
            this.stateT = 0;
          }
        } else if (this.state === 1) {
          // charging — locked in place, telegraph drawn in draw()
          if (this.stateT > 1.15) {
            this.state = 2;
            this.stateT = 0;
            game.audio.zap();
          }
        } else {
          game.shake(1.5);
          if (this.stateT > 0.7) {
            this.state = 0;
            this.stateT = -rand(0.3, 1.2);
          }
        }
        break;
      }
      case 'swarm': {
        this.x = this.baseX + Math.sin(this.t * 2.6 + this.phase) * 70;
        this.y = this.baseY + this.t * 82 * this.sm;
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = 0.09;
          game.particles.trail(this.x, this.y - 6, this.color, 1.6);
        }
        break;
      }
      case 'elite': {
        if (this.y < this.baseY) {
          this.y += 110 * dt;
          break;
        }
        const enraged = this.hp < this.maxHp * 0.5;
        this.x = this.baseX + Math.sin(this.t * (enraged ? 0.9 : 0.6)) * Math.min(150, game.width * 0.22);
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = enraged ? 1.5 : 2.2;
          this.eliteAttack(game, enraged);
        }
        break;
      }
    }

    // keep waves clearable — wrap anything that slips off the bottom
    if (this.kind !== 'diver' && this.y > h + 60) {
      this.y = -40;
      this.baseY = -40;
      if (this.kind === 'swarm') this.t = 0;
    }
    this.x = clamp(this.x, -60, game.width + 60);
  }

  private fireVolley(game: Game): void {
    const p = game.player;
    const speed = Math.min(330, 175 + this.wave * 7);
    const n = this.wave >= 8 ? 3 : 1;
    const base = angleTo(this.x, this.y, p.x, p.y);
    for (let i = 0; i < n; i++) {
      const a = base + (n === 1 ? 0 : (i - (n - 1) / 2) * 0.22);
      game.enemyBullets.push(new Bullet({
        x: this.x, y: this.y + 10,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: 5, damage: 10, kind: 'orb', color: '#ff4d6d', friendly: false, life: 7,
      }));
    }
    game.particles.sparks(this.x, this.y + 10, '#ff4d6d', 4, Math.PI / 2, 1);
  }

  private eliteAttack(game: Game, enraged: boolean): void {
    const pattern = this.attackCycle++ % 3;
    const speed = Math.min(300, 160 + this.wave * 5);
    if (pattern === 0) {
      const n = enraged ? 18 : 13;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.t;
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          r: 5, damage: 10, kind: 'orb', color: this.color, friendly: false, life: 7,
        }));
      }
      game.audio.explosion(0);
    } else if (pattern === 1) {
      const p = game.player;
      const base = angleTo(this.x, this.y, p.x, p.y);
      const n = enraged ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.16;
        game.enemyBullets.push(new Bullet({
          x: this.x, y: this.y, vx: Math.cos(a) * speed * 1.25, vy: Math.sin(a) * speed * 1.25,
          r: 5, damage: 10, kind: 'orb', color: '#ff9f1c', friendly: false, life: 7,
        }));
      }
    } else {
      for (let i = 0; i < 2; i++) {
        game.enemies.push(new Enemy('mini', this.x + (i === 0 ? -30 : 30), this.y + 20, this.wave));
      }
      game.particles.sparks(this.x, this.y, this.color, 12);
    }
  }

  /** Shield bugs deflect shots arriving on the shielded side. */
  blocksShot(bx: number, by: number): boolean {
    if (this.kind !== 'shield') return false;
    const a = angleTo(this.x, this.y, bx, by);
    return Math.abs(angleDiff(a, this.shieldAngle)) < 1.05;
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const { x, y, r, color } = this;

    // laser eye telegraph + beam (under body)
    if (this.kind === 'laser' && this.state > 0) {
      ctx.save();
      if (this.state === 1) {
        const p = this.stateT / 1.15;
        ctx.globalAlpha = 0.25 + 0.4 * p * Math.abs(Math.sin(this.t * 20));
        ctx.strokeStyle = '#ff2975';
        ctx.lineWidth = 2 + p * 5;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.lineTo(x, game.height);
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        const w = this.beamW * (0.85 + Math.sin(this.t * 40) * 0.15);
        const grad = ctx.createLinearGradient(x - w, 0, x + w, 0);
        grad.addColorStop(0, '#ff297500');
        grad.addColorStop(0.5, '#ff2975');
        grad.addColorStop(1, '#ff297500');
        ctx.fillStyle = grad;
        ctx.fillRect(x - w, y, w * 2, game.height - y);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 3, y, 6, game.height - y);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, x, y, r * 2.2, color, 0.5 + this.flash * 3);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    const stroke = this.flash > 0 ? '#ffffff' : color;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = this.flash > 0 ? '#ffffff' : '#0a1024';
    ctx.lineWidth = 2;

    switch (this.kind) {
      case 'grunt': {
        ctx.rotate(Math.sin(this.t * 3 + this.phase) * 0.12);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = stroke;
        ctx.fillRect(-5, -3, 3, 3);
        ctx.fillRect(2, -3, 3, 3);
        break;
      }
      case 'diver': {
        const a = this.state === 1 ? Math.atan2(this.vy, this.vx) + Math.PI / 2 : Math.PI;
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.8, r * 0.7);
        ctx.lineTo(0, r * 0.3);
        ctx.lineTo(-r * 0.8, r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'shooter': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = stroke;
        ctx.fillRect(-2, r - 4, 4, 8); // gun barrel
        break;
      }
      case 'splitter': {
        const pulse = 1 + Math.sin(this.t * 5 + this.phase) * 0.12;
        ctx.beginPath();
        ctx.arc(0, 0, r * pulse, 0, TAU);
        ctx.fill();
        ctx.stroke();
        // inner blobs hint at the split
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(-r * 0.35, 0, r * 0.3, 0, TAU);
        ctx.arc(r * 0.35, 0, r * 0.3, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'mini': {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'shield': {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.85, 0, TAU);
        ctx.fill();
        ctx.stroke();
        // rotating shield arc
        ctx.strokeStyle = '#8ff4ff';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#26d8ff';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(0, 0, r + 5, this.shieldAngle - 1.05, this.shieldAngle + 1.05);
        ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      }
      case 'bomber': {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.25, r * 0.7, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff5c5c';
        ctx.beginPath();
        ctx.arc(0, r * 0.4, 3.5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'laser': {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        // the eye — glows hotter while charging
        const chargeGlow = this.state === 1 ? this.stateT / 1.15 : this.state === 2 ? 1 : 0.3;
        ctx.fillStyle = '#ff2975';
        ctx.beginPath();
        ctx.arc(0, 2, r * (0.3 + chargeGlow * 0.25), 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 2, r * 0.12, 0, TAU);
        ctx.fill();
        break;
      }
      case 'swarm': {
        ctx.rotate(Math.sin(this.t * 8 + this.phase) * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, r);
        ctx.lineTo(-r, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'elite': {
        ctx.rotate(Math.sin(this.t * 0.8) * 0.1);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const rr = i % 2 === 0 ? r : r * 0.72;
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.stroke();
        const core = 0.5 + Math.sin(this.t * 4) * 0.2;
        ctx.fillStyle = stroke;
        ctx.globalAlpha = core;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.35, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        // mini-boss hp arc
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (this.hp / this.maxHp));
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}
