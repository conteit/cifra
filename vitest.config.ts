import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
  },
});
