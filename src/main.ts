import Game from './Game';

// Mobile browser gesture guards — no pinch zoom, no double-tap zoom,
// no long-press magnifier over the playfield.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

const canvas = document.getElementById('game') as HTMLCanvasElement;
new Game(canvas).start();
