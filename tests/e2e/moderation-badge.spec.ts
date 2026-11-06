import { test, expect } from '@playwright/test';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';

/**
 * Red pending-moderation count next to "Moderation" (7 Nov 2026). A temporary moderator (own TOTP, deleted afterwards).
 * Two temporary submitted products are added to OCT-1133 so the count is visible, then removed again.
 */
let t: TempStaff | null = null;
const tmp: string[] = [];

test.beforeAll(async () => {
  t = await createTempStaff(process.env.E2E_MODERATOR_ROLE ?? 'operations');
});
test.afterAll(async () => {
  if (t && tmp.length) {
    await t.admin.from('price_tiers').delete().in('product_id', tmp);
    await t.admin.from('products').delete().in('id', tmp);
    await t.admin.from('sku_reservations').delete().in('product_id', tmp);
  }
  await deleteTempStaff(t);
});

const pending = async () => {
  const { count } = await t!.admin.from('products').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review']).is('archived_at', null);
  return count ?? 0;
};

test('the side panel shows the exact pending moderation count, hidden at zero', async ({ page }) => {
  await staffLogin(page, t!, '/office');
  const nav = page.getByRole('navigation', { name: 'Portal' });
  const base = await pending();
  if (base === 0) await expect(nav.getByTestId('moderation-badge')).toHaveCount(0);
  else await expect(nav.getByTestId('moderation-badge')).toHaveText(String(base));

  // two products submitted for moderation → the count goes up by exactly 2 (after a navigation)
  const { data: sup } = await t!.admin.from('suppliers').select('id').eq('code', 'OCT-1133').single();
  for (const n of [1, 2]) {
    const { data: p, error } = await t!.admin.from('products').insert({ supplier_id: sup!.id, title: `QA badge ${n}`, slug: `qa-badge-${n}-${Date.now()}`, unit: 'pcs', moq: 1, currency: 'USD', status: 'draft', external_id: `QA-BADGE-${n}-${Date.now() % 100000}` }).select('id').single();
    expect(error).toBeNull();
    tmp.push(p!.id);
    await t!.admin.from('price_tiers').insert({ product_id: p!.id, min_qty: 1, unit_price_cents: 100, currency: 'USD' });
    await t!.admin.from('products').update({ status: 'submitted' }).eq('id', p!.id);
  }
  const now = await pending();
  expect(now).toBe(base + 2);
  await nav.getByRole('link', { name: /^KYC review/ }).click();
  await expect(nav.getByTestId('moderation-badge')).toHaveText(String(now));
  await expect(nav.getByTestId('moderation-badge')).toHaveAttribute('aria-label', `${now} pending`);
  // the moderation page agrees
  await nav.getByRole('link', { name: /^Moderation/ }).click();
  await expect(page.getByText(`Queue · ${now}`)).toBeVisible();

  // back to the base after they leave the queue
  await t!.admin.from('products').update({ status: 'draft' }).in('id', tmp);
  await nav.getByRole('link', { name: /^Queues/ }).click();
  if (base === 0) await expect(nav.getByTestId('moderation-badge')).toHaveCount(0);
  else await expect(nav.getByTestId('moderation-badge')).toHaveText(String(base));
});

