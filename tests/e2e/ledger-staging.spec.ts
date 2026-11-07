import { test, expect, type Page } from '@playwright/test';
import { adminClient } from './helpers/customer';

/**
 * Staging only: ledger/wallet checks on the seeded company W-10015 (Staging Test Trading LLC).
 * A temporary buyer is added to that company for the run and removed afterwards (the seeded data stays).
 */
const SHOTS = process.env.SHOTS_DIR;
let user: { id: string; email: string; password: string } | null = null;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: env } = await admin.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const { data: org } = await admin.from('organizations').select('id').eq('wallet_reference', 'W-10015').single();
  const email = `e2e.ledger+${Date.now()}@demo.octopusb2b.com`, password = `E2e-${Date.now()}-Lg!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from('profiles').upsert({ id: data.user!.id, full_name: 'E2E Ledger', email });
  await admin.from('org_members').insert({ org_id: org!.id, user_id: data.user!.id, member_role: 'viewer' });
  user = { id: data.user!.id, email, password };
});
test.afterAll(async () => {
  if (!user) return;
  const admin = adminClient();
  await admin.from('org_members').delete().eq('user_id', user.id);
  await admin.auth.admin.deleteUser(user.id);
});

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const tab = page.getByRole('tab', { name: /log in/i });
  if (await tab.count()) await tab.click();
  await page.getByLabel(/email/i).first().fill(user!.email);
  await page.getByLabel(/^password/i).first().fill(user!.password);
  await page.getByRole('button', { name: /^log in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}
const usd = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

test('wallet card = newest running balance; STAGING badge; no duplicate tab prefetches', async ({ page }) => {
  const rsc = new Map<string, number>();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.headers()['rsc'] === '1' && u.pathname.startsWith('/account') && r.headers()['next-router-prefetch']) rsc.set(u.pathname + u.search.replace(/[?&]_rsc=[^&]*/, ''), (rsc.get(u.pathname) ?? 0) + 1);
  });
  await login(page, '/account/wallet');
  await expect(page.getByTestId('staging-badge')).toHaveText(/^staging$/i);
  const card = usd(await page.getByTestId('wallet-balance').locator('.font-display').first().innerText());
  expect(card).toBe(1695);
  const newest = page.locator('table').last().locator('tbody tr').first().locator('td').nth(4);
  expect(usd(await newest.innerText())).toBe(card);
  await expect(page.getByText('Not on the bank statement')).toBeVisible();
  await page.waitForTimeout(1500);
  const dup = [...rsc.entries()].filter(([, n]) => n > 1);
  expect(dup, `prefetched more than once: ${JSON.stringify(dup)}`).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wallet-desktop.png`, fullPage: true });
});

test('ledger: last 90 days in the heading; only USD; grouped by account; Totals + closing per account; CSV = PDF rows', async ({ page }) => {
  await login(page, '/account/ledger');
  const from = await page.locator('#from').inputValue();
  const to = await page.locator('#to').inputValue();
  expect(Math.round((Date.parse(to) - Date.parse(from)) / 864e5)).toBe(89);
  await expect(page.getByTestId('ledger-period')).toBeVisible();
  await expect(page.locator('#currency option')).toHaveText(['All currencies', 'USD (US$)']);
  await expect(page.locator('h1:visible')).toContainText('Ledger and statements');

  // groups in a fixed order, each with its own running balance
  const t = page.getByTestId('ledger-USD');
  expect(await t.locator('tbody[data-account]').evaluateAll((els) => els.map((e) => e.getAttribute('data-account')))).toEqual(['receivable', 'wallet', 'hold']);
  const lastBal = async (k: string) => usd(await t.locator(`tbody[data-account="${k}"] tr[data-row="entry"]`).last().locator('td').last().innerText());
  expect(await lastBal('receivable')).toBe(1200);
  expect(await lastBal('wallet')).toBe(1695);
  expect(await lastBal('hold')).toBe(250);
  await expect(t.locator('tfoot tr[data-row="totals"]')).toContainText('Totals');
  expect(await t.locator('tfoot tr[data-row="closing-summary"]').allInnerTexts()).toEqual([
    expect.stringMatching(/Orders due\s+US\$ 1,200\.00/), expect.stringMatching(/Wallet available\s+US\$ 1,695\.00/), expect.stringMatching(/On hold\s+US\$ 250\.00/),
  ]);
  await expect(t).toContainText('Hold · Dropshipping order SO-TEST-1001');
  await expect(t).toContainText('Hold · 3PL warehouse charge WH-TEST-OCT');
  // amounts and journal numbers never wrap
  const ws = await t.locator('tr[data-row="entry"] td').evaluateAll((tds) => tds.filter((_, i) => i % 6 !== 2).map((td) => getComputedStyle(td).whiteSpace));
  expect(new Set(ws)).toEqual(new Set(['nowrap']));
  // cards: Balance due includes the proforma
  await expect(page.getByTestId('balance-due')).toContainText('US$ 1,200.00');
  await expect(page.getByTestId('due-now')).toContainText('US$ 1,200.00');

  // CSV rows vs printable statement rows → [journal, debit, credit, balance] in cents
  const cents = (v: string) => (v ? Math.round(Number(v.replace(/−/g, '-').replace(/[^\d.-]/g, '')) * 100) : 0);
  const csv = await (await page.request.get((await page.getByTestId('export-csv').getAttribute('href'))!)).text();
  const csvRows = csv.split(/\r\n/).map((l) => l.split('","').map((c) => c.replace(/^\uFEFF?"|"$/g, '')))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0] ?? '')).map((c) => [c[1], cents(c[5]), cents(c[6]), cents(c[7])].join('|'));
  await page.goto((await page.getByTestId('export-pdf').getAttribute('href'))!);
  const cells = await page.locator('.statement tr[data-row="entry"]').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim())));
  const pdfRows = cells.map((c) => [c[1], cents(c[3]), cents(c[4]), cents(c[5])].join('|'));
  expect(csvRows.length).toBe(9); // proforma (Orders) + 2 top-ups, 2 holds, refund (Wallet) + 2 holds, 1 charge (On hold)
  expect(pdfRows).toEqual(csvRows);
});

test('invoices: "For" filled; awaiting payment total = ledger Due now; wallet shows the received difference', async ({ page }) => {
  await login(page, '/account/invoices');
  const row = page.locator('tr').filter({ hasText: 'PI-TEST-0001' });
  await expect(row).toContainText('Make My Brand · MB-TEST-0001');
  const awaiting = usd(await page.getByTestId('awaiting-total').locator('[data-currency="USD"]').innerText());
  await page.goto('/account/ledger');
  const dueNow = usd(await page.getByTestId('due-now').innerText()); // label and hint have no digits
  expect(awaiting).toBe(1200);
  expect(dueNow).toBe(awaiting);
  await page.goto('/account/wallet');
  await expect(page.getByTestId('transfer-difference')).toHaveText('US$ 5.00 less than claimed (bank charges)');
});

test('an empty period disables both exports', async ({ page }) => {
  await login(page, '/account/ledger?from=2020-01-01&to=2020-01-31');
  await expect(page.getByTestId('export-csv')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('export-pdf')).toHaveAttribute('aria-disabled', 'true');
});

test('screenshots: ledger desktop, wallet and ledger on a phone', async ({ page, browser }) => {
  await login(page, '/account/ledger');
  await expect(page.getByTestId('ledger-period')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ledger-desktop.png`, fullPage: true });
  await page.goto('/account/invoices');
  await expect(page.getByTestId('awaiting-total')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/invoices-desktop.png`, fullPage: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await login(m, '/account/wallet');
  await expect(m.getByTestId('wallet-balance')).toBeVisible();
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/wallet-phone.png`, fullPage: true });
  await m.goto('/account/ledger');
  await expect(m.getByTestId('ledger-period')).toBeVisible();
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/ledger-phone.png`, fullPage: true });
  await m.goto('/account/invoices');
  await expect(m.getByTestId('awaiting-total')).toBeVisible();
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/invoices-phone.png`, fullPage: true });
  await ctx.close();
});
