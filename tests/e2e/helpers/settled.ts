import { test as base, expect as baseExpect, type Page } from '@playwright/test';

/**
 * E2E against `next dev`: two timing gaps the app does not have in production but the tests hit on a busy dev server.
 *  1. Hydration: Playwright's `goto` returns on `load`, when the HTML (incl. streamed Suspense content) is in the DOM but React
 *     may not have hydrated it yet. A file chosen or text typed before hydration is lost (onChange not attached yet), so the
 *     button stays disabled or the form posts empty. `waitForHydration` waits until every interactive / test-id element on the
 *     page carries its React fiber (set by React when it hydrates that node). Hidden inputs are skipped: React writes the
 *     Server Action fields ($ACTION_*) into the HTML without a fiber of their own.
 *  2. Server Function + `router.refresh()`: on the dev server each RSC render takes 1–5 s against the remote staging database
 *     (150–370 ms per query), and the action's revalidated render and the refresh render run at the same time. The new text can
 *     take longer than Playwright's default 5 s, so these specs use a 15 s assertion timeout.
 * Use: `import { test, expect } from './helpers/settled'` (the `page` fixture waits after every goto / reload);
 * for extra contexts call `installHydrationWait(page)`.
 */
export async function waitForHydration(page: Page, timeout = 15_000): Promise<void> {
  await page
    .waitForFunction(() => {
      const els = Array.from(document.querySelectorAll('body [data-testid], body button, body input:not([type="hidden"]), body select, body textarea, body form, body a[href]'));
      if (!els.length) return document.readyState === 'complete';
      return els.every((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber$')));
    }, undefined, { timeout, polling: 100 })
    .catch(async () => {
      // a page that never hydrates (static error page) is judged by the test's own assertions
      if (process.env.E2E_HYDRATION_DEBUG) {
        const left = await page.evaluate(() => Array.from(document.querySelectorAll('body [data-testid], body button, body input:not([type="hidden"]), body select, body textarea, body form, body a[href]'))
          .filter((el) => !Object.keys(el).some((k) => k.startsWith('__reactFiber$'))).map((el) => el.outerHTML.slice(0, 140))).catch(() => []);
        console.log(`[hydration] not hydrated after ${timeout} ms on ${page.url()}: ${left.length}`, left.slice(0, 5));
      }
    });
}

export function installHydrationWait(page: Page): Page {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, opts) => { const r = await goto(url, opts); await waitForHydration(page); return r; };
  page.reload = async (opts) => { const r = await reload(opts); await waitForHydration(page); return r; };
  return page;
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    installHydrationWait(page);
    await provide(page);
  },
});

export const expect = baseExpect.configure({ timeout: 15_000 });
