import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only source tests; `tsc -b` emits compiled copies into each package's dist/.
    include: ['{apps,packages}/*/src/**/*.test.ts'],
  },
});
