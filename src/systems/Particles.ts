import { rand, TAU } from '../utils/math';
import { drawGlow } from '../utils/gfx';

type ParticleType = 'dot' | 'spark' | 'ring';

interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  drag: number;
  grow: number;
}

const MAX_PARTICLES = 900;

export class Particles {
  list: Particle[] = [];

  private push(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  explosion(x: number, y: number, color: string, count = 26, power = 240, size = 3): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.15, 1) * power;
      this.push({
        type: Math.random() < 0.55 ? 'dot' : 'spark',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.3, 0.9),
        maxLife: 0.9,
        size: rand(size * 0.5, size * 1.6),
        color,
        drag: 2.4,
        grow: 0,
      });
    }
  }

  sparks(x: number, y: number, color: string, count = 8, baseAngle = -Math.PI / 2, spread = TAU): void {
    for (let i = 0; i < count; i++) {
      const a = baseAngle + rand(-spread / 2, spread / 2);
      const sp = rand(120, 420);
      this.push({
        type: 'spark',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.12, 0.35),
        maxLife: 0.35,
        size: rand(1.5, 3),
        color,
        drag: 3.5,
        grow: 0,
      });
    }
  }

  ring(x: number, y: number, color: string, speed = 420, width = 3): void {
    this.push({
      type: 'ring',
      x, y,
      vx: 0,
      vy: 0,
      life: 0.55,
      maxLife: 0.55,
      size: 6,
      color,
      drag: 0,
      grow: speed,
    });
    // width folded into size render; keep param for call-site clarity
    void width;
  }

  trail(x: number, y: number, color: string, size = 2.5, vx = 0, vy = 0): void {
    this.push({
      type: 'dot',
      x: x + rand(-2, 2),
      y: y + rand(-2, 2),
      vx, vy,
      life: rand(0.15, 0.35),
      maxLife: 0.35,
      size,
      color,
      drag: 1,
      grow: 0,
    });
  }

  update(dt: number): void {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      const d = 1 - Math.min(1, p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.maxLife);
      if (p.type === 'dot') {
        drawGlow(ctx, p.x, p.y, p.size * 3, p.color, a);
      } else if (p.type === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear(): void {
    this.list.length = 0;
  }
}
