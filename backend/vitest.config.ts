import { defineConfig } from 'vitest/config';

export default defineConfig({
  // These are API tests — no CSS is ever processed. The inline empty
  // PostCSS config matters: without it, Vite searches parent directories
  // for a postcss.config file, finds the FRONTEND's at the repo root, and
  // crashes on machines where the frontend's node_modules (tailwindcss)
  // is not installed — e.g. the backend-only CI job.
  css: { postcss: { plugins: [] } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
