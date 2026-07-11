import type Game from '../Game';
import { Enemy, type EnemyKind } from '../entities/Enemy';
import { clamp, rand } from '../utils/math';

interface Spawn {
  t: number;
  fn: (g: Game) => void;
}

export class WaveManager {
  wave = 0;
  private timer = 0;
  private queue: Spawn[] = [];

  spawningDone(): boolean {
    return this.queue.length === 0;
  }

  /** Build the timed spawn schedule for a (non-boss) wave. */
  startWave(n: number, game: Game): void {
    this.wave = n;
    this.timer = 0;
    this.queue = [];
    const w = game.width;

    const add = (t: number, fn: (g: Game) => void) => this.queue.push({ t, fn });

    const formation = (t0: number, kind: EnemyKind, rows: number, cols: number, y0: number) => {
      const spacing = Math.min(56, (w - 90) / Math.max(1, cols - 1));
      const startX = w / 2 - ((cols - 1) * spacing) / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = startX + c * spacing;
          const y = y0 + r * 46;
          add(t0 + c * 0.07 + r * 0.15, (g) => g.enemies.push(new Enemy(kind, x, y, n)));
        }
      }
    };

    const scatter = (t0: number, kind: EnemyKind, count: number, yMin: number, yMax: number, gap = 0.35) => {
      for (let i = 0; i < count; i++) {
        const x = rand(50, w - 50);
        const y = rand(yMin, yMax);
        add(t0 + i * gap, (g) => g.enemies.push(new Enemy(kind, x, y, n)));
      }
    };

    const swarmStream = (t0: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 0.25 : 0.75;
        const x = w * side + rand(-60, 60);
        add(t0 + i * 0.14, (g) => g.enemies.push(new Enemy('swarm', x, -20 - (i % 4) * 18, n)));
      }
    };

    // --- composition scales with wave number ---
    const rows = clamp(1 + Math.floor(n / 3), 1, 3);
    const cols = clamp(4 + Math.floor(n / 2), 5, 9);
    formation(0.4, 'grunt', rows, cols, 80);

    if (n >= 6) {
      const shields = Math.min(4, Math.floor(n / 3) - 1);
      scatter(1.2, 'shield', shields, 130, 170, 0.25);
    }
    if (n >= 3) {
      const shooters = Math.min(4, 1 + Math.floor((n - 1) / 3));
      scatter(2.2, 'shooter', shooters, 140, 230, 0.4);
    }
    if (n >= 2) {
      const divers = Math.min(6, 1 + Math.floor(n / 2));
      scatter(3.4, 'diver', divers, 60, 110, 0.5);
    }
    if (n >= 7) {
      const bombers = 1 + (n >= 11 ? 1 : 0);
      for (let i = 0; i < bombers; i++) {
        const fromLeft = i % 2 === 0;
        add(4.2 + i * 2, (g) => g.enemies.push(
          new Enemy('bomber', fromLeft ? -25 : g.width + 25, rand(90, 150), n),
        ));
      }
    }
    if (n >= 4) {
      const splitters = Math.min(3, Math.floor(n / 4));
      scatter(5.2, 'splitter', splitters, 60, 100, 0.6);
    }
    if (n >= 4) swarmStream(6.4, 8 + Math.min(n, 12));
    if (n >= 8) {
      const lasers = Math.min(3, Math.floor((n - 5) / 3));
      scatter(7.4, 'laser', lasers, 120, 150, 0.8);
    }

    // mini-boss escort on the x3 waves
    if (n % 5 === 3 && n >= 3) {
      add(8.5, (g) => {
        g.enemies.push(new Enemy('elite', g.width / 2, 150, n));
        g.addText(g.width / 2, g.height * 0.35, 'ELITE DETECTED', '#ff5df1', 24);
        g.audio.bossWarning();
      });
    }

    // late reinforcement wave keeps the pressure on
    if (n >= 5) formation(13, 'grunt', 1, Math.min(7, cols), 70);

    this.queue.sort((a, b) => a.t - b.t);
  }

  update(dt: number, game: Game): void {
    this.timer += dt;
    while (this.queue.length && this.queue[0].t <= this.timer) {
      const s = this.queue.shift()!;
      s.fn(game);
    }
  }

  reset(): void {
    this.wave = 0;
    this.timer = 0;
    this.queue = [];
  }
}
