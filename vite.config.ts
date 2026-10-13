import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://justinscott12.github.io/storm-replay/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/storm-replay/' : '/',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', testTimeout: 30_000 },
}));
