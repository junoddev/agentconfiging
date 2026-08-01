import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects so DOM tests never load the node suite's environment and vice
// versa (vitest v4 dropped `environmentMatchGlobs`; projects are the supported
// replacement). `*.test.ts` stays on `node` — several suites use node-only APIs
// — while `*.test.tsx` renders real components under `jsdom` with the same React
// JSX transform the app build uses.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'web/src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['web/src/**/*.test.tsx'],
        },
      },
    ],
  },
});
