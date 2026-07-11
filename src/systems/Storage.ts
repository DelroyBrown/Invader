const HS_KEY = 'neonvoid.highscore';
const MUTE_KEY = 'neonvoid.muted';

export const Storage = {
  getHighScore(): number {
    try {
      return Number(localStorage.getItem(HS_KEY)) || 0;
    } catch {
      return 0;
    }
  },

  setHighScore(score: number): void {
    try {
      localStorage.setItem(HS_KEY, String(Math.floor(score)));
    } catch {
      /* private browsing — high score just won't persist */
    }
  },

  getMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  },

  setMuted(muted: boolean): void {
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
};
