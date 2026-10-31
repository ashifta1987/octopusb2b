import path from 'node:path';
import fs from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: call the real Route Handlers against the Supabase project in .env.local.
 * Run: npx vitest run --config tests/vitest.integration.config.ts
 * Uses only sandbox (oct_test_) writes and cleans up the API client/keys/webhooks it creates.
 */
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.local');
const env = fs.existsSync(envFile) ? parse(fs.readFileSync(envFile)) : {};

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@': root,
      'server-only': path.join(root, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { ...env, CRON_SECRET: env.CRON_SECRET || 'integration-cron-secret', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
  },
});
