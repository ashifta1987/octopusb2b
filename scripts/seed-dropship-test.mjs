#!/usr/bin/env node
// Seed staging Dropshipping catalogue v2 TEST products ("TEST – …", is_test = true) with routes to AE & GB,
// variants (DS-XXXXXX / DS-XXXXXX-NN model numbers), verified Sourcing supplier_products links (reusing Sourcing
// item_id on single-unit partner_supplier items), structured item_master physical data & HS codes, 3PL shipping_rate_cards,
// active fee_versions, AE/GB/SA duty_rate_entries, dropship_price_tiers, and 3PL warehouse_stock movements on staging.
// STAGING ONLY: calls assertStagingOrThrow and refuses to run against live. Idempotent.
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

  // 1. Ensure versioned 3PL shipping_rate_cards has active AE, GB, and SA lanes
  const RATES = [
    ['AE', 'express', 'BKPHR', 'YunExpress Priority Direct', 480, 95, 3, 5, true, false],
    ['AE', 'standard', 'THZXR', 'YunExpress Standard Direct', 320, 70, 6, 9, true, false],
    ['AE', 'economy', 'YUN-ECO', 'YunExpress Economy Line', 210, 50, 10, 15, true, false],
    ['GB', 'express', 'BKPHR', 'YunExpress Priority UK', 620, 110, 4, 6, true, false],
    ['GB', 'standard', 'THZXR', 'YunExpress Standard UK', 430, 85, 7, 11, true, false],
    ['GB', 'economy', 'YUN-ECO', 'YunExpress Economy UK', 290, 60, 12, 18, true, false],
    ['SA', 'express', 'BKPHR', 'YunExpress Priority KSA', 520, 100, 4, 6, true, false],
    ['SA', 'standard', 'THZXR', 'YunExpress Standard KSA', 360, 75, 7, 10, true, false],
  ];
  for (const [country, method, svcCode, label, base, per100, dmin, dmax, bat, liq] of RATES) {
    const ex = (await db.query(
      `select id from shipping_rate_cards where active and carrier_code = 'yunexpress' and country = $1 and method = $2 limit 1`,
      [country, method],
    )).rows[0];
    if (!ex) {
      await db.query(
        `select publish_shipping_rate_card('yunexpress', $1, $2, $3, $4, $5, $6, $7, 30000, 5000, 100, $8, $9, false, false, $10)`,
        [method, svcCode, country, base, per100, dmin, dmax, bat, liq, label],
      );
    }
  }

  // 2. Ensure active fee_versions schedule on staging (two-person staff proposal/approval if none active)
  const activeFee = (await db.query(`select id from fee_versions where status = 'active' limit 1`)).rows[0];
  if (!activeFee) {
    const staffUsers = (await db.query(`
      select u.user_id
      from user_roles u
      where u.role_code in ('admin', 'finance')
      group by u.user_id
      order by min(u.role_code) asc
      limit 2
    `)).rows;
    if (staffUsers.length >= 2) {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: staffUsers[0].user_id, role: 'authenticated', aal: 'aal2' }),
      ]);
      const fvId = (await db.query(
        `select propose_fee_version(90, 40, 30, 120, 300, 'Staging standard 3PL fee schedule') as id`,
      )).rows[0].id;
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: staffUsers[1].user_id, role: 'authenticated', aal: 'aal2' }),
      ]);
      await db.query(`select activate_fee_version($1, 'Approved staging fee schedule')`, [fvId]);
      await db.query(`select set_config('request.jwt.claims', '', true)`);
    }
  }

  // 3. Ensure active duty_rate_versions with AE & GB defaults (leave US unseeded so i1b.test.mjs unknown-US check holds)
  const aeDuty = (await db.query(`select lookup_duty_rate('AE', null) as d`)).rows[0]?.d;
  const gbDuty = (await db.query(`select lookup_duty_rate('GB', null) as d`)).rows[0]?.d;
  if (!aeDuty || !gbDuty) {
    const dvId = (await db.query(
      `select create_duty_rate_version('Staging AE & GB tariff schedule', $1::jsonb) as id`,
      [
        JSON.stringify([
          { country: 'AE', hs_prefix: null, duty_bp: 500, tax_bp: 500, de_minimis_cents: 27000, de_minimis_applies_to: 'duty' },
          { country: 'GB', hs_prefix: null, duty_bp: 400, tax_bp: 2000, de_minimis_cents: 17000, de_minimis_applies_to: 'duty' },
        ]),
      ],
    )).rows[0].id;
    await db.query(`select activate_duty_rate_version($1)`, [dvId]);
  }

  // 4. Pick verified active Sourcing supplier_products on staging & ensure non-zero staging cost
  const verifiedSps = (await db.query(`
    select sp.id as sp_id, pr.id as prod_id, pr.item_id as src_item_id
    from supplier_products sp
    join products pr on pr.id = sp.product_id and pr.archived_at is null
    join suppliers s on s.id = sp.supplier_id and s.verified and s.archived_at is null
    order by s.code asc, pr.sku asc nulls last, sp.id asc
    limit 10
  `)).rows;

  const FALLBACK_COSTS = [680, 520, 890, 290, 540, 610];
  for (let i = 0; i < verifiedSps.length; i++) {
    const sp = verifiedSps[i];
    const hasCost = (await db.query(`select supplier_cost_cents from product_costs where product_id = $1`, [sp.prod_id])).rows[0];
    if (!hasCost || !hasCost.supplier_cost_cents || Number(hasCost.supplier_cost_cents) <= 0) {
      await db.query(
        `insert into product_costs (product_id, supplier_cost_cents)
         values ($1, $2)
         on conflict (product_id) do update set supplier_cost_cents = excluded.supplier_cost_cents`,
        [sp.prod_id, FALLBACK_COSTS[i % FALLBACK_COSTS.length]],
      );
    }
  }

  const adminActor = (await db.query(`
    select user_id from user_roles where role_code = 'admin' order by user_id asc limit 1
  `)).rows[0]?.user_id ?? null;

  const imgs = (await db.query(`
    select url from product_media
     where kind = 'image' and url is not null and url not like '%/import/%'
     order by created_at asc limit 6
  `)).rows.map((r) => r.url);
  const fallbackImg = imgs[0] || '/images/hero-warehouse.jpg';

  const ITEMS = [
    {
      ref: 'OCT-DS-TEST-001',
      title: 'TEST – Cordless LED Desk Lamp',
      description: 'TEST dropship product (staging only). Rechargeable aluminium desk lamp with 3 colour temperatures and touch dimmer. Ships in plain unbranded packaging.',
      category: 'Lighting',
      img: imgs[0] || fallbackImg,
      specs: { Material: 'Anodised aluminium', Battery: '4000 mAh USB-C', Brightness: '450 lm', ColourTemp: '3000K / 4500K / 6000K' },
      weight_g: 540,
      dims: { l: 34, w: 13, h: 9 },
      hs_code: '9405.21',
      has_battery: true,
      is_fragile: false,
      verify_hs: true,
      product_price_cents: 1290,
      moq: 1,
      source: 'own_warehouse',
      fulfilment: 'fast_ship',
      status: 'active',
      spIdx: 0,
      reuseSrcItem: false,
      tiers: [
        { min_qty: 1, unit_price_cents: 1290 },
        { min_qty: 10, unit_price_cents: 1190 },
        { min_qty: 50, unit_price_cents: 1090 },
      ],
      variants: [
        { ref: 'OCT-DS-TEST-001-BLK', options: { Colour: 'Matte Black' }, adj: 0, targetOnHand: 180 },
        { ref: 'OCT-DS-TEST-001-SLV', options: { Colour: 'Brushed Silver' }, adj: 100, targetOnHand: 140 },
      ],
      routes: [
        { country: 'AE', method: 'express', incoterm: 'DDP', landed: 2190, ship: 680, duty: 40, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'AE', method: 'standard', incoterm: 'DDP', landed: 1890, ship: 510, duty: 40, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'express', incoterm: 'DDP', landed: 2490, ship: 860, duty: 65, min: 4, max: 6, carrier: '4PX Direct UK', active: true },
        { country: 'GB', method: 'economy', incoterm: 'DDP', landed: 1990, ship: 520, duty: 65, min: 11, max: 16, carrier: '4PX Economy', active: true },
      ],
    },
    {
      ref: 'OCT-DS-TEST-002',
      title: 'TEST – Stainless Steel Insulated Tumbler 600ml',
      description: 'TEST dropship product (staging only). Double-wall vacuum insulated 304 stainless tumbler with leak-resistant flip lid.',
      category: 'Kitchen utensils',
      img: imgs[1] || fallbackImg,
      specs: { Capacity: '600 ml', Steel: '304 food-grade stainless', Insulation: 'Double-wall vacuum (12h hot / 24h cold)' },
      weight_g: 380,
      dims: { l: 21, w: 9, h: 9 },
      hs_code: '9617.00',
      has_battery: false,
      is_fragile: false,
      verify_hs: true,
      product_price_cents: 980,
      moq: 1,
      source: 'own_warehouse',
      fulfilment: 'fast_ship',
      status: 'active',
      spIdx: 1,
      reuseSrcItem: false,
      tiers: [],
      variants: [
        { ref: 'OCT-DS-TEST-002-NVY', options: { Colour: 'Deep Navy', Size: '600ml' }, adj: 0, targetOnHand: 300 },
        { ref: 'OCT-DS-TEST-002-SND', options: { Colour: 'Desert Sand', Size: '600ml' }, adj: 0, targetOnHand: 8 },
      ],
      routes: [
        { country: 'AE', method: 'express', incoterm: 'DDP', landed: 1650, ship: 540, duty: 26, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'AE', method: 'economy', incoterm: 'DDP', landed: 1390, ship: 360, duty: 26, min: 9, max: 14, carrier: 'YunExpress Economy', active: true },
        { country: 'GB', method: 'standard', incoterm: 'DDP', landed: 1790, ship: 610, duty: 42, min: 7, max: 10, carrier: '4PX Standard UK', active: true },
      ],
    },
    {
      ref: 'OCT-DS-TEST-003',
      title: 'TEST – Ergonomic Laptop Riser Stand',
      description: 'TEST dropship product (staging only). Foldable CNC-machined alloy laptop stand with non-slip silicone pads for 11–16 inch notebooks.',
      category: 'Electronics',
      img: imgs[2] || fallbackImg,
      specs: { Compatibility: '11–16 inch laptops', LoadCapacity: '10 kg', Finish: 'Sandblasted alloy' },
      weight_g: 710,
      dims: { l: 27, w: 23, h: 5 },
      hs_code: '7616.99',
      has_battery: false,
      is_fragile: false,
      verify_hs: true,
      product_price_cents: 1420,
      moq: 1,
      source: 'partner_supplier',
      fulfilment: 'extended_catalog',
      status: 'active',
      spIdx: 2,
      reuseSrcItem: true,
      tiers: [],
      variants: [
        { ref: 'OCT-DS-TEST-003-GRY', options: { Colour: 'Space Grey' }, adj: 0, targetOnHand: 0 },
      ],
      routes: [
        { country: 'AE', method: 'standard', incoterm: 'DDP', landed: 2250, ship: 640, duty: 48, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'standard', incoterm: 'DDP', landed: 2490, ship: 780, duty: 76, min: 7, max: 11, carrier: '4PX Standard UK', active: true },
      ],
    },
    {
      ref: 'OCT-DS-TEST-004',
      title: 'TEST – Braided USB-C 100W PD Fast Charge Cable (2m)',
      description: 'TEST dropship product (staging only). Nylon-braided USB-C to USB-C 100W Power Delivery cable with E-Marker chip.',
      category: 'Cables & wires',
      img: imgs[3] || fallbackImg,
      specs: { Length: '2.0 m', MaxPower: '100W (20V/5A)', Jacket: 'Double-braided nylon' },
      weight_g: 120,
      dims: { l: 14, w: 10, h: 2 },
      hs_code: '8544.42',
      has_battery: false,
      is_fragile: false,
      verify_hs: true,
      product_price_cents: 520,
      moq: 2,
      source: 'own_warehouse',
      fulfilment: 'fast_ship',
      status: 'active',
      spIdx: 3,
      reuseSrcItem: false,
      tiers: [],
      variants: [
        { ref: 'OCT-DS-TEST-004-2M', options: { Length: '2m', Colour: 'Charcoal' }, adj: 0, targetOnHand: 8 },
      ],
      routes: [
        { country: 'AE', method: 'express', incoterm: 'DDP', landed: 990, ship: 390, duty: 12, min: 3, max: 5, carrier: 'YunExpress Priority', active: true },
        { country: 'GB', method: 'express', incoterm: 'DDP', landed: 1150, ship: 480, duty: 20, min: 4, max: 6, carrier: '4PX Direct UK', active: true },
      ],
    },
    {
      ref: 'OCT-DS-TEST-005',
      title: 'TEST – Modular ABS Cable Organiser Box',
      description: 'TEST dropship product (staging only). Under-desk power strip and cable management box with ventilated bamboo-look lid.',
      category: 'Storage bins',
      img: imgs[4] || fallbackImg,
      specs: { Material: 'Flame-retardant ABS', EntrySlots: '6 directional slots', Ventilation: 'Bottom + side slots' },
      weight_g: 490,
      dims: { l: 32, w: 14, h: 13 },
      hs_code: '3924.90',
      has_battery: false,
      is_fragile: false,
      verify_hs: true,
      product_price_cents: 1090,
      moq: 1,
      source: 'partner_supplier',
      fulfilment: 'extended_catalog',
      status: 'active',
      spIdx: 4,
      reuseSrcItem: false,
      tiers: [],
      variants: [
        { ref: 'OCT-DS-TEST-005-WHT', options: { Colour: 'Warm White' }, adj: 0, targetOnHand: 0 },
        { ref: 'OCT-DS-TEST-005-BLK', options: { Colour: 'Graphite Black' }, adj: 0, targetOnHand: 0 },
      ],
      routes: [
        { country: 'AE', method: 'standard', incoterm: 'DDP', landed: 1750, ship: 530, duty: 31, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'GB', method: 'economy', incoterm: 'DDP', landed: 1850, ship: 590, duty: 49, min: 11, max: 16, carrier: '4PX Economy', active: true },
      ],
    },
    {
      ref: 'OCT-DS-TEST-006',
      title: 'TEST – Ceramic Pet Bowl Set',
      description: 'TEST dropship draft product (staging only). Two heavy ceramic bowls on a non-slip bamboo stand. Dishwasher safe.',
      category: 'Home',
      img: imgs[5] || fallbackImg,
      specs: { Material: 'Glazed stoneware + bamboo', Bowls: '2 × 450 ml' },
      weight_g: 1450,
      dims: { l: 26, w: 26, h: 12 },
      hs_code: '6912.00',
      has_battery: false,
      is_fragile: true,
      verify_hs: false,
      product_price_cents: 980,
      moq: 1,
      source: 'own_warehouse',
      fulfilment: 'fast_ship',
      status: 'draft',
      spIdx: 5,
      reuseSrcItem: false,
      tiers: [
        { min_qty: 1, unit_price_cents: 980 },
        { min_qty: 10, unit_price_cents: 920 },
        { min_qty: 50, unit_price_cents: 860 },
      ],
      variants: [
        { ref: 'OCT-DS-TEST-006-CRM', options: { Colour: 'Cream' }, adj: 0, targetOnHand: 120 },
      ],
      routes: [
        { country: 'AE', method: 'standard', incoterm: 'DDP', landed: 1660, ship: 490, duty: 70, min: 6, max: 9, carrier: 'YunExpress Standard', active: true },
        { country: 'SA', method: 'standard', incoterm: 'DDP', landed: 1810, ship: 610, duty: 0, min: 7, max: 10, carrier: 'YunExpress Standard KSA', active: false },
      ],
    },
  ];

  let firstProdId = null;
  for (const item of ITEMS) {
    const linkedSp = verifiedSps[item.spIdx % Math.max(1, verifiedSps.length)] ?? null;
    const spId = linkedSp?.sp_id ?? null;

    const existing = (await db.query(
      `select id from dropship_products where upper(btrim(legacy_sku)) = upper(btrim($1)) limit 1`,
      [item.ref],
    )).rows[0];

    let prodId;
    if (existing) {
      prodId = existing.id;
      await db.query(`
        update dropship_products set
          title = $2,
          description = $3,
          category = $4,
          images = array[$5::text],
          specs = $6,
          weight_g = $7,
          dimensions_cm = $8,
          min_order_qty = $9,
          source_type = $10,
          fulfilment_type = $11,
          origin_country = 'CN',
          product_price_cents = $12,
          status = $13,
          needs_review = false,
          needs_review_reason = null,
          is_test = true
        where id = $1
      `, [
        prodId,
        item.title,
        item.description,
        item.category,
        item.img,
        JSON.stringify(item.specs),
        item.weight_g,
        JSON.stringify(item.dims),
        item.moq,
        item.source,
        item.fulfilment,
        item.product_price_cents,
        item.status,
      ]);
    } else {
      const p = (await db.query(`
        insert into dropship_products (
          legacy_sku, title, description, category, images, specs, weight_g, dimensions_cm,
          min_order_qty, source_type, fulfilment_type, origin_country, product_price_cents, status, is_test
        ) values ($1,$2,$3,$4,array[$5::text],$6,$7,$8,$9,$10,$11,'CN',$12,$13,true)
        returning id
      `, [
        item.ref,
        item.title,
        item.description,
        item.category,
        item.img,
        JSON.stringify(item.specs),
        item.weight_g,
        JSON.stringify(item.dims),
        item.moq,
        item.source,
        item.fulfilment,
        item.product_price_cents,
        item.status,
      ])).rows[0];
      prodId = p.id;
    }
    if (!firstProdId && item.status === 'active') firstProdId = prodId;

    for (const [idx, v] of item.variants.entries()) {
      const exVar = (await db.query(
        `select id, item_id from dropship_variants where upper(btrim(legacy_sku)) = upper(btrim($1)) limit 1`,
        [v.ref],
      )).rows[0];

      let desiredItemId = null;
      if (item.reuseSrcItem && idx === 0 && linkedSp?.src_item_id) {
        const usedElsewhere = (await db.query(
          `select id from dropship_variants where item_id = $1 and ($2::uuid is null or id <> $2) limit 1`,
          [linkedSp.src_item_id, exVar?.id ?? null],
        )).rows[0];
        if (!usedElsewhere) desiredItemId = linkedSp.src_item_id;
      }

      let itemId;
      if (exVar) {
        itemId = desiredItemId || exVar.item_id;
        await db.query(`
          update dropship_variants set
            product_id = $2,
            options = $3,
            supplier_product_id = $4,
            item_id = $5,
            price_adjust_cents = $6,
            sort = $7
          where id = $1
        `, [exVar.id, prodId, JSON.stringify(v.options), spId, itemId, v.adj, idx]);
      } else {
        const insVar = (await db.query(`
          insert into dropship_variants (product_id, options, legacy_sku, supplier_product_id, item_id, price_adjust_cents, sort)
          values ($1, $2, $3, $4, $5, $6, $7)
          returning item_id
        `, [prodId, JSON.stringify(v.options), v.ref, spId, desiredItemId, v.adj, idx])).rows[0];
        itemId = insVar.item_id;
      }

      // Sync structured item_master fields
      await db.query(`
        update item_master set
          origin_country = 'CN',
          weight_g = $2,
          box_l_cm = $3,
          box_w_cm = $4,
          box_h_cm = $5,
          has_battery = $6,
          is_fragile = $7,
          hs_code = $8,
          hs_code_source = coalesce(hs_code_source, 'manual')
        where id = $1
      `, [itemId, item.weight_g, item.dims.l, item.dims.w, item.dims.h, item.has_battery, item.is_fragile, item.hs_code]);

      if (item.verify_hs && adminActor) {
        await db.query(`select set_config('octopus.allow_hs_verify', 'true', true)`);
        await db.query(
          `update item_master
              set hs_verified = true,
                  hs_verified_by = $2,
                  hs_verified_at = coalesce(hs_verified_at, now())
            where id = $1`,
          [itemId, adminActor],
        );
        await db.query(`select set_config('octopus.allow_hs_verify', '', true)`);
      }

      // Clear any needs_review triggered on active TEST product during seed sync
      if (item.status === 'active') {
        await db.query(`update dropship_products set needs_review = false, needs_review_reason = null where id = $1`, [prodId]);
      }

      if (item.fulfilment === 'fast_ship' && v.targetOnHand > 0 && itemId) {
        const ws = (await db.query(
          `select on_hand_qty from warehouse_stock where warehouse_id = 'SZ-01' and item_id = $1`,
          [itemId],
        )).rows[0];
        if (!ws || Number(ws.on_hand_qty) === 0) {
          await db.query(
            `select record_warehouse_stock_movement($1, 'inbound', $2, 'Staging test fast-ship stock seed', 'SZ-01', null)`,
            [itemId, v.targetOnHand],
          );
        }
      }
    }

    await db.query(`delete from dropship_price_tiers where product_id = $1`, [prodId]);
    for (const t of item.tiers) {
      await db.query(
        `insert into dropship_price_tiers (product_id, min_qty, unit_price_cents) values ($1, $2, $3)`,
        [prodId, t.min_qty, t.unit_price_cents],
      );
    }

    for (const r of item.routes) {
      await db.query(`
        insert into dropship_routes (product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, carrier, is_active)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (product_id, destination_country, shipping_method) do update set
          incoterm = excluded.incoterm,
          landed_price_cents = excluded.landed_price_cents,
          est_shipping_cents = excluded.est_shipping_cents,
          est_duties_cents = excluded.est_duties_cents,
          est_days_min = excluded.est_days_min,
          est_days_max = excluded.est_days_max,
          carrier = excluded.carrier,
          is_active = excluded.is_active
      `, [prodId, r.country, r.method, r.incoterm, r.landed, r.ship, r.duty, r.min, r.max, r.carrier, r.active]);
    }
  }

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
  console.log(`✔ seeded 6 TEST dropship products (5 active + 1 draft, verified supplier links, reused Sourcing item_id, 3PL stock, rate cards, fees & AE/GB duties) on staging`);
} catch (e) {
  await db.query('rollback').catch(() => {});
  throw e;
} finally {
  await db.end();
}
