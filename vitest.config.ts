import { defineConfig } from 'vitest/config';

// Frontend tests (audit-2 fix 10; Phase B): pure-logic pins for the
// money and sanitiser modules run in the default Node environment.
// Component tests opt into jsdom per file with a
// `/** @vitest-environment jsdom */` docblock — Phase B added the
// first (the admin sign-in and its two-factor gating), where the
// render IS the behaviour under test. Kept separate from
// vite.config.ts so the React plugin (and its optimizeDeps) never
// loads for a test run.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
