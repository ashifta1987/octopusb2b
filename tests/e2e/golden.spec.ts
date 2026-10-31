import { expect, test, type Page } from '@playwright/test';

/**
 * Golden paths 1–2 (SPEC §11.3). Skeleton: selectors use accessible roles/labels and may need tuning to the final UI.
 *  1. Visitor → email signup → profile (onboarding) → KYC submit.
 *  2. Customer RFQ (fee from wallet) → staff quote → approve → PI PDF downloaded and emailed → deposit recorded → confirmed.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? '';
const BUYER = process.env.E2E_BUYER_EMAIL ?? 'buyer@demo.octopusb2b.com';
const OPS = process.env.E2E_OPS_EMAIL ?? 'ops@demo.octopusb2b.com';
const FINANCE = process.env.E2E_FINANCE_EMAIL ?? 'finance@demo.octopusb2b.com';

async function login(page: Page, email: string, next = '/account') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function logout(page: Page) {
  await page.context().clearCookies();
}

test.describe('Golden path 1 — signup → onboarding → KYC', () => {
  test.skip(!PASSWORD, 'DEMO_PASSWORD not set');

  test('new visitor signs up, completes profile and submits KYC', async ({ page }) => {
    const email = `e2e+${Date.now()}@demo.octopusb2b.com`;
    await page.goto('/signup');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|sign up/i }).click();

    // email confirmation may be required on staging — then this test stops here
    await page.waitForURL(/onboarding|check-email|account/, { timeout: 15_000 });
    test.skip(!/onboarding/.test(page.url()), 'Email confirmation required on this environment');

    await page.getByLabel(/full name/i).fill('E2E Buyer');
    await page.getByLabel(/company/i).fill('E2E Imports BV');
    await page.getByLabel(/country/i).selectOption({ label: 'Netherlands' }).catch(() => page.getByLabel(/country/i).fill('NL'));
    await page.getByLabel(/phone/i).fill('+31 10 000 0001');
    await page.getByRole('button', { name: /continue|save|finish/i }).click();
    await page.waitForURL(/\/account/);

    await page.goto('/account/kyc');
    await page.getByLabel(/registration/i).fill('NL-KVK-E2E');
    await page.getByLabel(/address/i).first().fill('Waalhaven 1, Rotterdam');
    await page.getByRole('button', { name: /submit/i }).click();
    await expect(page.getByText(/submitted|in review/i).first()).toBeVisible();
  });
});

test.describe('Golden path 2 — RFQ → quote → approve → PI → deposit → confirmed', () => {
  test.skip(!PASSWORD, 'DEMO_PASSWORD not set');
  test.describe.configure({ mode: 'serial' });

  let rfqTitle = '';
  let orderCode = '';

  test('buyer submits an RFQ (fee from wallet)', async ({ page }) => {
    rfqTitle = `E2E RFQ ${Date.now()}`;
    await login(page, BUYER, '/account/rfqs');
    await page.getByRole('link', { name: /new rfq|request a quote/i }).first().click();
    await page.getByLabel(/title|what do you need/i).fill(rfqTitle);
    await page.getByLabel(/quantity/i).fill('1000');
    await page.getByRole('button', { name: /submit/i }).click();
    // paid action → confirm dialog
    const confirm = page.getByRole('button', { name: /confirm|pay/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByText(rfqTitle)).toBeVisible();
  });

  test('staff sends a quote', async ({ page }) => {
    await login(page, OPS, '/office/rfqs');
    await page.getByText(rfqTitle).click();
    await page.getByLabel(/supplier/i).first().selectOption({ index: 1 });
    await page.getByLabel(/unit price/i).fill('0.61');
    await page.getByLabel(/lead time/i).fill('18');
    await page.getByRole('button', { name: /send quote/i }).click();
    await expect(page.getByText(/QT-/)).toBeVisible();
    await logout(page);
  });

  test('buyer approves the quote → PI issued, PDF downloadable and emailable', async ({ page }) => {
    await login(page, BUYER, '/account/rfqs');
    await page.getByText(rfqTitle).click();
    await page.getByRole('button', { name: /approve/i }).first().click();
    await page.getByRole('button', { name: /confirm|approve/i }).last().click();
    await expect(page.getByText(/PI-\d{4}-\d+/).first()).toBeVisible();
    orderCode = (await page.getByText(/ORD-\d+/).first().textContent())?.match(/ORD-\d+/)?.[0] ?? '';

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /download|pdf/i }).first().click()]);
    expect(download.suggestedFilename()).toMatch(/PI-.*\.pdf$/i);
    await page.getByRole('button', { name: /email/i }).first().click();
    await expect(page.getByText(/sent|emailed/i).first()).toBeVisible();
    await logout(page);
  });

  test('finance records the deposit and staff confirms the order', async ({ page }) => {
    test.skip(!orderCode, 'order code not captured');
    await login(page, FINANCE, '/office/orders');
    await page.getByText(orderCode).click();
    await page.getByRole('button', { name: /record payment/i }).click();
    await page.getByLabel(/amount/i).fill('183.00');
    await page.getByLabel(/reference/i).fill('E2E-DEP');
    await page.getByRole('button', { name: /confirm|record/i }).last().click();
    await expect(page.getByText(/deposit paid/i).first()).toBeVisible();
    await logout(page);

    await login(page, OPS, '/office/orders');
    await page.getByText(orderCode).click();
    await page.getByRole('button', { name: /confirm order|mark confirmed/i }).click();
    await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  });
});
