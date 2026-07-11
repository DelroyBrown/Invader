const glowCache = new Map<string, HTMLCanvasElement>();

/**
 * Cached radial glow sprite for a 6-digit hex colour. Drawn with 'lighter'
 * compositing these read as neon light without per-frame shadowBlur cost.
 */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.22, color);
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

/** Draw a glow sprite centred at (x, y) with the given radius. */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number, color: string, alpha = 1,
): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

const softCache = new Map<string, HTMLCanvasElement>();

/** Pure colour falloff with no white core — for nebulae and ambient light. */
export function softSprite(color: string): HTMLCanvasElement {
  let c = softCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softCache.set(color, c);
  return c;
}

export function drawSoft(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number, color: string, alpha = 1,
): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(softSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}
