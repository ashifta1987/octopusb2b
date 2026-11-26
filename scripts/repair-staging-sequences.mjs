// STAGING ONLY: puts code sequences back above the highest existing number (after a test reset them via wipe_demo_data in a rolled-back transaction).
import dotenv from 'dotenv'; dotenv.config({ path: '.env.staging' });
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
if ((await c.query(`select value #>> '{}' v from site_settings where key='app_environment'`)).rows[0]?.v !== 'staging') throw new Error('not staging');
const map = [['seq_supplier_code','suppliers','code','^OCT-(\\d+)$'],['seq_rfq','rfqs','code','^RFQ-(\\d+)$'],['seq_order','orders','code','^ORD-(\\d+)$'],['seq_shipment','shipments','code','^SHP-(\\d+)$'],['seq_ticket','tickets','code','^TKT-(\\d+)$'],['seq_pool','pools','code','^POOL-(\\d+)$'],['seq_service_request','service_requests','code','^SRV-(\\d+)$'],['seq_export','data_exports','code','^EX-(\\d+)$'],['seq_restore','restore_requests','code','^RS-(\\d+)$'],['seq_journal','journals','number','^JRN-(\\d+)$'],['seq_pi','proforma_invoices','number','^PI-\\d{4}-(\\d+)$'],['seq_invoice','documents','number','^INV-\\d{4}-(\\d+)$'],['seq_quote','quotes','code','^QT-(\\d+)$'],['seq_buyer_code','organizations','buyer_code','^BUYER-(\\d+)$']];
for (const [s, t, col, re] of map) {
  const mx = Number((await c.query(`select coalesce(max((substring(${col} from $1))::bigint), 0) m from ${t}`, [re])).rows[0].m);
  const lv = Number((await c.query(`select last_value from ${s}`)).rows[0].last_value);
  if (mx > lv) { await c.query(`select setval($1, $2, true)`, [s, mx]); console.log('fixed', s, lv, '->', mx); }
}
await c.end();
