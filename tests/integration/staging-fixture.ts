import pg from 'pg';
import { assertStagingOrThrow } from '../../scripts/lib-staging-guard.mjs';

/**
 * Shared STAGING-ONLY guard and temporary fixture setup for Vitest integration tests.
 * Refuses to run unless env + database are staging. Creates a temporary open quote and shipped order with
 * tracking event only when missing for the demo buyer org, and deletes every row it created in cleanup().
 */
export async function setupIntegrationFixtures(orgId: string) {
  await assertStagingOrThrow();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const created = { rfqId: '', quoteId: '', orderId: '', shipmentId: '', trackingId: '' };
  try {
    await assertStagingOrThrow(db);
    const hasQuote = (await db.query(
      `select q.id from quotes q join rfqs r on r.id = q.rfq_id where r.org_id = $1 and q.status in ('sent','viewed') and q.valid_until > now() limit 1`,
      [orgId],
    )).rows[0];
    if (!hasQuote) {
      const sup = (await db.query(`select id from suppliers where verified limit 1`)).rows[0];
      if (!sup) throw new Error('staging-fixture: no verified supplier found');
      const rfq = (await db.query(
        `insert into rfqs(org_id, title, quantity, unit, status, division_id, is_seed) values ($1, 'Integration Test RFQ', 500, 'pcs', 'quoted', division_id_of('SRC'), true) returning id`,
        [orgId],
      )).rows[0];
      created.rfqId = rfq.id;
      const qt = (await db.query(
        `insert into quotes(code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, status, valid_until, currency)
         values ('QT-INT-' || floor(random()*1e6), $1, $2, 250, 500, 'FOB', 14, 0, 'sent', now() + interval '7 days', 'USD') returning id`,
        [rfq.id, sup.id],
      )).rows[0];
      created.quoteId = qt.id;
    }

    const hasShip = (await db.query(
      `select s.id from shipments s join tracking_events e on e.shipment_id = s.id where s.org_id = $1 limit 1`,
      [orgId],
    )).rows[0];
    if (!hasShip) {
      const ord = (await db.query(
        `insert into orders(org_id, status, title, quantity, unit_price_cents, total_cents, deposit_cents, division_id, currency, is_seed)
         values ($1, 'shipped', 'Integration Test Shipped Order', 100, 250, 25000, 7500, division_id_of('SRC'), 'USD', true) returning id`,
        [orgId],
      )).rows[0];
      created.orderId = ord.id;
      const sh = (await db.query(
        `insert into shipments(code, org_id, order_id, carrier_code, service_code, tracking_no, status, division_id, is_seed)
         values ('SHP-INT-' || floor(random()*1e6), $1, $2, 'yunexpress', 'standard', 'INT-TRK-' || floor(random()*1e8), 'in_transit', division_id_of('SRC'), true) returning id`,
        [orgId, ord.id],
      )).rows[0];
      created.shipmentId = sh.id;
      const tr = (await db.query(
        `insert into tracking_events(org_id, shipment_id, provider_event_id, status, description, location, occurred_at)
         values ($1, $2, 'int-ev-' || gen_random_uuid(), 'in_transit', 'Departed facility', 'Shenzhen, CN', now()) returning id`,
        [orgId, sh.id],
      )).rows[0];
      created.trackingId = tr.id;
    }
  } finally {
    await db.end();
  }

  return async function cleanup() {
    if (!Object.values(created).some(Boolean)) return;
    await assertStagingOrThrow();
    const cdb = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await cdb.connect();
    try {
      await assertStagingOrThrow(cdb);
      await cdb.query('begin');
      if (created.trackingId) await cdb.query(`delete from tracking_events where id = $1`, [created.trackingId]);
      if (created.shipmentId) await cdb.query(`delete from shipments where id = $1`, [created.shipmentId]);
      if (created.orderId) {
        await cdb.query(`delete from order_events where order_id = $1`, [created.orderId]);
        await cdb.query(`delete from status_history where entity_id = $1`, [created.orderId]);
        await cdb.query(`delete from orders where id = $1`, [created.orderId]);
      }
      if (created.quoteId) await cdb.query(`delete from quotes where id = $1`, [created.quoteId]);
      if (created.rfqId) await cdb.query(`delete from rfqs where id = $1`, [created.rfqId]);
      await cdb.query('commit');
    } catch (e) {
      await cdb.query('rollback').catch(() => {});
      throw e;
    } finally {
      await cdb.end();
    }
  };
}
