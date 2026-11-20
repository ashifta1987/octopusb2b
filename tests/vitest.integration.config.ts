import path from 'node:path';
import fs from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { stagingEnvProblem } from '../scripts/lib-staging-guard.mjs';

/**
 * Integration tests: call the real Route Handlers against the STAGING Supabase project (.env.staging).
 * Refuses to run unless APP_ENVIRONMENT=staging and the Supabase URL + DATABASE_URL are the staging project.
 * Run: pnpm test:integration
 */
const root = path.resolve(__dirname, '..');
const load = (name: string) => {
  const f = path.join(root, name);
  return fs.existsSync(f) ? parse(fs.readFileSync(f)) : {};
};
const env = { ...load('.env.local'), ...load('.env.staging') };
const problem = stagingEnvProblem(env);
if (problem) throw new Error(`vitest.integration refused: ${problem} — integration tests only run against STAGING.`);

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
