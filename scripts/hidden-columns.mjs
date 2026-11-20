// Columns that customers and the public key must never read (migration 195). Single source of truth for:
//  · the migration's column grants (generated SQL is checked against this list by the test),
//  · scripts/check-column-reads.mjs (no app code may read them with a session/public client),
//  · supabase/tests/customer-columns.test.mjs and tests/api/customer-columns.api.test.mjs.
// Rule (19 Nov 2026): internal by default — if unsure, hide it from customers and list it.
export const HIDDEN_COLUMNS = {
  // catalogue (public)
  products: ['supplier_id', 'rejection_reason', 'created_by', 'is_seed', 'external_id', 'factory_model', 'specification_raw',
    'selling_points_raw', 'size_notes', 'import_notes', 'markup_pct', 'sell_price_mode', 'sku_norm', 'listing_status',
    'moderation_hold', 'moderation_hold_reason', 'hs_code_source', 'hs_code_confidence', 'hs_code_status', 'hs_product_type_id',
    'hs_classify_pending', 'hs_code_note', 'archived_by_supplier_from'],
  product_media: ['storage_path', 'source_file_name', 'sha256'],
  certificates: ['supplier_id', 'number', 'storage_path'],
  pools: ['supplier_id', 'starter_user_id', 'starter_org_id', 'po_document_id', 'trace_id', 'is_seed'],
  pool_events: ['title', 'body', 'trace_id'],   // raw texts carry buyer Customer IDs; public reads pool_public_events
  turnkey_equipment: ['supplier_id', 'supplier_hint', 'notes'],
  turnkey_projects: ['is_seed'],
  turnkey_leads: ['assigned_to', 'assigned_at', 'floor_plan_storage_path', 'is_seed'],
  turnkey_packages: ['starting_budget_notes'],
  ad_campaigns: ['is_seed'],
  ad_clicks: ['trace_id'],
  home_banners: ['updated_by'],
  site_media: ['updated_by'],
  pages: ['updated_by'],
  content_blocks: ['updated_by'],
  company_bank_accounts: ['updated_by'],
  company_services: ['updated_by'],
  categories: ['is_seed'],
  tags: ['is_seed'],
  fx_rates: ['set_by', 'note', 'source'],
  service_prices: ['created_by'],
  terms_versions: ['created_by', 'reviewed_by'],
  site_settings: ['updated_by'],
  // customer-own rows
  orders: ['supplier_id', 'trace_id', 'is_seed'],
  quotes: ['supplier_id', 'created_by', 'trace_id', 'is_seed'],
  documents: ['supplier_id', 'emailed_at', 'trace_id', 'is_seed'],
  rfqs: ['assigned_to', 'trace_id', 'is_seed'],
  service_requests: ['assigned_to', 'trace_id', 'is_seed', 'idempotency_key'],
  tickets: ['assigned_to', 'trace_id', 'is_seed'],
  ticket_messages: ['trace_id'],
  escalations: ['reason', 'confidence', 'excerpt', 'assigned_to', 'taken_by_staff_id', 'outcome', 'trace_id'],
  assistant_messages: ['confidence', 'tools_called', 'tokens', 'latency_ms', 'trace_id', 'is_seed'],
  assistant_sessions: ['is_seed'],
  account_managers: ['reason', 'assigned_by', 'trace_id'],
  kyc_submissions: ['reviewer_id', 'internal_note', 'trace_id'],
  wallet_topups: ['confirmed_by', 'received_note', 'trace_id', 'is_seed'],
  wallet_credit_limits: ['note', 'set_by'],
  shipments: ['carrier_code', 'trace_id', 'is_seed'],
  tracking_events: ['provider_event_id', 'trace_id'],
  order_events: ['created_by', 'trace_id'],
  payments: ['matched_by', 'provider_event_id', 'trace_id', 'is_seed'],
  proforma_invoices: ['trace_id', 'is_seed'],
  pool_pledges: ['trace_id', 'is_seed'],
  brand_projects: ['admin_emailed_at'],
  notifications: ['trace_id', 'dedupe_key'],
  ledger_entries: ['trace_id', 'is_seed'],
  journals: ['created_by', 'trace_id', 'is_seed'],
  webhook_deliveries: ['trace_id'],
  document_payments: ['idempotency_key', 'created_by'],
  wallet_holds: ['created_by'],
  organizations: ['is_seed'],
  profiles: ['invited_by'],
  // migration 196: dropship seller brand / return address — the staff review note and reviewer stay internal
  dropship_seller_profiles: ['review_note', 'reviewed_by'],
};

// ── Run directly (node scripts/hidden-columns.mjs) to compare this list with the STAGING database grants. ──
// Importing this file does nothing else; running it goes through the staging guard like every other staging script
// and refuses unless the Supabase URL and the database are the staging project.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadStagingEnvOrExit, assertStagingDatabase } = await import('./lib-staging-guard.mjs');
  loadStagingEnvOrExit();
  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await assertStagingDatabase(db);
  let drift = 0;
  for (const [t, cols] of Object.entries(HIDDEN_COLUMNS)) {
    const hidden = (await db.query(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1
      and not has_column_privilege('authenticated', format('public.%I', $1::text), column_name, 'SELECT') order by 1`, [t])).rows.map((r) => r.c);
    const want = [...cols].sort();
    if (JSON.stringify(hidden) !== JSON.stringify(want)) { drift++; console.log(`✘ ${t}: database hides [${hidden}] — list says [${want}]`); }
  }
  await db.end();
  console.log(drift ? `${drift} table(s) differ from the staging database` : `✔ all ${Object.keys(HIDDEN_COLUMNS).length} tables match the staging database`);
  process.exitCode = drift ? 1 : 0;
}
