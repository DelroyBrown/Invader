import { defineConfig } from 'vite';

// GitHub Pages serves this project at https://delroybrown.github.io/Invader/
// so production builds need the repo-name base path; dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Invader/' : '/',
}));
