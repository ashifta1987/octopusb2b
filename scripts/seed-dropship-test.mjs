#!/usr/bin/env node
// Seed 5 clearly fake Dropshipping catalogue v2 products ("TEST – …", is_test = true) with routes to 2 countries (AE, GB)
// and variants, plus shipping rate-card rows and selling countries on staging test orgs.
// STAGING ONLY: calls assertStagingOrThrow and refuses to run against live. Idempotent (upserts on octopus_sku).
// Run: node scripts/seed-dropship-test.mjs
import { config } from 'dotenv';
import pg from 'pg';
import { assertStagingOrThrow } from './lib-staging-guard.mjs';

config({ path: '.env.staging', quiet: true, override: true });
await assertStagingOrThrow();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingOrThrow(db);

try {
  await db.query('begin');

  const sup = (await db.query(`select id from suppliers where verified and archived_at is null order by code limit 1`)).rows[0];
  if (!sup) throw new Error('No verified supplier found on staging');

  // Ensure staff-only shipping rate card has AE and GB rates for express, standard and economy
  const RATES = [
    ['AE', 'express', 480, 95, 5.00, 150, 3, 5, true, false],
    ['AE', 'standard', 320, 70, 5.00, 150, 6, 9, true, false],
    ['AE', 'economy', 210, 50, 5.00, 150, 10, 15, true, false],
    ['GB', 'express', 620, 110, 8.00, 180, 4, 6, true, false],
    ['GB', 'standard', 430, 85, 8.00, 180, 7, 11, true, false],
    ['GB', 'economy', 290, 60, 8.00, 180, 12, 18, true, false],
    ['SA', 'express', 520, 100, 5.00, 160, 4, 6, true, false],
    ['SA', 'standard', 360, 75, 5.00, 160, 7, 10, true, false],
  ];
  for (const [country, service, base, per100, duty, fee, dmin, dmax, bat, liq] of RATES) {
    await db.query(`
      insert into dropship_rates (country, service, ship_base_cents, ship_per_100g_cents, duty_pct, fee_cents, days_min, days_max, allows_battery, allows_liquid, active)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      on conflict (country, service) do update set
        ship_base_cents = excluded.ship_base_cents,
        ship_per_100g_cents = excluded.ship_per_100g_cents,
        duty_pct = excluded.duty_pct,
        fee_cents = excluded.fee_cents,
        days_min = excluded.days_min,
        days_max = excluded.days_max,
        allows_battery = excluded.allows_battery,
        allows_liquid = excluded.allows_liquid,
        active = true
    `, [country, service, base, per100, duty, fee, dmin, dmax, bat, liq]);
  }

  // Pick safe public image URLs that do NOT come from /import/ paths
  const imgs = (await db.query(`
    select url from product_media
     where kind = 'image' and url is not null and url not like '%/import/%'
     order by created_at asc limit 5
  `)).rows.map((r) => r.url);
  const fallbackImg = imgs[0] || '/images/hero-warehouse.jpg';

  const ITEMS = [
    {
      sku: 'OCT-DS-TEST-001',
      title: 'TEST – Cordless LED Desk Lamp',
      description: 'TEST dropship product (staging only). Rechargeable aluminium desk lamp with 3 colour temperatures and touch dimmer. Ships in plain unbranded packaging.',
      category: 'Lighting',
      img: imgs[0] || fallbackImg,
      specs: { Material: 'Anodised aluminium', Battery: '4000 mAh USB-C', Brightness: '450 lm', ColourTemp: '3000K / 4500K / 6000K' },
      weight_g: 540,
      dims: { l: 34, w: 13, h: 9 },
      cost: 780,
      moq: 1,
      stock: 'in_stock',
      qty: 320,
      source: 'own_warehouse',
      supSku: 'FACTORY-MDL-LAMP-01',
      variants: [
        { sku: 'OCT-DS-TEST-001-BLK', options: { Colour: 'Matte Black' }, cost: 780, adj: 0, stock: 'in_stock', qty: 180 },
        { sku: 'OCT-DS-TEST-001-SLV', options: { Colour: 'Brushed Silver' }, cost: 810, adj: 100, stock: 'in_stock', qty: 140 },
      ],
      routes: [
        { country: 'AE', method: 'express', landed: 2190, ship: 680, duty: 40, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'AE', method: 'standard', landed: 1890, ship: 510, duty: 40, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'express', landed: 2490, ship: 860, duty: 65, min: 4, max: 6, carrier: '4PX Direct UK', active: true },
        { country: 'GB', method: 'economy', landed: 1990, ship: 520, duty: 65, min: 11, max: 16, carrier: '4PX Economy', active: true },
      ],
    },
    {
      sku: 'OCT-DS-TEST-002',
      title: 'TEST – Stainless Steel Insulated Tumbler 600ml',
      description: 'TEST dropship product (staging only). Double-wall vacuum insulated 304 stainless tumbler with leak-resistant flip lid.',
      category: 'Kitchen utensils',
      img: imgs[1] || fallbackImg,
      specs: { Capacity: '600 ml', Steel: '304 food-grade stainless', Insulation: 'Double-wall vacuum (12h hot / 24h cold)' },
      weight_g: 380,
      dims: { l: 21, w: 9, h: 9 },
      cost: 520,
      moq: 1,
      stock: 'in_stock',
      qty: 500,
      source: 'own_warehouse',
      supSku: 'FACTORY-MDL-TMB-600',
      variants: [
        { sku: 'OCT-DS-TEST-002-NVY', options: { Colour: 'Deep Navy', Size: '600ml' }, cost: 520, adj: 0, stock: 'in_stock', qty: 300 },
        { sku: 'OCT-DS-TEST-002-SND', options: { Colour: 'Desert Sand', Size: '600ml' }, cost: 520, adj: 0, stock: 'low', qty: 20 },
      ],
      routes: [
        { country: 'AE', method: 'express', landed: 1650, ship: 540, duty: 26, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'AE', method: 'economy', landed: 1390, ship: 360, duty: 26, min: 9, max: 14, carrier: 'YunExpress Economy', active: true },
        { country: 'GB', method: 'standard', landed: 1790, ship: 610, duty: 42, min: 7, max: 10, carrier: '4PX Standard UK', active: true },
      ],
    },
    {
      sku: 'OCT-DS-TEST-003',
      title: 'TEST – Ergonomic Laptop Riser Stand',
      description: 'TEST dropship product (staging only). Foldable CNC-machined alloy laptop stand with non-slip silicone pads for 11–16 inch notebooks.',
      category: 'Electronics',
      img: imgs[2] || fallbackImg,
      specs: { Compatibility: '11–16 inch laptops', LoadCapacity: '10 kg', Finish: 'Sandblasted alloy' },
      weight_g: 710,
      dims: { l: 27, w: 23, h: 5 },
      cost: 950,
      moq: 1,
      stock: 'in_stock',
      qty: 190,
      source: 'partner_supplier',
      supSku: 'FACTORY-MDL-STD-16',
      variants: [
        { sku: 'OCT-DS-TEST-003-GRY', options: { Colour: 'Space Grey' }, cost: 950, adj: 0, stock: 'in_stock', qty: 190 },
      ],
      routes: [
        { country: 'AE', method: 'standard', landed: 2250, ship: 640, duty: 48, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'standard', landed: 2490, ship: 780, duty: 76, min: 7, max: 11, carrier: '4PX Standard UK', active: true },
      ],
    },
    {
      sku: 'OCT-DS-TEST-004',
      title: 'TEST – Braided USB-C 100W PD Fast Charge Cable (2m)',
      description: 'TEST dropship product (staging only). Nylon-braided USB-C to USB-C 100W Power Delivery cable with E-Marker chip.',
      category: 'Cables & wires',
      img: imgs[3] || fallbackImg,
      specs: { Length: '2.0 m', MaxPower: '100W (20V/5A)', Jacket: 'Double-braided nylon' },
      weight_g: 120,
      dims: { l: 14, w: 10, h: 2 },
      cost: 240,
      moq: 2,
      stock: 'low',
      qty: 35,
      source: 'own_warehouse',
      supSku: 'FACTORY-MDL-CBL-100W',
      variants: [
        { sku: 'OCT-DS-TEST-004-2M', options: { Length: '2m', Colour: 'Charcoal' }, cost: 240, adj: 0, stock: 'low', qty: 35 },
      ],
      routes: [
        { country: 'AE', method: 'express', landed: 990, ship: 390, duty: 12, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'GB', method: 'express', landed: 1150, ship: 480, duty: 20, min: 4, max: 6, carrier: '4PX Direct UK', active: true },
      ],
    },
    {
      sku: 'OCT-DS-TEST-005',
      title: 'TEST – Modular ABS Cable Organiser Box',
      description: 'TEST dropship product (staging only). Under-desk power strip and cable management box with ventilated bamboo-look lid.',
      category: 'Storage bins',
      img: imgs[4] || fallbackImg,
      specs: { Material: 'Flame-retardant ABS', EntrySlots: '6 directional slots', Ventilation: 'Bottom + side slots' },
      weight_g: 490,
      dims: { l: 32, w: 14, h: 13 },
      cost: 610,
      moq: 1,
      stock: 'in_stock',
      qty: 240,
      source: 'partner_supplier',
      supSku: 'FACTORY-MDL-BOX-32',
      variants: [
        { sku: 'OCT-DS-TEST-005-WHT', options: { Colour: 'Warm White' }, cost: 610, adj: 0, stock: 'in_stock', qty: 140 },
        { sku: 'OCT-DS-TEST-005-BLK', options: { Colour: 'Graphite Black' }, cost: 610, adj: 0, stock: 'in_stock', qty: 100 },
      ],
      // Deliberately routed to AE and GB, NOT SA — so testing SA (or a route-filtered country) shows route filtering
      routes: [
        { country: 'AE', method: 'standard', landed: 1750, ship: 530, duty: 31, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'economy', landed: 1850, ship: 590, duty: 49, min: 11, max: 16, carrier: '4PX Economy', active: true },
      ],
    },
  ];

  let firstProdId = null;
  for (const item of ITEMS) {
    const p = (await db.query(`
      insert into dropship_products (
        octopus_sku, title, description, category, images, specs, weight_g, dimensions_cm,
        unit_cost_cents, min_order_qty, stock_status, stock_qty, source_type, supplier_id, supplier_sku,
        origin_country, status, is_test
      ) values ($1,$2,$3,$4,array[$5::text],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CN','active',true)
      on conflict ((upper(btrim(octopus_sku)))) do update set
        title = excluded.title,
        description = excluded.description,
        category = excluded.category,
        images = excluded.images,
        specs = excluded.specs,
        weight_g = excluded.weight_g,
        dimensions_cm = excluded.dimensions_cm,
        unit_cost_cents = excluded.unit_cost_cents,
        min_order_qty = excluded.min_order_qty,
        stock_status = excluded.stock_status,
        stock_qty = excluded.stock_qty,
        source_type = excluded.source_type,
        supplier_id = excluded.supplier_id,
        supplier_sku = excluded.supplier_sku,
        status = 'active',
        is_test = true
      returning id
    `, [item.sku, item.title, item.description, item.category, item.img, JSON.stringify(item.specs), item.weight_g,
        JSON.stringify(item.dims), item.cost, item.moq, item.stock, item.qty, item.source, sup.id, item.supSku])).rows[0];
    if (!firstProdId) firstProdId = p.id;

    for (const [idx, v] of item.variants.entries()) {
      await db.query(`
        insert into dropship_variants (product_id, options, octopus_sku, cost_cents, price_adjust_cents, stock_status, stock_qty, sort)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict ((upper(btrim(octopus_sku)))) do update set
          product_id = excluded.product_id,
          options = excluded.options,
          cost_cents = excluded.cost_cents,
          price_adjust_cents = excluded.price_adjust_cents,
          stock_status = excluded.stock_status,
          stock_qty = excluded.stock_qty,
          sort = excluded.sort
      `, [p.id, JSON.stringify(v.options), v.sku, v.cost, v.adj, v.stock, v.qty, idx]);
    }

    for (const r of item.routes) {
      await db.query(`
        insert into dropship_routes (product_id, destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, carrier, is_active)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (product_id, destination_country, shipping_method) do update set
          landed_price_cents = excluded.landed_price_cents,
          est_shipping_cents = excluded.est_shipping_cents,
          est_duties_cents = excluded.est_duties_cents,
          est_days_min = excluded.est_days_min,
          est_days_max = excluded.est_days_max,
          carrier = excluded.carrier,
          is_active = excluded.is_active
      `, [p.id, r.country, r.method, r.landed, r.ship, r.duty, r.min, r.max, r.carrier, r.active]);
    }
  }

  // Ensure W-10015 and TEST DATA · Divisions have selling countries AE, GB, SA configured
  const dsOrgs = (await db.query(`
    select id from organizations where wallet_reference = 'W-10015' or name = 'TEST DATA · Divisions'
  `)).rows;
  for (const o of dsOrgs) {
    for (const c of ['AE', 'GB', 'SA']) {
      await db.query(`insert into dropship_markets (org_id, country) values ($1, $2) on conflict do nothing`, [o.id, c]);
    }
  }
  const divOrg = (await db.query(`select id from organizations where name = 'TEST DATA · Divisions' limit 1`)).rows[0];
  if (divOrg && firstProdId) {
    await db.query(`
      insert into dropship_import_list (org_id, product_id, variant_id, service, price_cents)
      values ($1, $2, null, 'express', 3499)
      on conflict on constraint dropship_import_list_unique do nothing
    `, [divOrg.id, firstProdId]);
  }

  await db.query('commit');
  console.log(`✔ seeded 5 TEST dropship products (is_test=true) with AE & GB routes on staging`);
} catch (e) {
  await db.query('rollback').catch(() => {});
  throw e;
} finally {
  await db.end();
}
