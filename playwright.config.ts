import { defineConfig, devices } from '@playwright/test';

/**
 * E2E golden paths (SPEC §11.3). Runs against E2E_BASE_URL (Vercel preview with seeded staging data) or a local
 * `pnpm dev` server. Demo credentials come from env: DEMO_PASSWORD (+ optional E2E_BUYER_EMAIL / E2E_OPS_EMAIL).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  // server actions + revalidation on the remote staging DB can take several seconds: give UI assertions room
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // axe must judge the settled page, not a frame halfway through a colour transition (the app honours prefers-reduced-motion)
    reducedMotion: 'reduce',
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
