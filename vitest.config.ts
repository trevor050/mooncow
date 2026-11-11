import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    // Date tests use a fixed instant; pin the zone so "today" is the same everywhere.
    env: { TZ: 'UTC' },
  },
});
