import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType } from '@playwright/test';

/**
 * ODS T7 · run TODAY's specs unchanged inside the ODS theme (Part 9, T7 row: "All existing Dropship tests still pass,
 * unchanged"). Opt-in only: playwright.config.ts calls installOdsPreviewHook() when E2E_ODS_PREVIEW = on | all; with the
 * variable unset nothing here runs and every spec behaves exactly as today.
 *
 * What it does: every browser context the run creates — the `context`/`page` fixture AND the contexts specs open with
 * `browser.newContext()` (most Dropship specs do) — gets the staging preview cookie `ods_preview=<mode>` (lib/ods-flag.ts)
 * for the base URL, and keeps it after `context.clearCookies()` (tests/e2e/helpers/customer.ts clears cookies before
 * signing in again). No database write; the server honours the cookie only when APP_ENVIRONMENT = staging.
 *
 * Why not `use.storageState` / `use.extraHTTPHeaders`: both only reach the `context` fixture (not `browser.newContext()`),
 * storageState is wiped by clearCookies(), and a `Cookie` extra header replaces the session cookies. So the hook wraps
 * BrowserType.launch() (the worker's `browser` fixture calls `playwright[browserName].launch()` on these same
 * playwright-core singletons) and the Browser's newContext().
 */
export type OdsPreviewMode = 'on' | 'all';

const PATCHED = Symbol.for('octopus.odsPreviewHook');

export function odsPreviewModeFromEnv(value = process.env.E2E_ODS_PREVIEW): OdsPreviewMode | null {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'on' || v === 'all' ? v : null;
}

export function installOdsPreviewHook(mode: OdsPreviewMode, baseURL: string) {
  if (/hostoctopus\.com/i.test(baseURL) && !/staging/i.test(baseURL)) throw new Error('E2E_ODS_PREVIEW never runs against live');
  const cookie = { name: 'ods_preview', value: mode, url: baseURL, sameSite: 'Lax' as const };

  const prepare = async (context: BrowserContext) => {
    await context.addCookies([cookie]);
    const clear = context.clearCookies.bind(context);
    context.clearCookies = (async (...args: Parameters<BrowserContext['clearCookies']>) => {
      await clear(...args);
      await context.addCookies([cookie]);
    }) as BrowserContext['clearCookies'];
    return context;
  };

  const wrapBrowser = (browser: Browser) => {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (async (...args: Parameters<Browser['newContext']>) => prepare(await newContext(...args))) as Browser['newContext'];
    return browser;
  };

  for (const type of [chromium, firefox, webkit] as BrowserType[]) {
    const t = type as BrowserType & { [PATCHED]?: boolean };
    if (t[PATCHED]) continue;
    t[PATCHED] = true;
    const launch = type.launch.bind(type);
    type.launch = (async (...args: Parameters<BrowserType['launch']>) => wrapBrowser(await launch(...args))) as BrowserType['launch'];
  }
}
