import type Game from '../Game';
import type { Enemy } from '../entities/Enemy';
import type { Bullet } from '../entities/Bullet';
import { dist2 } from '../utils/math';

export function handleCollisions(game: Game, dt: number): void {
  playerBulletsVsEnemies(game);
  if (game.boss) playerBulletsVsBoss(game);
  playerBulletsVsMines(game);
  if (game.player.alive) {
    enemyBulletsVsPlayer(game);
    enemiesVsPlayer(game);
    beamsVsPlayer(game, dt);
    powerupsVsPlayer(game);
  }
}

function playerBulletsVsEnemies(game: Game): void {
  for (const b of game.playerBullets) {
    if (b.dead) continue;
    for (const e of game.enemies) {
      if (e.dead || e.entering) continue;
      if (b.hitSet?.has(e)) continue;
      const rr = b.r + e.r;
      if (dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;

      if (e.blocksShot(b.x, b.y)) {
        b.dead = true;
        game.particles.sparks(b.x, b.y, '#8ff4ff', 6, Math.PI / 2, 1.4);
        game.audio.hit();
        break;
      }

      damageEnemy(game, e, b.damage, b);

      if (b.kind === 'rocket' || b.kind === 'charge') {
        game.explodeAt(b.x, b.y, b.aoe, b.damage * 0.6, b.color);
      }
      if (b.chain > 0) zapChain(game, e, b);

      if (b.pierce > 0) {
        b.pierce--;
        b.hitSet?.add(e);
      } else {
        b.dead = true;
      }
      if (b.dead) break;
    }
  }
}

function damageEnemy(game: Game, e: Enemy, dmg: number, b: Bullet | null): void {
  e.hp -= dmg;
  e.flash = 0.08;
  game.audio.hit();
  if (b) game.particles.sparks(b.x, b.y, e.color, 4, -Math.PI / 2, 1.6);
  if (e.hp <= 0 && !e.dead) game.killEnemy(e);
}

function zapChain(game: Game, from: Enemy, b: Bullet): void {
  const targets: Enemy[] = [];
  const range2 = 240 * 240;
  for (const other of game.enemies) {
    if (other === from || other.dead || other.entering) continue;
    if (dist2(from.x, from.y, other.x, other.y) < range2) targets.push(other);
  }
  targets.sort((a, c) => dist2(from.x, from.y, a.x, a.y) - dist2(from.x, from.y, c.x, c.y));
  const n = Math.min(b.chain, targets.length);
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    game.addLightning(from.x, from.y, t.x, t.y, '#aef6ff');
    damageEnemy(game, t, b.damage * 0.7, null);
    game.particles.sparks(t.x, t.y, '#aef6ff', 5);
  }
  if (n > 0) game.audio.zap();
}

function playerBulletsVsBoss(game: Game): void {
  const boss = game.boss!;
  for (const b of game.playerBullets) {
    if (b.dead) continue;
    if (b.hitSet?.has(boss)) continue;
    const res = boss.tryHit(b, game);
    if (res === 'none') continue;
    if (res === 'block') {
      b.dead = true;
      game.particles.sparks(b.x, b.y, '#ffd23f', 6, Math.PI / 2, 1.4);
      continue;
    }
    game.audio.hit();
    game.particles.sparks(b.x, b.y, '#ffffff', 4, Math.PI / 2, 1.2);
    if (b.kind === 'rocket' || b.kind === 'charge') {
      game.explodeAt(b.x, b.y, b.aoe, b.damage * 0.6, b.color);
    }
    if (b.pierce > 0) {
      b.pierce--;
      b.hitSet?.add(boss);
    } else {
      b.dead = true;
    }
  }
}

function playerBulletsVsMines(game: Game): void {
  for (const b of game.playerBullets) {
    if (b.dead) continue;
    for (const m of game.enemyBullets) {
      if (m.dead || m.kind !== 'mine') continue;
      const rr = b.r + m.r + 3;
      if (dist2(b.x, b.y, m.x, m.y) > rr * rr) continue;
      m.dead = true;
      b.dead = true;
      game.particles.explosion(m.x, m.y, '#ff8c66', 14, 200, 2.5);
      game.audio.explosion(0);
      game.addScore(25, m.x, m.y);
      break;
    }
  }
}

function enemyBulletsVsPlayer(game: Game): void {
  const p = game.player;
  for (const b of game.enemyBullets) {
    if (b.dead || b.kind === 'mine') continue;
    const rr = b.r + p.r * 0.8;
    if (dist2(b.x, b.y, p.x, p.y) > rr * rr) continue;
    b.dead = true;
    p.takeDamage(b.damage, game);
  }
}

function enemiesVsPlayer(game: Game): void {
  const p = game.player;
  for (const e of game.enemies) {
    if (e.dead || e.entering) continue;
    const rr = e.r + p.r * 0.8;
    if (dist2(e.x, e.y, p.x, p.y) > rr * rr) continue;
    if (p.takeDamage(18, game)) {
      // ramming costs the enemy too
      e.hp -= 25;
      e.flash = 0.1;
      if (e.hp <= 0 && !e.dead) game.killEnemy(e);
    }
  }
  if (game.boss && game.boss.touchesPlayer(p)) p.takeDamage(25, game);
}

/** Beams only bite after a short continuous exposure, so darting straight
 *  through one at full speed (or dashing) is always a viable escape. */
const BEAM_GRACE = 0.15;

function beamsVsPlayer(game: Game, dt: number): void {
  const p = game.player;
  let damage = 0;
  for (const e of game.enemies) {
    if (e.dead || e.kind !== 'laser' || e.state !== 2) continue;
    if (p.y > e.y && Math.abs(p.x - e.x) < e.beamW / 2 + p.r * 0.8) {
      damage = Math.max(damage, 16);
    }
  }
  if (game.boss && game.boss.beamHitsPlayer(p, game)) damage = Math.max(damage, 18);

  if (damage === 0) {
    p.beamExposure = 0;
    return;
  }
  p.beamExposure += dt;
  if (p.beamExposure >= BEAM_GRACE) {
    p.beamExposure = 0;
    p.takeDamage(damage, game);
  } else if (p.invuln <= 0) {
    // grazing — sparks warn that the beam is about to bite
    game.particles.sparks(p.x, p.y, '#ff4060', 2);
  }
}

function powerupsVsPlayer(game: Game): void {
  const p = game.player;
  for (const pu of game.powerups) {
    if (pu.dead) continue;
    const rr = pu.r + 22;
    if (dist2(pu.x, pu.y, p.x, p.y) > rr * rr) continue;
    pu.dead = true;
    game.applyPowerUp(pu);
  }
}
