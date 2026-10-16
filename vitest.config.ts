import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    env: {
      REDIS_URL: 'redis://localhost:6379/15',
      WEB_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
    },
  },
});
