import { defineConfig } from '@playwright/test';

/**
 * Electron smoke tests (`pnpm test:e2e`, which builds first). They start the real app, so they
 * need a display and a GPU/WebGL; not part of `pnpm test` or CI yet.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
});
