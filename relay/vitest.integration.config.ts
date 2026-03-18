import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          JWT_SECRET: 'test-jwt-secret-for-integration-tests',

          TURN_KEY_ID: 'fake-turn-key-id',
          TURN_KEY_API_TOKEN: 'fake-turn-api-token',
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.integration.test.ts'],
  },
});
