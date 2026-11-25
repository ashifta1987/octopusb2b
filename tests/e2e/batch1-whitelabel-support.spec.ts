import { test, expect } from '@playwright/test';
import {
  createTempCustomer,
  customerLogin,
  pgClient,
  purgeTestOrgs,
  type TempCustomer,
} from './helpers/customer';
import {
  createTempStaff,
  deleteTempStaff,
  staffLogin,
  type TempStaff,
} from './helpers/staff';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

test.describe.configure({ mode: 'serial' });

let supportStaff: TempStaff | null = null;
let sourcingStaff: TempStaff | null = null;
let financeStaff: TempStaff | null = null;
let customer: TempCustomer | null = null;
let targetDoc: { id: string; org_id: string; sup_code: string; sup_name: string } | null = null;
let targetOrderId: string | null = null;
let targetTracking: string | null = null;

test.beforeAll(async () => {
  await assertStagingOrThrow();
  supportStaff = await createTempStaff('support');
  sourcingStaff = await createTempStaff('operations');
  financeStaff = await createTempStaff('finance');
  customer = await createTempCustomer('b1cust');

  const db = pgClient();
  await db.connect();
  try {
    await db.query(
      `insert into public.division_members(user_id, division_id, role)
       values ($1, division_id_of('SRC'), 'staff')
       on conflict do nothing`,
      [sourcingStaff.id],
    );

    const sup = (
      await db.query(`
        select id, code, legal_name
          from public.suppliers
         where code is not null
           and legal_name is not null
         order by created_at asc
         limit 1
      `)
    ).rows[0] as { id: string; code: string; legal_name: string } | undefined;

    if (sup) {
      const stamp = Date.now();
      const tempOrder = (
        await db.query(
          `insert into public.orders (
             org_id, supplier_id, division_id, code, title, quantity,
             unit_price_cents, total_cents, deposit_cents, currency
           ) values (
             $1, $2, division_id_of('SRC'), $3, $4, 100,
             500, 50000, 15000, 'USD'
           ) returning id`,
          [customer.orgId, sup.id, `E2E-B1-${stamp}`, 'E2E Batch1 PDF Test'],
        )
      ).rows[0] as { id: string };

      const tempDoc = (
        await db.query(
          `insert into public.documents (
             org_id, order_id, division_id, doc_type, number, amount_cents, currency
           ) values (
             $1, $2, division_id_of('SRC'), 'proforma_invoice', $3, 50000, 'USD'
           ) returning id`,
          [customer.orgId, tempOrder.id, `PF-E2E-B1-${stamp}`],
        )
      ).rows[0] as { id: string };

      targetOrderId = tempOrder.id;
      const tracking = `YT-E2E-B1-${stamp}`;
      const tempShipment = (
        await db.query(
          `insert into public.shipments (
             code, order_id, org_id, carrier_code, tracking_no,
             label_url, status, rate_cents, currency, division_id
           ) values (
             $1, $2, $3, 'yunexpress', $4,
             $5, 'in_transit', 4800, 'USD', division_id_of('SRC')
           ) returning id`,
          [`E2E-SHP-B1-${stamp}`, tempOrder.id, customer.orgId, tracking, `/api/labels/${tracking}`],
        )
      ).rows[0] as { id: string };

      await db.query(
        `insert into public.tracking_events (
           shipment_id, org_id, status, description, location, occurred_at
         ) values (
           $1, $2, 'in_transit', 'Departed Shenzhen hub — E2E test', 'Shenzhen', now()
         )`,
        [tempShipment.id, customer.orgId],
      );

      targetDoc = {
        id: tempDoc.id,
        org_id: customer.orgId,
        sup_code: sup.code,
        sup_name: sup.legal_name,
      };
      targetTracking = tracking;
    }

    if (!targetTracking) {
      targetTracking =
        (
          await db.query(`
            select tracking_no
              from public.shipments
             where tracking_no is not null
             order by created_at desc
             limit 1
          `)
        ).rows[0]?.tracking_no ?? null;
    }
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  if (sourcingStaff) {
    const db = pgClient();
    await db.connect();
    try {
      await db.query(`delete from public.division_members where user_id = $1`, [sourcingStaff.id]);
    } finally {
      await db.end();
    }
  }
  await purgeTestOrgs(
    customer?.orgId ? [customer.orgId] : [],
    customer?.id ? [customer.id] : [],
  );
  for (const t of [supportStaff, sourcingStaff, financeStaff]) {
    if (!t) continue;
    try {
      await deleteTempStaff(t);
    } catch {
      const { data } = await t.admin.auth.admin.getUserById(t.id);
      if (data?.user) await t.admin.auth.admin.updateUserById(t.id, { ban_duration: '876000h' });
    }
  }
});

test('PDF route gates supplier details on supplier/cost permission (sourcing staff in SRC sees it; support & customer do not)', async ({
  browser,
}) => {
  expect(targetDoc, 'Expected a document linked to an order with supplier on staging').toBeTruthy();
  const docUrl = `/api/documents/${targetDoc!.id}/pdf`;

  // 1. sourcing staff (operations in SRC: has orders:view + suppliers:view, aal2) -> sees Supplier <code>
  const ctxSrc = await browser.newContext();
  const pageSrc = await ctxSrc.newPage();
  await staffLogin(pageSrc, sourcingStaff!, '/office/orders');
  const resSrc = await pageSrc.request.get(docUrl);
  expect(resSrc.status()).toBe(200);
  const htmlSrc = await resSrc.text();
  expect(htmlSrc).toContain(targetDoc!.sup_code);
  await ctxSrc.close();

  // 2. support (no suppliers:view or finance:view, aal2) -> must NOT see supplier code or name
  const ctxSup = await browser.newContext();
  const pageSup = await ctxSup.newPage();
  await staffLogin(pageSup, supportStaff!, '/office/support');
  const resSup = await pageSup.request.get(docUrl);
  expect(resSup.status()).toBe(200);
  const htmlSup = await resSup.text();
  expect(htmlSup).not.toContain(targetDoc!.sup_code);
  expect(htmlSup).not.toContain(targetDoc!.sup_name);
  await ctxSup.close();

  // 3. customer -> must NOT see supplier code or name
  const ctxCust = await browser.newContext();
  const pageCust = await ctxCust.newPage();
  await customerLogin(pageCust, customer!, '/account');
  const resCust = await pageCust.request.get(docUrl);
  expect(resCust.status()).toBe(200);
  const htmlCust = await resCust.text();
  expect(htmlCust).not.toContain(targetDoc!.sup_code);
  expect(htmlCust).not.toContain(targetDoc!.sup_name);
  await ctxCust.close();
});

test('support gets read-only tracking on /office/shipping and /office/orders/[id] without rates/labels/supplier; shipping & finance see rates via RPC', async ({
  browser,
}) => {
  expect(targetOrderId && targetTracking && targetDoc, 'Expected temp order, shipment, tracking event, and doc').toBeTruthy();

  // 1. support (aal2): read-only shipment tracking, events, carrier; NO Ready to ship, rates, labels, or supplier details
  const ctxSup = await browser.newContext();
  const pageSup = await ctxSup.newPage();
  await staffLogin(pageSup, supportStaff!, '/office/support');
  const resShip = await pageSup.goto('/office/shipping');
  expect(resShip?.status()).toBe(200);
  await expect(pageSup.getByRole('heading', { name: /Shipping tracking/i })).toBeVisible();
  const row = pageSup.locator('tr', { hasText: targetTracking! });
  await expect(row).toBeVisible();
  await expect(row.getByText('YunExpress')).toBeVisible();
  await expect(row.getByText('In transit', { exact: true })).toBeVisible();

  const eventsSummary = row.locator('summary', { hasText: /All events/i });
  if (await eventsSummary.count()) await eventsSummary.first().click();
  await expect(row.locator('details li', { hasText: 'Departed Shenzhen hub — E2E test' })).toBeVisible();

  await expect(pageSup.getByRole('heading', { name: /Ready to ship/i })).toHaveCount(0);
  await expect(pageSup.locator('a[href^="/api/labels/"]')).toHaveCount(0);
  const shipBodySup = await pageSup.locator('main').innerText();
  expect(shipBodySup).not.toContain('48.00');
  expect(shipBodySup).not.toContain('Ready to ship');
  expect(shipBodySup).not.toContain(targetDoc!.sup_code);
  expect(shipBodySup).not.toContain(targetDoc!.sup_name);

  // Filtered ?order= view
  const resShipOrder = await pageSup.goto(`/office/shipping?order=${targetOrderId}`);
  expect(resShipOrder?.status()).toBe(200);
  await expect(pageSup.locator('main').getByText(targetTracking!)).toBeVisible();

  // Direct label endpoint remains 403
  const labelRes = await pageSup.request.get(`/api/labels/${encodeURIComponent(targetTracking!)}`);
  expect(labelRes.status()).toBe(403);

  // Order detail view: shows tracking & carrier, hides Print label and supplier details
  const resOrd = await pageSup.goto(`/office/orders/${targetOrderId}`);
  expect(resOrd?.status()).toBe(200);
  await expect(pageSup.locator('main').getByText(targetTracking!)).toBeVisible();
  await expect(pageSup.locator('main').getByText('YunExpress').first()).toBeVisible();
  await expect(pageSup.getByRole('link', { name: /Print label/i })).toHaveCount(0);
  const ordBodySup = await pageSup.locator('main').innerText();
  expect(ordBodySup).not.toContain(targetDoc!.sup_code);
  expect(ordBodySup).not.toContain(targetDoc!.sup_name);
  await ctxSup.close();

  // 2. sourcingStaff (operations in SRC: orders:edit) -> sees rate via get_shipment_rates(), carrier, Label, and Ready to ship
  const ctxSrc = await browser.newContext();
  const pageSrc = await ctxSrc.newPage();
  await staffLogin(pageSrc, sourcingStaff!, '/office/shipping');
  const rowSrc = pageSrc.locator('tr', { hasText: targetTracking! });
  await expect(rowSrc).toBeVisible();
  await expect(rowSrc.getByText('48.00')).toBeVisible();
  await expect(rowSrc.getByText('YunExpress')).toBeVisible();
  await expect(rowSrc.getByRole('link', { name: /^Label$/i })).toBeVisible();
  await expect(pageSrc.locator('main').getByText(/Ready to ship/i).first()).toBeVisible();
  await ctxSrc.close();

  // 3. financeStaff (finance: finance:view) -> sees rate via get_shipment_rates() & carrier, without Simulate event or Label
  const ctxFin = await browser.newContext();
  const pageFin = await ctxFin.newPage();
  await staffLogin(pageFin, financeStaff!, '/office/shipping');
  const rowFin = pageFin.locator('tr', { hasText: targetTracking! });
  await expect(rowFin).toBeVisible();
  await expect(rowFin.getByText('48.00')).toBeVisible();
  await expect(rowFin.getByText('YunExpress')).toBeVisible();
  await expect(pageFin.getByRole('button', { name: /Simulate event/i })).toHaveCount(0);
  await expect(pageFin.locator('a[href^="/api/labels/"]')).toHaveCount(0);
  await ctxFin.close();
});

test('public Sourcing slugs return 301 to clean slug, canonical points to new slug, images have zero SKU/factory tokens, sitemap is clean', async ({
  page,
  request,
}) => {
  const db = pgClient();
  await db.connect();
  let rows: { old_slug: string; new_slug: string; sku: string | null; sup_code: string | null }[] = [];
  try {
    rows = (
      await db.query(`
        select r.old_slug, p.slug as new_slug, p.sku, s.code as sup_code
          from public.product_slug_redirects r
          join public.products p on p.id = r.product_id
          left join public.suppliers s on s.id = p.supplier_id
         where p.status = 'live'
           and p.archived_at is null
         order by r.old_slug
      `)
    ).rows;
  } finally {
    await db.end();
  }

  expect(rows.length).toBeGreaterThanOrEqual(30);

  // Verify permanent HTTP 301 for EVERY migrated live product
  for (const row of rows) {
    const r = await request.get(`/p/${encodeURIComponent(row.old_slug)}`, { maxRedirects: 0 });
    expect(r.status(), `expected 301 for /p/${row.old_slug}`).toBe(301);
    const loc = r.headers()['location'] || '';
    expect(loc.endsWith(`/p/${row.new_slug}`), `301 location "${loc}" should end with /p/${row.new_slug}`).toBe(true);
  }

  // Verify sitemap excludes all old slugs and includes new slugs + contains zero cn-gd-bwj tokens
  const sm = await request.get('/sitemap.xml');
  expect(sm.status()).toBe(200);
  const xml = await sm.text();
  expect(xml).not.toMatch(/cn-gd-bwj/i);
  for (const row of rows) {
    expect(xml).not.toContain(`/p/${row.old_slug}</loc>`);
    expect(xml).toContain(`/p/${row.new_slug}</loc>`);
  }

  // Render representative migrated pages in Chromium (full SKU slug + truncated tail slug) and verify canonical & images
  const sample = [
    rows.find((r) => /cn-gd-bwj/i.test(r.old_slug)) ?? rows[0],
    rows.find((r) => /-oem-c$/i.test(r.old_slug)) ?? rows[rows.length - 1],
  ];
  for (const item of sample) {
    await page.goto(`/p/${item.new_slug}`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`/p/${item.new_slug}$`));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical ?? '').toMatch(new RegExp(`/p/${item.new_slug}$`));

    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const im of imgs) {
        if (im.loading === 'lazy') im.loading = 'eager';
        im.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      await Promise.all(
        imgs.map((im) =>
          im.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                im.addEventListener('load', () => resolve(), { once: true });
                im.addEventListener('error', () => resolve(), { once: true });
                setTimeout(resolve, 10_000);
              }),
        ),
      );
    });

    const imgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).map((im) => ({
        src: im.getAttribute('src') || im.currentSrc || '',
        complete: im.complete,
        naturalWidth: im.naturalWidth,
      })),
    );
    expect(imgs.length).toBeGreaterThan(0);
    for (const im of imgs) {
      expect(im.src).not.toMatch(/\/import\/|cn-[a-z]{2}-|oct-/i);
      if (im.src.includes('product-media')) {
        expect(im.complete && im.naturalWidth > 0, `Broken product image: ${im.src}`).toBe(true);
      }
    }
  }
});
