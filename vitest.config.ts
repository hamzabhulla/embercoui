import { defineConfig } from 'vitest/config';

// Frontend unit tests (audit-2 fix 10): pure-logic pins for the money
// and sanitiser modules. Node environment only — no DOM tests yet, so
// no jsdom dependency; components stay covered by the build + the
// backend suite. Kept separate from vite.config.ts so the React
// plugin (and its optimizeDeps) never loads for a test run.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
