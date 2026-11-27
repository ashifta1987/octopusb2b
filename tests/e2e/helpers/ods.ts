import type { BrowserContext } from '@playwright/test';

/**
 * ODS T3+: turn the new theme on (or off) for ONE Playwright browser context, with the `ods_preview` cookie
 * (lib/ods-flag.ts). No database write, so other staging users and parallel specs are never affected.
 * The server honours the cookie only when APP_ENVIRONMENT = 'staging'; on live it is ignored, so these specs simply see
 * today's pages there. They must never run against live anyway (PROJECT-MEMORY §2.6).
 *   mode 'on'  → ODS pages for this context
 *   mode 'all' → ODS pages + the "all" behaviour (old service URLs 308 to /services/*)
 *   mode 'off' → today's pages even if ods_theme_v1 is on
 */
export async function odsPreview(context: BrowserContext, mode: 'on' | 'all' | 'off', baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000') {
  if (/hostoctopus\.com/i.test(baseURL) && !/staging/i.test(baseURL)) throw new Error('ODS preview specs never run against live');
  await context.addCookies([{ name: 'ods_preview', value: mode, url: baseURL, sameSite: 'Lax' }]);
}
