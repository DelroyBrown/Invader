# NEON VOID: INVADER STORM

**▶ Play it now: https://delroybrown.github.io/Invader/** — works on desktop
and mobile.

A fast, neon-soaked browser arcade shooter — Space Invaders DNA crossed with
Geometry Wars juice and light bullet-hell patterns. TypeScript + Vite + HTML5
Canvas, zero runtime dependencies. All art is drawn with canvas primitives and
all audio is synthesized live with WebAudio — no assets.

## Run it locally

```bash
npm install
npm run dev      # dev server (URL printed in terminal)
npm run build    # production build in dist/
npm run preview  # serve the production build
```

Pushing to `main` auto-deploys to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

## Controls

| Desktop | Action |
| --- | --- |
| WASD or Arrow keys | Move in all directions |
| Space | Fire |
| Shift | Dash (brief invincibility) |
| B or X | Nova bomb (screen clear) |
| P / Esc | Pause |
| M | Mute |
| H | How to play (from menu) |

**Mobile:** relative drag steering — the ship mirrors your finger's movement
(amplified), so your thumb can rest anywhere without covering the action.
Auto-fire is always on; on-screen DASH (with cooldown ring) and BOMB (with
stock counter) buttons sit in the lower corners, with haptic feedback on
supported devices. The layout, HUD, and menus adapt to narrow screens, and
rotation / browser-chrome resizes are handled live.

## What's inside

- **8 weapons** — pulse laser, twin cannon, spread, vulcan, piercing plasma,
  homing rockets, chain lightning, nova cannon — each with 3 upgrade levels.
- **9 powerups** — repair, shield, weapon swap, upgrade, overdrive, bomb,
  score x2, time warp, magnet — with generous drop rates, a pity system, and
  periodic supply drops.
- **8 enemy types** — grunts, kamikaze divers, shooters, splitters, rotating
  shield bugs, mine-laying bombers, laser eyes with telegraphed beams, and
  swarms — plus elite mini-bosses on every wave ending in 3 or 8.
- **3 bosses** on a 5-wave cycle — the Mothership (wave 5), the Void Serpent
  (wave 10), the Orbital Core (wave 15) — each with 3 phases, telegraphed
  attacks, and weak points. The roster loops with buffed stats after wave 15.
- **Arcade scoring** — combo multiplier on kill chains, perfect-wave and speed
  bonuses, high score persisted in localStorage.
- **Juice** — particle explosions, shockwave rings, screen shake, hit flashes,
  slow-motion kicks, dash afterimages, nebulae and shooting stars, scanline /
  vignette overlay, procedural arcade-fighter soundtrack (funk slap bass,
  brass stabs, vibrato lead) through a compressor, drive and delay bus.

## Code layout

```
src/
  main.ts              bootstrap + mobile gesture guards
  Game.ts              state machine, loop, scoring, rendering, screens
  entities/            Player, Enemy, Boss, Bullet, PowerUp
  systems/             Input, Audio, Particles, Waves, Collision, Storage
  ui/HUD.ts            in-game HUD (score, hull, boss bar, buffs, touch UI)
  utils/               math helpers, cached glow sprites
```
