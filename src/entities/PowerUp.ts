import type Game from '../Game';
import type { WeaponType } from './Player';
import { drawGlow } from '../utils/gfx';
import { dist2, pick, rand, TAU } from '../utils/math';

export type PowerUpType =
  | 'health' | 'shield' | 'weapon' | 'upgrade' | 'rapid'
  | 'bomb' | 'multi' | 'slow' | 'magnet';

export const POWERUP_INFO: Record<PowerUpType, { label: string; color: string; name: string }> = {
  health:  { label: '+',  color: '#3dff8c', name: 'HULL REPAIR' },
  shield:  { label: 'S',  color: '#26d8ff', name: 'SHIELD' },
  weapon:  { label: 'W',  color: '#ffdd44', name: 'NEW WEAPON' },
  upgrade: { label: '^',  color: '#c86bff', name: 'UPGRADE' },
  rapid:   { label: 'R',  color: '#ff9a2e', name: 'OVERDRIVE' },
  bomb:    { label: 'B',  color: '#ff5c5c', name: 'NOVA BOMB' },
  multi:   { label: 'x2', color: '#ffd700', name: 'SCORE x2' },
  slow:    { label: 'T',  color: '#7aa8ff', name: 'TIME WARP' },
  magnet:  { label: 'M',  color: '#ff5df1', name: 'MAGNET' },
};

const DROP_TABLE: [PowerUpType, number][] = [
  ['health', 15], ['shield', 12], ['weapon', 18], ['upgrade', 11],
  ['rapid', 10], ['bomb', 8], ['multi', 9], ['slow', 7], ['magnet', 10],
];

export function randomPowerUpType(): PowerUpType {
  const total = DROP_TABLE.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [type, w] of DROP_TABLE) {
    roll -= w;
    if (roll <= 0) return type;
  }
  return 'health';
}

const WEAPON_POOL: WeaponType[] = [
  'laser', 'double', 'spread', 'rapid', 'plasma', 'rockets', 'chain', 'charge',
];

export class PowerUp {
  x: number;
  y: number;
  r = 13;
  type: PowerUpType;
  weapon: WeaponType;
  t = 0;
  dead = false;
  private vx = 0;
  private vy = 70;
  private trailT = 0;

  constructor(x: number, y: number, type?: PowerUpType) {
    this.x = x;
    this.y = y;
    this.type = type ?? randomPowerUpType();
    this.weapon = pick(WEAPON_POOL);
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    const p = game.player;

    // magnet powerup pulls from anywhere; everything has a gentle attract
    const pullRange = p.magnetTime > 0 ? Number.MAX_SAFE_INTEGER : 130 * 130;
    if (p.alive && dist2(this.x, this.y, p.x, p.y) < pullRange) {
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      const force = p.magnetTime > 0 ? 950 : 520;
      this.vx += Math.cos(a) * force * dt;
      this.vy += Math.sin(a) * force * dt;
    } else {
      this.vx *= 1 - Math.min(1, 2 * dt);
      this.vy += (70 - this.vy) * Math.min(1, 2 * dt);
    }

    this.x += this.vx * dt + Math.sin(this.t * 3) * 14 * dt;
    this.y += this.vy * dt;

    // sparkle wake so drops read from across the screen
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.07;
      game.particles.trail(
        this.x + rand(-7, 7), this.y + rand(-7, 7),
        POWERUP_INFO[this.type].color, rand(1.4, 2.4),
      );
    }

    if (this.y > game.height + 30) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const info = POWERUP_INFO[this.type];
    const color = info.color;
    const pulse = 1 + Math.sin(this.t * 5) * 0.18;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, this.x, this.y, 30 * pulse, color, 0.9);
    ctx.restore();

    // rotating beacon ring
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.t * 1.6);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, this.r + 8, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.t * 2) * 0.15);
    // hex capsule
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const px = Math.cos(a) * this.r * pulse;
      const py = Math.sin(a) * this.r * pulse;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#0a1024';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `700 ${this.type === 'multi' ? 10 : 13}px Orbitron, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.label, 0, 1);
    ctx.restore();
  }
}
