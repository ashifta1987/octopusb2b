import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { createTempStaff, deleteTempStaff, staffLogin, totp, type TempStaff } from './helpers/staff';

/**
 * Distributor › Products filtered by supplier (6 Nov 2026). A temporary distributor (own TOTP, deleted afterwards)
 * is assigned OCT-1132 (Bowijie, CN-GD-BWJ-*) and OCT-1133 (Domino, CN-GD-DMN-*).
 */
let t: TempStaff | null = null;
const sup: Record<string, { id: string; n: number }> = {};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  t = await createTempStaff('distributor');
  const { data } = await t.admin.from('suppliers').select('id, code').in('code', ['OCT-1132', 'OCT-1133']);
  for (const s of data ?? []) {
    const { count } = await t.admin.from('products').select('id', { count: 'exact', head: true }).eq('supplier_id', s.id).neq('status', 'archived');
    sup[s.code] = { id: s.id, n: count ?? 0 };
  }
  await t.admin.from('distributor_suppliers').insert(Object.values(sup).map((s) => ({ distributor_id: t!.id, supplier_id: s.id })));
});
test.afterAll(async () => { await deleteTempStaff(t); });

const skus = async (page: import('@playwright/test').Page) => page.locator('tbody tr:visible td:nth-child(2)').allInnerTexts();   // previous routes stay in the DOM, hidden (cacheComponents)

test('supplier "Products" buttons open that supplier only; All suppliers shows both; dropdown is kept in the URL', async ({ page }) => {
  await staffLogin(page, t!, '/distributor');
  await page.goto('/distributor');

  // OCT-1133 → only CN-GD-DMN-*
  await page.getByTestId('products-OCT-1133').click();
  await expect(page).toHaveURL(/\/distributor\/products\?supplier=OCT-1133$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Products · OCT-1133 · .+/);
  const dmn = await skus(page);
  expect(dmn.length).toBe(sup['OCT-1133'].n);
  expect(dmn.every((s) => s.startsWith('CN-GD-DMN-'))).toBe(true);
  await expect(page.getByTestId('product-count')).toContainText(`${sup['OCT-1133'].n} product`);

  // OCT-1132 → only CN-GD-BWJ-* (69 → two pages of 50)
  await page.goto('/distributor');
  await page.getByTestId('products-OCT-1132').click();
  await expect(page).toHaveURL(/supplier=OCT-1132/);
  await expect(page.getByTestId('product-count')).toContainText(`${sup['OCT-1132'].n} products · OCT-1132`);
  let bwj = await skus(page);
  if (sup['OCT-1132'].n > 50) {
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/supplier=OCT-1132.*page=2|page=2.*supplier=OCT-1132/);   // pagination keeps the supplier
    bwj = bwj.concat(await skus(page));
  }
  expect(bwj.length).toBe(sup['OCT-1132'].n);
  expect(bwj.every((s) => s.startsWith('CN-GD-BWJ-'))).toBe(true);

  // × All suppliers → both
  await page.getByTestId('clear-supplier').click();
  await expect(page).toHaveURL(/\/distributor\/products(\?(?!.*supplier=).*)?$/);
  const total = sup['OCT-1132'].n + sup['OCT-1133'].n;
  await expect(page.getByTestId('product-count')).toContainText(`${total} products`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Products');

  // dropdown: All suppliers + each assigned supplier with counts; selection in the URL survives reload and Back
  const dd = page.getByTestId('supplier-filter');
  await expect(dd.locator('option')).toHaveText([`All suppliers (${total})`, new RegExp(`^OCT-1132 · .* \\(${sup['OCT-1132'].n}\\)$`), new RegExp(`^OCT-1133 · .* \\(${sup['OCT-1133'].n}\\)$`)]);
  await dd.selectOption('OCT-1133');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/supplier=OCT-1133/);
  await page.reload();
  await expect(page.getByTestId('supplier-filter')).toHaveValue('OCT-1133');
  expect((await skus(page)).every((s) => s.startsWith('CN-GD-DMN-'))).toBe(true);
  await page.goBack();
  await expect(page).not.toHaveURL(/supplier=OCT-1133/);
  await expect(page.getByTestId('product-count')).toContainText(`${total} products`);
});

test('the export follows the supplier filter', async ({ page }) => {
  await staffLogin(page, t!, '/distributor/products?supplier=OCT-1133');
  const href = await page.getByTestId('download-mine').getAttribute('href');
  expect(href).toBe('/distributor/products/import/export?supplier=OCT-1133');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.body()) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Products') ?? wb.worksheets[0];
  const col = (ws.getRow(1).values as unknown[]).findIndex((v) => String(v).toLowerCase() === 'sku');
  const out: string[] = [];
  ws.eachRow((r, i) => { if (i > 1) { const v = String(r.getCell(col).value ?? '').trim(); if (v) out.push(v); } });
  expect(out.length).toBe(sup['OCT-1133'].n);
  expect(out.every((s) => s.startsWith('CN-GD-DMN-'))).toBe(true);
});

test('an unassigned supplier: page 403, export 403, unknown code 404 (item 3)', async ({ page }) => {
  await t!.admin.from('distributor_suppliers').delete().eq('distributor_id', t!.id).eq('supplier_id', sup['OCT-1133'].id);
  await staffLogin(page, t!, '/distributor/products');
  // pages render the 403 page (the portal shell streams first, so the HTTP status of a page stays 200 — Next.js streaming)
  for (const path of ['/distributor/products?supplier=OCT-1133', '/distributor/products/import?supplier=OCT-1133', '/distributor/products?supplier=oct-1133']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible();
    await expect(page.locator('tbody tr:visible')).toHaveCount(0);
  }
  await page.goto('/distributor/products?supplier=OCT-9999');
  await expect(page.getByRole('heading', { name: /couldn.t find that page/i })).toBeVisible();
  // the export is a route handler: a real 403 for an existing supplier, 404 for an unknown code, never a workbook
  expect((await page.request.get('/distributor/products/import/export?supplier=OCT-1133')).status()).toBe(403);
  expect((await page.request.get('/distributor/products/import/export?supplier=OCT-9999')).status()).toBe(404);
  // the remaining supplier still works, and "All suppliers" no longer lists OCT-1133
  await page.goto('/distributor/products');
  await expect(page.getByTestId('supplier-filter').locator('option')).toHaveCount(2);
  expect((await skus(page)).every((s) => s.startsWith('CN-GD-BWJ-'))).toBe(true);
});

test("direct requests for another supplier's product: edit page 403, create-for 403, REST list/single/update/images no data (item 3)", async ({ page }) => {
  // OCT-1133 was unassigned in the previous test; pick one of its products (live and not live)
  const { data: bProducts } = await t!.admin.from('products').select('id, status').eq('supplier_id', sup['OCT-1133'].id).limit(50);
  const live = bProducts!.find((p) => p.status === 'live')!;
  await staffLogin(page, t!, '/distributor/products');
  await page.goto(`/distributor/products/${live.id}/edit`);
  await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible();
  await page.goto(`/distributor/products/new?supplier=${sup['OCT-1133'].id}`);
  await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible();

  // straight against the REST API with the distributor's own 2FA (aal2) session — no app in between
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: t!.email, password: t!.password });
  const { data: factors } = await sb.auth.mfa.listFactors();
  if (Date.now() / 1000 % 30 > 26) await page.waitForTimeout(4500);
  await sb.auth.mfa.challengeAndVerify({ factorId: factors!.totp[0].id, code: totp(t!.secret) });
  // supplier_id is a hidden column since migration 195 (the portal reads it via portal_products() after its check)
  expect((await sb.from('products').select('id, supplier_id')).error?.code).toBe('42501');
  const list = await sb.from('products').select('id');
  expect(list.error).toBeNull();
  const ids = list.data!.map((p) => p.id as string);
  const { data: owners } = await t!.admin.from('products').select('id, supplier_id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  expect((owners ?? []).every((p) => p.supplier_id === sup['OCT-1132'].id)).toBe(true);  // only the assigned supplier
  expect(ids).not.toContain(live.id);
  expect((await sb.from('products').select('id').eq('id', live.id)).data).toEqual([]);
  expect((await sb.from('price_tiers').select('id').eq('product_id', live.id)).data).toEqual([]);
  expect((await sb.from('product_media').select('id').eq('product_id', live.id)).data).toEqual([]);
  expect((await sb.from('products').update({ updated_at: new Date().toISOString() }).eq('id', live.id).select('id')).data).toEqual([]);
  expect((await sb.from('price_tiers').insert({ product_id: live.id, min_qty: 999999, unit_price_cents: 1, currency: 'USD' })).error).not.toBeNull();
  expect((await sb.rpc('transition_product', { p_product: live.id, p_to: 'archived', p_reason: 'e2e' })).error?.message ?? '').toMatch(/FORBIDDEN/);
  expect((await sb.storage.from('product-media').list(sup['OCT-1133'].id)).data ?? []).toEqual([]);
  expect((await sb.storage.from('product-media').upload(`${sup['OCT-1133'].id}/e2e-${Date.now()}.png`, new Uint8Array([1]), { contentType: 'image/png' })).error).not.toBeNull();
  // the product is unchanged
  const { data: still } = await t!.admin.from('products').select('status').eq('id', live.id).single();
  expect(still!.status).toBe('live');
});
