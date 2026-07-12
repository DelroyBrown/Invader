import type Game from '../Game';
import { Bullet } from './Bullet';
import { drawGlow } from '../utils/gfx';
import { clamp, lerp, rand, TAU } from '../utils/math';

export type WeaponType =
  | 'laser' | 'double' | 'spread' | 'rapid'
  | 'plasma' | 'rockets' | 'chain' | 'charge';

export const WEAPONS: Record<WeaponType, { name: string; color: string }> = {
  laser:   { name: 'PULSE LASER',    color: '#7df9ff' },
  double:  { name: 'TWIN CANNON',    color: '#9dff57' },
  spread:  { name: 'SPREAD SHOT',    color: '#ffd23f' },
  rapid:   { name: 'VULCAN',         color: '#ff9f1c' },
  plasma:  { name: 'PLASMA LANCE',   color: '#b967ff' },
  rockets: { name: 'HOMING ROCKETS', color: '#ff6b35' },
  chain:   { name: 'TESLA ARC',      color: '#aef6ff' },
  charge:  { name: 'NOVA CANNON',    color: '#ff2975' },
};

interface Ghost { x: number; y: number; t: number; tilt: number }

export class Player {
  x: number;
  y: number;
  r = 13;
  hp = 100;
  maxHp = 100;
  alive = true;

  weapon: WeaponType = 'laser';
  weaponLevel = 1;
  bombs = 2;

  shieldTime = 0;
  invuln = 0;
  /** Continuous time spent inside a beam — damage lands only past the grace window. */
  beamExposure = 0;
  rapidTime = 0;
  multiTime = 0;
  slowTime = 0;
  magnetTime = 0;

  private fireT = 0;
  private dashT = 0;
  dashCd = 0;
  private dashVx = 1;
  private dashVy = 0;
  private lastDir = 1;
  private moveY = 0;
  private tilt = 0;
  private recoil = 0;
  private t = 0;
  private engineT = 0;
  private ghosts: Ghost[] = [];

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  update(dt: number, game: Game, canFire: boolean): void {
    if (!this.alive) return;
    this.t += dt;

    // ---- movement (full 2D, last-pressed direction wins per axis) ----
    let dx = game.input.axisX();
    let dy = game.input.axisY();

    const mp = game.input.isTouch ? game.input.movePointer(game.touchButtons()) : null;
    if (mp) {
      // relative drag steering — the ship mirrors finger movement (amplified),
      // so a thumb resting anywhere never covers the action and taps far away
      // never teleport the ship
      const sens = 1.75;
      this.x += mp.dx * sens;
      this.y += mp.dy * sens;
      dx = clamp(mp.dx * 0.35, -1, 1);
      dy = clamp(mp.dy * 0.35, -1, 1);
    } else if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      this.x += (dx / len) * 430 * dt;
      this.y += (dy / len) * 400 * dt;
    }
    if (dx !== 0) this.lastDir = Math.sign(dx);
    this.moveY = dy;
    this.tilt = lerp(this.tilt, dx * 0.28, Math.min(1, 12 * dt));

    // ---- dash ----
    this.dashCd = Math.max(0, this.dashCd - dt);
    if ((game.input.wasPressed('dash') || game.consumeDashRequest()) && this.dashCd <= 0) {
      this.dashT = 0.15;
      this.dashCd = 1.1;
      let vx = dx;
      let vy = dy;
      if (vx === 0 && vy === 0) vx = this.lastDir;
      const len = Math.hypot(vx, vy);
      this.dashVx = vx / len;
      this.dashVy = vy / len;
      this.invuln = Math.max(this.invuln, 0.3);
      game.audio.dash();
      game.particles.sparks(this.x, this.y, '#7df9ff', 10, Math.atan2(-this.dashVy, -this.dashVx), 0.9);
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.x += this.dashVx * 1500 * dt;
      this.y += this.dashVy * 1500 * dt;
      this.ghosts.push({ x: this.x, y: this.y, t: 0.25, tilt: this.tilt });
    }

    this.x = clamp(this.x, this.r + 8, game.width - this.r - 8);
    this.y = clamp(this.y, game.height * 0.35, game.height - 46);

    // ---- ghosts / timers ----
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].t -= dt;
      if (this.ghosts[i].t <= 0) this.ghosts.splice(i, 1);
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.rapidTime = Math.max(0, this.rapidTime - dt);
    this.multiTime = Math.max(0, this.multiTime - dt);
    this.slowTime = Math.max(0, this.slowTime - dt);
    this.magnetTime = Math.max(0, this.magnetTime - dt);
    this.recoil = Math.max(0, this.recoil - 30 * dt);

    // ---- firing ----
    this.fireT -= dt;
    const wantFire = game.input.isDown('shoot') || game.input.isTouch;
    if (canFire && wantFire && this.fireT <= 0) this.fire(game);

    // ---- engine flame ----
    this.engineT -= dt;
    if (this.engineT <= 0) {
      this.engineT = 0.025;
      game.particles.trail(
        this.x + rand(-3, 3), this.y + 16, Math.random() < 0.7 ? '#39c0ff' : '#ff9f1c',
        rand(1.5, 3), -this.tilt * 60, rand(80, 160),
      );
    }
  }

  private spawn(game: Game, b: Bullet): void {
    game.playerBullets.push(b);
  }

  private fire(game: Game): void {
    const lvl = this.weaponLevel;
    const px = this.x;
    const py = this.y - 18;
    const color = WEAPONS[this.weapon].color;
    let cd = 0.16;

    switch (this.weapon) {
      case 'laser': {
        cd = 0.15;
        const dmg = 10 + 3 * (lvl - 1);
        if (lvl >= 3) {
          this.spawn(game, new Bullet({ x: px - 6, y: py, vy: -920, damage: dmg, color }));
          this.spawn(game, new Bullet({ x: px + 6, y: py, vy: -920, damage: dmg, color }));
        } else {
          this.spawn(game, new Bullet({ x: px, y: py, vy: -920, damage: dmg, color }));
        }
        break;
      }
      case 'double': {
        cd = 0.17;
        const dmg = 8 + 2 * (lvl - 1);
        this.spawn(game, new Bullet({ x: px - 9, y: py, vy: -900, damage: dmg, color }));
        this.spawn(game, new Bullet({ x: px + 9, y: py, vy: -900, damage: dmg, color }));
        if (lvl >= 3) this.spawn(game, new Bullet({ x: px, y: py - 6, vy: -940, damage: dmg, color }));
        break;
      }
      case 'spread': {
        cd = 0.24;
        const n = 2 + lvl;
        const total = 0.5 + 0.14 * lvl;
        const dmg = 7 + 2 * (lvl - 1);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * total);
          this.spawn(game, new Bullet({
            x: px, y: py, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800, damage: dmg, color,
          }));
        }
        break;
      }
      case 'rapid': {
        cd = 0.075;
        const a = -Math.PI / 2 + rand(-0.05, 0.05);
        this.spawn(game, new Bullet({
          x: px + rand(-3, 3), y: py,
          vx: Math.cos(a) * 950, vy: Math.sin(a) * 950,
          damage: 4 + lvl, color,
        }));
        break;
      }
      case 'plasma': {
        cd = 0.32;
        this.spawn(game, new Bullet({
          x: px, y: py, vy: -700,
          r: 6 + lvl, damage: 14 + 5 * (lvl - 1),
          kind: 'plasma', color, pierce: 2 + 2 * lvl,
        }));
        break;
      }
      case 'rockets': {
        cd = 0.5 - 0.06 * lvl;
        for (let i = 0; i < lvl; i++) {
          const off = lvl === 1 ? 0 : (i - (lvl - 1) / 2) * 14;
          this.spawn(game, new Bullet({
            x: px + off, y: py, vx: off * 4, vy: -520,
            r: 5, damage: 18, kind: 'rocket', color, aoe: 55 + 10 * lvl,
          }));
        }
        break;
      }
      case 'chain': {
        cd = 0.26;
        this.spawn(game, new Bullet({
          x: px, y: py, vy: -880,
          r: 5, damage: 8 + 2 * lvl, kind: 'chain', color, chain: 1 + lvl,
        }));
        break;
      }
      case 'charge': {
        cd = 0.95 - 0.1 * lvl;
        this.spawn(game, new Bullet({
          x: px, y: py, vy: -620,
          r: 11, damage: 40 + 15 * (lvl - 1),
          kind: 'charge', color, pierce: 3, aoe: 45 + 10 * lvl,
        }));
        game.shake(2);
        break;
      }
    }

    this.fireT = cd * (this.rapidTime > 0 ? 0.55 : 1);
    this.recoil = 4;
    game.particles.sparks(px, py, color, 3, -Math.PI / 2, 0.8);
    game.audio.shoot(this.weapon);
  }

  /** Returns true if hull damage was actually applied. */
  takeDamage(dmg: number, game: Game): boolean {
    if (!this.alive || this.invuln > 0 || this.dashT > 0) return false;

    if (this.shieldTime > 0) {
      this.shieldTime = 0;
      this.invuln = 0.9;
      game.waveDamageTaken++;
      game.particles.ring(this.x, this.y, '#26d8ff', 500);
      game.particles.sparks(this.x, this.y, '#26d8ff', 16);
      game.audio.shieldBreak();
      game.shake(8);
      game.addText(this.x, this.y - 30, 'SHIELD DOWN', '#26d8ff', 14);
      return false;
    }

    this.hp -= dmg;
    this.invuln = 1.3;
    game.waveDamageTaken++;
    game.combo = 0;
    try { navigator.vibrate?.(60); } catch { /* unsupported */ }
    game.shake(14);
    game.flash('#ff2040', 0.18);
    game.audio.playerHit();
    game.particles.explosion(this.x, this.y, '#ff5c5c', 18, 260, 3);

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      game.onPlayerDeath();
    }
    return true;
  }

  heal(amount: number, game: Game): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    game.particles.sparks(this.x, this.y, '#3dff8c', 12);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.alive) return;

    // dash afterimages
    for (const g of this.ghosts) {
      ctx.save();
      ctx.globalAlpha = g.t * 2.4;
      ctx.translate(g.x, g.y);
      ctx.rotate(g.tilt);
      this.shipPath(ctx);
      ctx.strokeStyle = '#7df9ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, this.x, this.y + 14, 16 + Math.sin(this.t * 30) * 3, '#39c0ff', 0.8);
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y + this.recoil);
    ctx.rotate(this.tilt);

    if (this.invuln > 0 && Math.floor(this.t * 20) % 2 === 0) ctx.globalAlpha = 0.4;

    // engine flames — stretch when climbing, shrink when descending
    const thrust = this.moveY < 0 ? 6 : this.moveY > 0 ? -3 : 0;
    const flame = 10 + Math.sin(this.t * 42) * 3 + thrust;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fx of [-4.5, 4.5]) {
      ctx.fillStyle = '#39c0ff';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(fx - 2.6, 11);
      ctx.lineTo(fx, 11 + flame + Math.sin(this.t * 60 + fx) * 2);
      ctx.lineTo(fx + 2.6, 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(fx - 1.1, 11);
      ctx.lineTo(fx, 11 + flame * 0.55);
      ctx.lineTo(fx + 1.1, 11);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (this.invuln > 0 && Math.floor(this.t * 20) % 2 === 0) ctx.globalAlpha = 0.4;

    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 14;
    this.shipPath(ctx);
    const hull = ctx.createLinearGradient(0, -17, 0, 12);
    hull.addColorStop(0, '#274a8a');
    hull.addColorStop(0.55, '#12245c');
    hull.addColorStop(1, '#0a1230');
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.strokeStyle = '#7df9ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // spine light
    ctx.strokeStyle = 'rgba(125, 249, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(0, 8);
    ctx.stroke();

    // cockpit
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, -4, 3, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    // wing tips
    ctx.fillStyle = '#ff2975';
    ctx.fillRect(-14, 6, 3, 5);
    ctx.fillRect(11, 6, 3, 5);
    ctx.restore();

    // shield bubble
    if (this.shieldTime > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const flicker = this.shieldTime < 2 ? 0.3 + Math.abs(Math.sin(this.t * 14)) * 0.5 : 0.75;
      ctx.globalAlpha = flicker;
      ctx.strokeStyle = '#26d8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 26 + Math.sin(this.t * 8) * 2, 0, TAU);
      ctx.stroke();
      drawGlow(ctx, this.x, this.y, 34, '#26d8ff', flicker * 0.25);
      ctx.restore();
    }
  }

  private shipPath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(5, -4);
    ctx.lineTo(14, 8);
    ctx.lineTo(6, 6);
    ctx.lineTo(4, 12);
    ctx.lineTo(-4, 12);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-14, 8);
    ctx.lineTo(-5, -4);
    ctx.closePath();
  }
}
