import type Game from '../Game';
import { drawGlow } from '../utils/gfx';
import { angleTo, dist2, rand, TAU } from '../utils/math';

export type BulletKind =
  | 'laser' | 'plasma' | 'rocket' | 'chain' | 'charge' // player
  | 'orb' | 'mine' | 'shard';                          // enemy

export interface BulletOpts {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  r?: number;
  damage?: number;
  kind?: BulletKind;
  color?: string;
  friendly?: boolean;
  pierce?: number;
  life?: number;
  fuse?: number;
  aoe?: number;
  chain?: number;
}

export class Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  kind: BulletKind;
  color: string;
  friendly: boolean;
  pierce: number;
  life: number;
  fuse: number;
  aoe: number;
  chain: number;
  dead = false;
  t = 0;
  /** Enemies already damaged by this piercing bullet. */
  hitSet: Set<object> | null = null;

  private trailT = 0;

  constructor(o: BulletOpts) {
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.r = o.r ?? 4;
    this.damage = o.damage ?? 10;
    this.kind = o.kind ?? 'laser';
    this.color = o.color ?? '#7df9ff';
    this.friendly = o.friendly ?? true;
    this.pierce = o.pierce ?? 0;
    this.life = o.life ?? 4;
    this.fuse = o.fuse ?? 0;
    this.aoe = o.aoe ?? 0;
    this.chain = o.chain ?? 0;
    if (this.pierce > 0) this.hitSet = new Set();
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
      return;
    }

    if (this.kind === 'rocket') this.steerRocket(dt, game);

    if (this.kind === 'mine') {
      this.vy *= 1 - Math.min(1, 1.4 * dt); // drift to a slow hover
      this.fuse -= dt;
      if (this.fuse <= 0) {
        this.detonateMine(game);
        return;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // trails
    this.trailT -= dt;
    if (this.trailT <= 0) {
      if (this.kind === 'rocket') {
        game.particles.trail(this.x, this.y, '#ffb35c', 3);
        this.trailT = 0.02;
      } else if (this.kind === 'plasma' || this.kind === 'charge') {
        game.particles.trail(this.x, this.y, this.color, this.r * 0.5);
        this.trailT = 0.03;
      }
    }

    const m = 40;
    if (this.x < -m || this.x > game.width + m || this.y < -m || this.y > game.height + m) {
      this.dead = true;
    }
  }

  private steerRocket(dt: number, game: Game): void {
    let tx = 0;
    let ty = 0;
    let best = 340 * 340;
    for (const e of game.enemies) {
      if (e.dead) continue;
      const d = dist2(this.x, this.y, e.x, e.y);
      if (d < best) {
        best = d;
        tx = e.x;
        ty = e.y;
      }
    }
    if (game.boss && !game.boss.dead) {
      const d = dist2(this.x, this.y, game.boss.x, game.boss.y);
      if (d < best) {
        best = d;
        tx = game.boss.x;
        ty = game.boss.y;
      }
    }
    if (!tx && !ty) return;
    const want = angleTo(this.x, this.y, tx, ty);
    const cur = Math.atan2(this.vy, this.vx);
    let diff = want - cur;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    const turn = Math.max(-4 * dt, Math.min(4 * dt, diff));
    const speed = Math.hypot(this.vx, this.vy);
    this.vx = Math.cos(cur + turn) * speed;
    this.vy = Math.sin(cur + turn) * speed;
  }

  private detonateMine(game: Game): void {
    this.dead = true;
    game.particles.explosion(this.x, this.y, '#ff5c5c', 18, 200, 3);
    game.particles.ring(this.x, this.y, '#ff5c5c', 320);
    game.audio.explosion(0);
    game.shake(4);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rand(-0.1, 0.1);
      game.enemyBullets.push(new Bullet({
        x: this.x, y: this.y,
        vx: Math.cos(a) * 175,
        vy: Math.sin(a) * 175,
        r: 4, damage: 8, kind: 'shard', color: '#ff8c66', friendly: false, life: 3,
      }));
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { x, y, color } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    switch (this.kind) {
      case 'laser': {
        const a = Math.atan2(this.vy, this.vx);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        drawGlow(ctx, x, y, this.r * 4, color, 0.9);
        ctx.lineCap = 'round';
        // wide faded streak trailing behind
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - ca * 22, y - sa * 22);
        ctx.lineTo(x + ca * 6, y + sa * 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - ca * 9, y - sa * 9);
        ctx.lineTo(x + ca * 9, y + sa * 9);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        break;
      }
      case 'plasma':
      case 'charge': {
        const pulse = 1 + Math.sin(this.t * 24) * 0.12;
        drawGlow(ctx, x, y, this.r * 4 * pulse, color, 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, this.r * 0.55 * pulse, 0, TAU);
        ctx.fill();
        break;
      }
      case 'rocket': {
        const a = Math.atan2(this.vy, this.vx);
        drawGlow(ctx, x, y, 12, '#ff6b35', 0.8);
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = '#ffd9c2';
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, 4);
        ctx.lineTo(-5, -4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'chain': {
        drawGlow(ctx, x, y, 12, color, 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'mine': {
        const blink = this.fuse < 1.2 ? (Math.sin(this.t * 24) > 0 ? 1 : 0.3) : 0.6 + Math.sin(this.t * 6) * 0.2;
        drawGlow(ctx, x, y, 14, '#ff5c5c', blink);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#3a1020';
        ctx.strokeStyle = '#ff5c5c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + this.t;
          const rr = i % 2 === 0 ? this.r + 3 : this.r - 1;
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 92, 92, ${blink})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, TAU);
        ctx.fill();
        break;
      }
      default: { // orb / shard — enemy fire
        const pulse = 1 + Math.sin(this.t * 16) * 0.15;
        drawGlow(ctx, x, y, this.r * 3.2 * pulse, color, 0.95);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, this.r * 0.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
