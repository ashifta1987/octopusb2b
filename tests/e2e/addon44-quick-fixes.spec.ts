import { test, expect } from '@playwright/test';
import { adminClient } from './helpers/customer';

/** ADDON-44-C — audit quick fixes (03, 05, 06, 09, 11, 13, 16) on public pages. */
const PUBLIC = ['/', '/about', '/turnkey', '/developers', '/pools', '/request/dropship', '/request/3pl', '/request/sourcing', '/3pl'];

test('no carrier name, card payment, separate dropship app or unsupported platforms on public pages', async ({ request }) => {
  for (const path of PUBLIC) {
    const html = await (await request.get(path)).text();
    for (const bad of [/yunexpress/i, /dropship app/i, /by card/i, /card \/ bank transfer/i, /\bWix\b/, /send orders here automatically/i]) {
      expect(html, `${path} contains ${bad}`).not.toMatch(bad);
    }
  }
});

// W7 (owner, 26 Nov 2026): the old 3PL request form is gone — /request/3pl is a permanent redirect to the Warehouse OS intro
test('/request/3pl goes to the Warehouse OS intro (no old 3PL form)', async ({ page }) => {
  await page.goto('/request/3pl');
  await expect(page).toHaveURL(/\/3pl$/);
  await expect(page.getByTestId('wh-intro')).toBeVisible();
  await expect(page.getByText('Rates sent', { exact: true })).toHaveCount(0);
});

// 20 Nov 2026: dropship onboarding is "Coming soon" with a launch sign-up instead of the setup form (tests/e2e/dropship-coming-soon.spec.ts)
// Batch 3 (F-15): that page is the Live gate — checked with dropship_v2_ui OFF (with it ON it opens /account/dropship)
test('dropship request page: Coming soon + launch sign-up, no setup form', async ({ page }) => {
  const { data } = await adminClient().from('site_settings').select('value').eq('key', 'dropship_v2_ui');
  await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: false, description: 'Coming soon gate test' });
  try {
    await page.goto('/request/dropship');
    await expect(page.getByTestId('dropship-coming-soon')).toContainText('Coming soon');
    await expect(page.getByTestId('launch-notify-dropship')).toBeVisible();
    await expect(page.locator('select[name="store_platform"]')).toHaveCount(0);
  } finally {
    if (!data?.length) await adminClient().from('site_settings').delete().eq('key', 'dropship_v2_ui');
    else await adminClient().from('site_settings').upsert({ key: 'dropship_v2_ui', value: data[0].value });
  }
});

