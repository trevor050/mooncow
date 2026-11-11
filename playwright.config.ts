import { defineConfig } from '@playwright/test';

// Loads the built Chromium package (.output/chrome-mv3) into a real Chromium.
// Run `npm run build:chrome` first.
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
