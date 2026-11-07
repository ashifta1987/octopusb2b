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

test('ledger: last 90 days filled in and in the heading; only USD offered; CSV and PDF have the same rows', async ({ page }) => {
  await login(page, '/account/ledger');
  const from = await page.locator('#from').inputValue();
  const to = await page.locator('#to').inputValue();
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Math.round((Date.parse(to) - Date.parse(from)) / 864e5)).toBe(89);
  await expect(page.getByTestId('ledger-period')).toBeVisible();
  await expect(page.locator('#currency option')).toHaveText(['All currencies', 'USD (US$)']);
  await expect(page.locator('h1:visible')).toContainText('Ledger and statements');

  // running balance of the last wallet row equals the wallet card
  const walletRows = page.locator('tbody tr').filter({ has: page.getByText('Wallet', { exact: true }) });
  expect(usd(await walletRows.last().locator('td').last().innerText())).toBe(1695);

  // CSV rows → [journal, debit, credit, balance] in cents
  const cents = (v: string) => (v ? Math.round(Number(v.replace(/−/g, '-').replace(/[^\d.-]/g, '')) * 100) : 0);
  const csvHref = await page.getByTestId('export-csv').getAttribute('href');
  const csv = await (await page.request.get(csvHref!)).text();
  const csvRows = csv.split(/\r\n/).map((l) => l.split('","').map((c) => c.replace(/^\uFEFF?"|"$/g, '')))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[0] ?? '')).map((c) => [c[1], cents(c[5]), cents(c[6]), cents(c[7])].join('|'));
  // printable statement (PDF) rows
  const pdfHref = await page.getByTestId('export-pdf').getAttribute('href');
  await page.goto(pdfHref!);
  const cells = await page.locator('.statement tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim())));
  const pdfRows = cells.filter((t) => t.length === 8).map((t) => [t[1], cents(t[5]), cents(t[6]), cents(t[7])].join('|'));
  expect(csvRows.length).toBe(8); // 2 top-ups, 2 holds (wallet + hold account each), 1 capture (hold account), 1 refund
  expect(pdfRows).toEqual(csvRows);
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await login(m, '/account/wallet');
  await expect(m.getByTestId('wallet-balance')).toBeVisible();
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/wallet-phone.png`, fullPage: true });
  await m.goto('/account/ledger');
  await expect(m.getByTestId('ledger-period')).toBeVisible();
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/ledger-phone.png`, fullPage: true });
  await ctx.close();
});
