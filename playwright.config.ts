import { defineConfig, devices } from '@playwright/test';
import { installOdsPreviewHook, odsPreviewModeFromEnv } from './tests/e2e/helpers/ods-preview-hook';

/**
 * E2E golden paths (SPEC §11.3). Runs against E2E_BASE_URL (Vercel preview with seeded staging data) or a local
 * `pnpm dev` server. Demo credentials come from env: DEMO_PASSWORD (+ optional E2E_BUYER_EMAIL / E2E_OPS_EMAIL).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * ODS T7 (opt-in, default off): E2E_ODS_PREVIEW=on|all puts the staging preview cookie ods_preview on EVERY browser
 * context (fixture contexts and browser.newContext()), so today's specs run unchanged inside the ODS theme, e.g.
 *   E2E_ODS_PREVIEW=on pnpm exec playwright test tests/e2e/ds*.spec.ts tests/e2e/dropship-*.spec.ts
 * Staging only (the server ignores the cookie elsewhere). See tests/e2e/helpers/ods-preview-hook.ts.
 */
const odsPreview = odsPreviewModeFromEnv();
if (odsPreview) installOdsPreviewHook(odsPreview, baseURL);

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
