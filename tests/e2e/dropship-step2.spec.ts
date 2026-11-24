import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { adminClient } from './helpers/customer';
import { createTempStaff, deleteTempStaff, staffLogin, type TempStaff } from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Step 2 E2E — Staff catalogue, 5-step import + Sourcing item import, single product editor,
 * Support (!canSeeCosts) redaction, random UUID image upload, DDP vs DAP publish gate, and axe (1280px & 390px).
 */
let dsStaff: TempStaff | null = null;
let supStaff: TempStaff | null = null;
let finStaff: TempStaff | null = null;
let distStaff: TempStaff | null = null;
const createdProductIds: string[] = [];
let tempSourcingProd: { id: string; itemId: string; skuNorm: string } | null = null;
let tempImportSourcingProd: { id: string; itemId: string; skuNorm: string; supplierProductId: string } | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertStagingOrThrow();
  const admin = adminClient();
  const { data: env } = await admin
    .from('site_settings')
    .select('value')
    .eq('key', 'app_environment')
    .maybeSingle();
  if (env?.value !== 'staging') throw new Error('staging only');

  // Enable dropship_v2_ui so the v2 staff shell renders
  await admin
    .from('site_settings')
    .upsert({ key: 'dropship_v2_ui', value: true }, { onConflict: 'key' });

  dsStaff = await createTempStaff('operations');
  const { data: dsDiv } = await admin.from('divisions').select('id').eq('code', 'DS').single();
  await admin
    .from('division_members')
    .upsert({ user_id: dsStaff.id, division_id: dsDiv!.id, role: 'staff' });

  supStaff = await createTempStaff('support');
  finStaff = await createTempStaff('finance');
  distStaff = await createTempStaff('distributor');

  const { data: octSup } = await admin.from('suppliers').select('id').eq('code', 'OCT-1132').single();
  const { data: firstCat } = await admin.from('categories').select('id').eq('active', true).eq('level', 1).limit(1).single();
  await admin
    .from('distributor_suppliers')
    .upsert({ distributor_id: distStaff.id, supplier_id: octSup!.id });

  const testSku = `TST2A-${Date.now().toString(36).toUpperCase()}`;
  const { data: sp } = await admin
    .from('products')
    .insert({
      external_id: testSku,
      slug: `tst2a-${Date.now()}`,
      title: 'TEST – Step 2a Sourcing Structured Packaging Bowl',
      description: 'Food-safe stainless bowl for structured item_master packaging verification during Step 2a E2E.',
      supplier_id: octSup!.id,
      category_id: firstCat!.id,
      status: 'draft',
      unit: 'pcs',
      moq: 10,
      currency: 'USD',
      min_price_cents: 450,
      net_weight: '710g',
      colour_box_mm: '240*180*120mm',
      is_seed: true,
    })
    .select('id, item_id')
    .single();
  await admin.from('price_tiers').insert({
    product_id: sp!.id,
    min_qty: 10,
    unit_price_cents: 450,
    currency: 'USD',
  });
  tempSourcingProd = { id: sp!.id as string, itemId: sp!.item_id as string, skuNorm: testSku };

  const impSku = `TST2IMP-${Date.now().toString(36).toUpperCase()}`;
  const { data: impProd } = await admin
    .from('products')
    .insert({
      external_id: impSku,
      slug: `tst2imp-${Date.now()}`,
      title: '000 TEST – Step 2 Import Candidate Stoneware Stand',
      description: 'Dedicated test Sourcing item for StaffImport E2E.',
      supplier_id: octSup!.id,
      category_id: firstCat!.id,
      status: 'draft',
      unit: 'pcs',
      moq: 10,
      currency: 'USD',
      min_price_cents: 500,
      is_seed: true,
    })
    .select('id, item_id')
    .single();
  const { data: impSp, error: impSpErr } = await admin
    .from('supplier_products')
    .insert({
      supplier_id: octSup!.id,
      product_id: impProd!.id,
      status: 'quoted',
      is_preferred: true,
    })
    .select('id')
    .single();
  if (impSpErr) throw impSpErr;
  await admin.from('product_costs').upsert({ product_id: impProd!.id, supplier_cost_cents: 450 });
  tempImportSourcingProd = {
    id: impProd!.id as string,
    itemId: impProd!.item_id as string,
    skuNorm: impSku,
    supplierProductId: impSp!.id as string,
  };
});

test.afterAll(async () => {
  const admin = adminClient();
  for (const pid of createdProductIds) {
    await admin.from('dropship_products').delete().eq('id', pid);
  }
  if (tempImportSourcingProd) {
    await admin.from('product_costs').delete().eq('product_id', tempImportSourcingProd.id);
    await admin.from('supplier_products').delete().eq('id', tempImportSourcingProd.supplierProductId);
    await admin.from('products').delete().eq('id', tempImportSourcingProd.id);
    await admin.from('sku_reservations').delete().eq('sku_norm', tempImportSourcingProd.skuNorm);
    await admin.from('item_master').delete().eq('id', tempImportSourcingProd.itemId);
  }
  if (tempSourcingProd) {
    await admin.from('products').delete().eq('id', tempSourcingProd.id);
    await admin.from('sku_reservations').delete().eq('sku_norm', tempSourcingProd.skuNorm);
    await admin.from('item_master').delete().eq('id', tempSourcingProd.itemId);
  }
  await deleteTempStaff(dsStaff);
  await deleteTempStaff(supStaff);
  await deleteTempStaff(finStaff);
  await deleteTempStaff(distStaff);
});

async function checkAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${label} axe serious/critical violations: ${JSON.stringify(
      serious.map((v) => ({ id: v.id, impact: v.impact, help: v.help })),
    )}`,
  ).toEqual([]);
}

test('Correction 3 & StaffCatalog: /office/dropship/products/[id] redirects to /office/dropship/[id]; filter chips & review drawer pass axe at 1280px & 390px', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await staffLogin(page, dsStaff!, '/office/dropship');
  await page.goto('/office/dropship');

  await expect(page.getByTestId('staff-dropship-list')).toBeVisible();
  await expect(page.getByTestId('staff-filter-chips')).toBeVisible();
  await expect(page.getByTestId('staff-review-card')).toBeVisible();
  await expect(page.getByTestId('staff-routes-split-card')).toBeVisible();
  await checkAxe(page, '/office/dropship 1280px');

  // Filter chips work (HS review & Drafts)
  await page.getByTestId('chip-hs_review').click();
  await expect(page).toHaveURL(/view=hs_review/);
  await expect(page.getByTestId('staff-dropship-list')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await checkAxe(page, '/office/dropship 390px');
  await page.setViewportSize({ width: 1280, height: 900 });

  // Correction 3: /office/dropship/products/[id] redirects cleanly to /office/dropship/[id]
  const admin = adminClient();
  const { data: firstProd } = await admin
    .from('dropship_products')
    .select('id, model_no')
    .limit(1)
    .single();
  await page.goto(`/office/dropship/products/${firstProd!.id}`);
  await expect(page).toHaveURL(new RegExp(`/office/dropship/${firstProd!.id}$`));
  await expect(page.getByTestId('dropship-product-form')).toBeVisible();
  await checkAxe(page, '/office/dropship/[id] 1280px');

  await page.setViewportSize({ width: 390, height: 844 });
  await checkAxe(page, '/office/dropship/[id] 390px');
  await ctx.close();
});

test('Correction 5: Support (!canSeeCosts) never sees Our cost, Margin, Sourcing cost, Sourcing model no., or Supplier across list, drawer, and editor, and is blocked from /office/dropship/import', async ({
  browser,
}) => {
  const admin = adminClient();
  const { data: testProd } = await admin
    .from('dropship_products')
    .select('id')
    .eq('legacy_sku', 'OCT-DS-TEST-001')
    .single();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await ctx.newPage();
  await staffLogin(sp, supStaff!, '/office/dropship');
  await sp.goto('/office/dropship');

  await expect(sp.getByTestId('staff-dropship-list')).toBeVisible();
  await expect(sp.getByTestId('staff-unit-cost')).toHaveCount(0);
  await expect(sp.getByTestId('staff-supplier')).toHaveCount(0);
  await expect(sp.getByTestId('drawer-sourcing-model')).toHaveCount(0);
  await expect(sp.getByTestId('drawer-our-cost')).toHaveCount(0);
  await expect(sp.getByTestId('drawer-margin')).toHaveCount(0);

  const listHtml = await sp.content();
  expect(listHtml).not.toMatch(/OCT-1132|CN-GD-BWJ|Boweijie|Bowijie|Our cost|Sourcing cost/i);

  // Open single product editor as Support: read-only AND zero cost/margin/supplier/Sourcing model no.
  await sp.goto(`/office/dropship/${testProd!.id}`);
  await expect(sp.getByTestId('dropship-product-form')).toBeVisible();
  await expect(sp.getByTestId('editor-sourcing-model')).toHaveCount(0);
  await expect(sp.getByTestId('editor-supplier')).toHaveCount(0);
  await expect(sp.getByTestId('readonly-sourcing-cost')).toHaveCount(0);
  await expect(sp.getByTestId('route-our-cost')).toHaveCount(0);
  await expect(sp.getByTestId('route-margin')).toHaveCount(0);
  await expect(sp.getByTestId('publish-btn')).toHaveCount(0);

  const editorHtml = await sp.content();
  expect(editorHtml).not.toMatch(/OCT-1132|CN-GD-BWJ|Boweijie|Bowijie|Purchase cost|Our cost/i);

  // Support opening /office/dropship/import is redirected to /forbidden
  await sp.goto('/office/dropship/import');
  await expect(sp).toHaveURL(/\/forbidden/);
  await ctx.close();
});

test('Correction 6, 7 & StaffImport: >2,000 rows error state, Sourcing item import (reusing item_id), random UUID image upload, and DDP vs DAP publish gate', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  await staffLogin(page, dsStaff!, '/office/dropship/import');
  await page.goto('/office/dropship/import');
  await expect(page.getByTestId('dropship-csv-import')).toBeVisible();
  await checkAxe(page, '/office/dropship/import 1280px');

  // States-Staff.html: > 2,000 rows shows "This file can't be imported"
  const over2k = [
    'import_ref,title,weight_g,source_type',
    ...Array.from({ length: 2005 }, (_, i) => `REF-${i},Item ${i},200,own_warehouse`),
  ].join('\n');
  await page.getByTestId('csv-textarea').fill(over2k);
  await page.getByTestId('csv-preview-btn').click();
  await expect(page.getByTestId('csv-global-error')).toContainText('up to 2,000 rows');

  // Import from our dedicated verified test Sourcing item -> creates draft & redirects to /office/dropship/[id]
  await expect(page.getByTestId('sourcing-import-section')).toBeVisible();
  const createBtn = page
    .getByTestId('sourcing-candidate-row')
    .filter({ hasText: tempImportSourcingProd!.skuNorm })
    .getByTestId('create-from-sourcing-btn');
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  await page.waitForURL(/\/office\/dropship\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const newProdId = page.url().split('/').pop()!;
  createdProductIds.push(newProdId);

  await expect(page.getByTestId('dropship-product-form')).toBeVisible();
  await expect(page.getByTestId('input-model-no')).toContainText(/DS-\d{6}/);
  // Publish button starts disabled while checklist is incomplete
  await expect(page.getByTestId('publish-btn')).toBeDisabled();

  // Correction 6: Upload a real PNG named with a secret supplier/model string -> stored URL uses ONLY a random UUID
  const pngBuffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 42, g: 111, b: 209 } },
  })
    .png()
    .toBuffer();

  await page.getByTestId('image-file-input').setInputFiles({
    name: 'OCT-1132-SECRET-SUPPLIER-MODEL-999.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  const uploadedImg = page.getByTestId('uploaded-image-item').locator('img').first();
  await expect(uploadedImg).toBeVisible({ timeout: 20_000 });
  const imgSrc = (await uploadedImg.getAttribute('src')) ?? '';
  expect(imgSrc).toMatch(/\/dropship-media\/[0-9a-f-]{36}\.png$/i);
  expect(imgSrc).not.toMatch(/OCT-1132|SECRET|SUPPLIER|MODEL-999/i);

  // Fill description, structured item_master data, and verify HS code
  await page.getByTestId('input-title').fill('TEST – Step 2 Sourced Stoneware Stand');
  await page.getByTestId('input-description').fill('Clean white-label stoneware stand for kitchen counters.');
  await page.getByTestId('input-hs-code').fill('6912.00');
  await page.getByTestId('input-origin-country').selectOption('CN');
  await page.getByTestId('input-weight').fill('480');
  await page.getByTestId('input-box-l').fill('20');
  await page.getByTestId('input-box-w').fill('15');
  await page.getByTestId('input-box-h').fill('10');
  await page.getByTestId('input-hs-verified').check();

  // Add SA route (SA has active shipping rate card on staging, NO duty_rate_entries):
  //  · DDP -> Publish button disabled ("SA route ...: duty not set")
  //  · DAP -> shows "Duties paid by buyer" and enables Publish!
  await page.getByTestId('add-route-btn').click();
  await page.getByTestId('route-country').first().selectOption('SA');
  await page.getByTestId('route-method').first().selectOption('standard');
  await page.getByTestId('route-incoterm').first().selectOption('DDP');
  await expect(page.getByTestId('publish-btn')).toBeDisabled();
  await expect(page.getByTestId('publish-checklist-card')).toContainText(/SA route.*duty not set/i);

  await page.getByTestId('route-incoterm').first().selectOption('DAP');
  await expect(page.getByTestId('route-duty-display').first()).toContainText('Duties paid by buyer');
  await expect(page.getByTestId('publish-btn')).toBeEnabled();

  await page.getByTestId('publish-btn').click();
  await expect(page.getByTestId('form-message')).toContainText('published to the Dropshipping catalogue');

  await ctx.close();
});

test('Step 2a: Sourcing product form shows legacy net_weight/colour_box_mm read-only and saves structured item_master fields via update_dropship_item_master', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await staffLogin(page, distStaff!, `/distributor/products/${tempSourcingProd!.id}/edit`);
  await page.goto(`/distributor/products/${tempSourcingProd!.id}/edit`);

  await expect(page.getByTestId('pf-shipping-customs')).toBeVisible();
  const legacyWeight = page.getByTestId('pf-legacy-net-weight');
  const legacyBox = page.getByTestId('pf-legacy-colour-box');
  await expect(legacyWeight).toHaveValue('710g');
  await expect(legacyBox).toHaveValue('240*180*120mm');
  await expect(legacyWeight).toHaveAttribute('readonly', '');
  await expect(legacyBox).toHaveAttribute('readonly', '');

  // Enter structured weight, box L/W/H cm, origin, HS code, and restricted flags
  await page.locator('#pf-hs').fill('3924.10');
  await page.locator('#pf-origin').selectOption('CN');
  await page.getByTestId('pf-weight-g').fill('820');
  await page.getByTestId('pf-box-l').fill('25');
  await page.getByTestId('pf-box-w').fill('20');
  await page.getByTestId('pf-box-h').fill('15');
  await page.getByTestId('pf-flag-battery').check();
  await page.getByTestId('pf-flag-fragile').check();

  // Volumetric: ceil((25*20*15 / 5000) * 1000) = 1,500 g > 820 g -> 1,500 g
  await expect(page.getByTestId('pf-billed-weight')).toContainText('1,500 g');
  await checkAxe(page, '/distributor/products/[id]/edit Step 2a');

  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15_000 });

  const admin = adminClient();
  const [{ data: im }, { data: prod }] = await Promise.all([
    admin
      .from('item_master')
      .select('hs_code, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, is_fragile, needs_data')
      .eq('id', tempSourcingProd!.itemId)
      .single(),
    admin
      .from('products')
      .select('net_weight, colour_box_mm')
      .eq('id', tempSourcingProd!.id)
      .single(),
  ]);

  expect(im?.hs_code).toBe('3924.10');
  expect(im?.origin_country?.trim()).toBe('CN');
  expect(im?.weight_g).toBe(820);
  expect(Number(im?.box_l_cm)).toBe(25);
  expect(Number(im?.box_w_cm)).toBe(20);
  expect(Number(im?.box_h_cm)).toBe(15);
  expect(im?.has_battery).toBe(true);
  expect(im?.is_fragile).toBe(true);
  expect(im?.needs_data).toBe(false);
  expect(prod?.net_weight).toBe('710g');
  expect(prod?.colour_box_mm).toBe('240*180*120mm');

  await ctx.close();
});
