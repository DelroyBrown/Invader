import type Game from '../Game';
import { WEAPONS } from '../entities/Player';
import { clamp } from '../utils/math';

const FONT = 'Orbitron, "Segoe UI", monospace';

export function drawHUD(ctx: CanvasRenderingContext2D, game: Game): void {
  const { width: w, height: h, player: p } = game;
  const narrow = w < 560;

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---- panel strips ----
  ctx.fillStyle = 'rgba(4, 8, 20, 0.42)';
  ctx.fillRect(0, 0, w, 54);
  ctx.fillRect(0, h - 58, w, 58);
  const sep = ctx.createLinearGradient(0, 0, w, 0);
  sep.addColorStop(0, 'rgba(125, 249, 255, 0)');
  sep.addColorStop(0.5, 'rgba(125, 249, 255, 0.35)');
  sep.addColorStop(1, 'rgba(255, 41, 117, 0)');
  ctx.fillStyle = sep;
  ctx.fillRect(0, 54, w, 1);
  ctx.fillRect(0, h - 59, w, 1);

  // ---- score (top-left) ----
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5a7a9a';
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText('SCORE', 16, 24);
  const pop = 1 + game.scorePop * 0.5;
  ctx.save();
  ctx.translate(16, 46);
  ctx.scale(pop, pop);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#7df9ff';
  ctx.shadowBlur = 8;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(String(Math.floor(game.dispScore)).padStart(7, '0'), 0, 0);
  ctx.restore();

  // combo
  if (game.combo >= 2) {
    const frac = clamp(game.comboTimer / 3, 0, 1);
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 10;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(`COMBO x${game.comboMult().toFixed(1)}`, 16, 72);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3a3010';
    ctx.fillRect(16, 78, 110, 4);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(16, 78, 110 * frac, 4);
  }

  // ---- high score (top-center) — hidden while a boss bar is up ----
  if (!game.boss) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a7a9a';
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText('HI-SCORE', w / 2, 24);
    ctx.fillStyle = game.score > game.highScore && game.highScore > 0 ? '#ffd700' : '#9ab8d8';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(String(Math.max(game.highScore, Math.floor(game.score))).padStart(7, '0'), w / 2, 44);
  }

  // ---- wave (top-right) ----
  ctx.textAlign = 'right';
  ctx.fillStyle = '#5a7a9a';
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText('WAVE', w - 16, 24);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(String(game.wave), w - 16, 46);

  // ---- boss health bar ----
  if (game.boss && !game.boss.entering) {
    const bw = Math.min(w * (narrow ? 0.74 : 0.6), 480);
    const bx = w / 2 - bw / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff2975';
    ctx.shadowColor = '#ff2975';
    ctx.shadowBlur = 8;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(game.boss.name, w / 2, 22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0a14';
    ctx.fillRect(bx, 28, bw, 12);
    // lagging damage ghost
    const ghost = clamp(game.boss.dispHp / game.boss.maxHp, 0, 1);
    const frac = clamp(game.boss.hp / game.boss.maxHp, 0, 1);
    ctx.fillStyle = '#7a2040';
    ctx.fillRect(bx, 28, bw * ghost, 12);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#ff2975');
    grad.addColorStop(1, '#ff5df1');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, 28, bw * frac, 12);
    // phase notches
    ctx.fillStyle = '#05060f';
    ctx.fillRect(bx + bw * 0.66 - 1, 28, 2, 12);
    ctx.fillRect(bx + bw * 0.33 - 1, 28, 2, 12);
    ctx.strokeStyle = '#ff2975';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, 28, bw, 12);
  }

  // ---- health bar (bottom-left) ----
  const hbY = h - 30;
  const hpW = narrow ? Math.max(96, Math.round(w * 0.3)) : 170;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5a7a9a';
  ctx.font = `500 10px ${FONT}`;
  ctx.fillText('HULL', 16, hbY - 8);
  ctx.fillStyle = '#101828';
  ctx.fillRect(16, hbY, hpW, 12);
  const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
  const hpColor = hpFrac > 0.5 ? '#3dff8c' : hpFrac > 0.25 ? '#ffd23f' : '#ff4d6d';
  ctx.fillStyle = hpColor;
  ctx.shadowColor = hpColor;
  ctx.shadowBlur = 6;
  ctx.fillRect(16, hbY, hpW * hpFrac, 12);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#2a3a52';
  ctx.strokeRect(16, hbY, hpW, 12);
  if (p.shieldTime > 0) {
    ctx.fillStyle = '#26d8ff';
    ctx.fillRect(16, hbY - 5, hpW * clamp(p.shieldTime / 10, 0, 1), 3);
  }

  // ---- spare ships (below the hull bar) ----
  for (let i = 0; i < game.lives; i++) {
    const sx = 22 + i * 20;
    const sy = hbY + 20;
    ctx.fillStyle = '#7df9ff';
    ctx.shadowColor = '#7df9ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 7);
    ctx.lineTo(sx + 6, sy + 5);
    ctx.lineTo(sx, sy + 2);
    ctx.lineTo(sx - 6, sy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (game.lives > 0) {
    ctx.fillStyle = '#5a7a9a';
    ctx.font = `500 9px ${FONT}`;
    ctx.fillText('SHIPS', 16 + game.lives * 20 + 6, hbY + 23);
  }

  // ---- weapon + bombs (bottom-right) ----
  const weapon = WEAPONS[p.weapon];
  ctx.textAlign = 'right';
  ctx.fillStyle = weapon.color;
  ctx.shadowColor = weapon.color;
  ctx.shadowBlur = 6;
  ctx.font = `700 ${narrow ? 11 : 13}px ${FONT}`;
  ctx.fillText(weapon.name, w - 16, hbY - 6);
  ctx.shadowBlur = 0;
  // level pips
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < p.weaponLevel ? weapon.color : '#2a3a52';
    ctx.fillRect(w - 16 - i * 14, hbY + 2, 10, 4);
  }
  // bombs
  for (let i = 0; i < p.bombs; i++) {
    const bx = w - 24 - i * 20;
    ctx.fillStyle = '#ff5c5c';
    ctx.shadowColor = '#ff5c5c';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(bx, hbY + 18, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (p.bombs > 0) {
    ctx.fillStyle = '#5a7a9a';
    ctx.font = `500 9px ${FONT}`;
    ctx.fillText(game.input.isTouch ? 'BOMB' : 'BOMB [B]', w - 16 - p.bombs * 20 - 8, hbY + 21);
  }

  // ---- active powerup timers ----
  const buffs: { label: string; color: string; frac: number }[] = [];
  if (p.rapidTime > 0) buffs.push({ label: 'R', color: '#ff9a2e', frac: p.rapidTime / 8 });
  if (p.multiTime > 0) buffs.push({ label: 'x2', color: '#ffd700', frac: p.multiTime / 10 });
  if (p.slowTime > 0) buffs.push({ label: 'T', color: '#7aa8ff', frac: p.slowTime / 6 });
  if (p.magnetTime > 0) buffs.push({ label: 'M', color: '#ff5df1', frac: p.magnetTime / 10 });
  buffs.forEach((b, i) => {
    // narrow screens stack the buff pills above the hull bar instead of beside it
    const bx = narrow ? 30 + i * 32 : 20 + hpW + 24 + i * 34;
    const by = narrow ? hbY - 28 : hbY + 6;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(b.frac, 0, 1));
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(b.label, bx, by + 4);
  });

  // ---- touch buttons ----
  if (game.input.isTouch) {
    const TAU = Math.PI * 2;
    for (const btn of game.touchButtons()) {
      const flash = Math.max(0, game.btnFlashT[btn.label] ?? 0);
      const isBomb = btn.label === 'BOMB';
      const isPause = btn.label === 'PAUSE';
      const disabled = isBomb && p.bombs <= 0;
      ctx.save();
      ctx.globalAlpha = (disabled ? 0.14 : isPause ? 0.2 : 0.3) + flash * 1.4;
      ctx.fillStyle = btn.color;
      ctx.beginPath();
      ctx.arc(btn.x, btn.y, btn.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = disabled ? 0.35 : isPause ? 0.6 : 0.85;
      ctx.strokeStyle = btn.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (isPause) {
        // ‖ icon
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(btn.x - 6.5, btn.y - 7, 4.5, 14);
        ctx.fillRect(btn.x + 2, btn.y - 7, 4.5, 14);
        ctx.restore();
        continue;
      }

      if (!isBomb) {
        // dash cooldown sweep — full white ring means ready
        const ready = clamp(1 - p.dashCd / 1.1, 0, 1);
        ctx.globalAlpha = ready >= 1 ? 0.95 : 0.6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(btn.x, btn.y, btn.r - 5, -Math.PI / 2, -Math.PI / 2 + TAU * ready);
        ctx.stroke();
      }

      ctx.globalAlpha = disabled ? 0.4 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isBomb ? `BOMB ×${p.bombs}` : 'DASH', btn.x, btn.y);
      ctx.restore();
    }
  }

  ctx.restore();
}
