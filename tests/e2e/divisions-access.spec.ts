import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTempStaff, deleteTempStaff, staffLogin, totp, type TempStaff } from './helpers/staff';

/**
 * Divisions step 3 (19 Nov 2026) — STAGING ONLY, uses the staging test data (scripts/seed-division-test-data.mjs).
 * A Dropshipping staff member (own 2FA) cannot read a 3PL service request (inbound) or a Make My Brand project —
 * neither in Admin (404, no data) nor by calling the API directly (no rows / FORBIDDEN). A 3PL warehouse member sees the
 * shipments of every division, pick/pack/ship fields only.
 */
let ds: TempStaff | null = null;
let wh: TempStaff | null = null;
const ids: Record<string, string> = {};
test.describe.configure({ mode: 'serial' });

const signedIn = async (t: TempStaff, wait: (ms: number) => Promise<void>) => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: t.email, password: t.password });
  const { data: f } = await sb.auth.mfa.listFactors();
  if (Date.now() / 1000 % 30 > 26) await wait(4500);
  await sb.auth.mfa.challengeAndVerify({ factorId: f!.totp[0].id, code: totp(t.secret) });
  return sb;
};

test.beforeAll(async () => {
  ds = await createTempStaff('operations');
  wh = await createTempStaff('warehouse');
  const a = ds.admin;
  const { data: env } = await a.from('site_settings').select('value').eq('key', 'app_environment').maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');
  const div = async (code: string) => (await a.from('divisions').select('id').eq('code', code).single()).data!.id as string;
  await a.from('division_members').insert([{ user_id: ds.id, division_id: await div('DS'), role: 'staff' }, { user_id: wh.id, division_id: await div('3PL'), role: 'warehouse' }]);
  const org = (await a.from('organizations').select('id').eq('name', 'TEST DATA · Divisions').single()).data!.id;
  ids.sr3pl = (await a.from('service_requests').select('id').eq('org_id', org).eq('service_code', '3pl').single()).data!.id;
  ids.mb = (await a.from('brand_projects').select('id').eq('ref', 'MB-TEST-01').single()).data!.id;
  ids.shp = (await a.from('shipments').select('id').eq('code', 'TEST-SHP-1').single()).data!.id;
  ids.org = org;
});
test.afterAll(async () => {
  for (const t of [ds, wh]) {
    if (!t) continue;
    await t.admin.from('division_members').delete().eq('user_id', t.id);
    try { await deleteTempStaff(t); } catch { /* audit rows keep the account: block it instead */ }
    const { data } = await t.admin.auth.admin.getUserById(t.id);
    if (data?.user) await t.admin.auth.admin.updateUserById(t.id, { ban_duration: '876000h' });
  }
});

test('Dropshipping staff: no 3PL inbound request, no Make My Brand project — direct API', async ({ page }) => {
  const sb = await signedIn(ds!, (ms) => page.waitForTimeout(ms));
  const sr = await sb.from('service_requests').select('id, details').eq('id', ids.sr3pl);
  expect(sr.error).toBeNull();
  expect(sr.data).toEqual([]);
  expect((await sb.from('brand_projects').select('id').eq('id', ids.mb)).data).toEqual([]);
  expect((await sb.rpc('admin_brand_projects', { p_id: ids.mb, p_status: null })).data ?? []).toEqual([]);
  expect((await sb.rpc('brand_project_history', { p_id: ids.mb })).data ?? []).toEqual([]);
  const st = await sb.rpc('set_brand_project_status', { p_id: ids.mb, p_to: 'proof', p_reason: null });
  expect(st.error?.message ?? '').toMatch(/FORBIDDEN|NOT_FOUND/);
  const tr = await sb.rpc('transition_service_request', { p_id: ids.sr3pl, p_to: 'accepted', p_reason: null });
  expect(tr.error?.message ?? '').toMatch(/FORBIDDEN|NOT_FOUND/);
  expect((await sb.from('service_requests').update({ status: 'accepted' }).eq('id', ids.sr3pl).select('id')).data ?? []).toEqual([]);
  const orders = (await sb.from('orders').select('code').eq('org_id', ids.org)).data ?? [];
  expect(orders.map((o) => o.code)).toEqual(['TEST-ORD-DS']);
});

test('Dropshipping staff: Admin brand project page is 404, the list does not show it', async ({ page }) => {
  await staffLogin(page, ds!, '/admin/brand-projects');
  await page.goto(`/admin/brand-projects/${ids.mb}`);
  await expect(page.getByRole('heading', { name: /couldn.t find that page/i })).toBeVisible();
  await expect(page.getByText('MB-TEST-01')).toHaveCount(0);
  await page.goto('/admin/brand-projects');
  await expect(page.getByRole('heading', { name: 'Brand projects' })).toBeVisible();
  await expect(page.getByTestId('brand-row').filter({ hasText: 'MB-TEST-01' })).toHaveCount(0);
});

test('3PL warehouse: every division\'s shipments, pick/pack/ship fields only — direct API', async ({ page }) => {
  const sb = await signedIn(wh!, (ms) => page.waitForTimeout(ms));
  const row = (await sb.from('warehouse_shipments').select('*').eq('id', ids.shp)).data?.[0];
  expect(row?.division).toBe('SRC');
  expect(Object.keys(row ?? {}).some((c) => /price|rate|cents|total|payment|margin|cost|deposit/.test(c))).toBe(false);
  expect((await sb.from('shipments').select('rate_cents').eq('id', ids.shp)).data).toEqual([]);
  expect((await sb.from('orders').select('unit_price_cents').eq('org_id', ids.org)).data).toEqual([]);
  expect((await sb.from('payments').select('amount_cents').eq('org_id', ids.org)).data).toEqual([]);
  expect((await sb.rpc('warehouse_update_shipment', { p_id: ids.shp, p_status: 'label_ready', p_tracking_no: 'TEST-TRK-E2E' })).error).toBeNull();
  expect((await sb.from('shipments').update({ rate_cents: 1 }).eq('id', ids.shp).select('id')).data ?? []).toEqual([]);
  const { data: still } = await wh!.admin.from('shipments').select('status, rate_cents').eq('id', ids.shp).single();
  expect(still!.status).toBe('label_ready');
  expect(Number(still!.rate_cents)).toBe(4800);
  await wh!.admin.from('shipments').update({ status: 'created', tracking_no: null }).eq('id', ids.shp);   // put the test row back
});
