import 'server-only';
import { getEmail } from '@/lib/adapters';
import type { createAdminClient } from '@/lib/supabase/server';
import {
  EXPORT_MODULES, buildCategories, buildCms, buildCustomers, buildInvoices, buildLedger, buildOrders, buildProducts, buildServices, buildSuppliers, buildTickets, buildWallet,
  dateBounds, rowCounts, toCsv, toJson, toXlsx, type ExportModule, type Row, type Sheet,
} from './export-builders';

type Sb = ReturnType<typeof createAdminClient>;
type Range = { gte: string | null; lt: string | null };

export const EXPORTS_BUCKET = 'exports';
const PAGE = 1000;

/** Paginated service-role read. `range` filters `created_at` (only on the module's primary tables). */
export async function fetchAll(sb: Sb, table: string, select = '*', range?: Range, order = 'created_at'): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(select);
    if (range?.gte) q = q.gte('created_at', range.gte);
    if (range?.lt) q = q.lt('created_at', range.lt);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Fetches the rows for one module and builds its sheets. */
export async function buildModule(sb: Sb, m: ExportModule, range: Range): Promise<Sheet[]> {
  const lookup = new Map<string, Promise<Row[]>>();
  const once = (key: string, fn: () => Promise<Row[]>) => {
    if (!lookup.has(key)) lookup.set(key, fn());
    return lookup.get(key)!;
  };
  const orgs = () => once('orgs', () => fetchAll(sb, 'organizations', 'id, name'));
  const sups = () => once('sups', () => fetchAll(sb, 'suppliers', 'id, code'));
  switch (m) {
    case 'customers':
      return buildCustomers(
        await fetchAll(sb, 'organizations', 'id, name, country, city, business_type, registration_no, website, kyc_status, created_at, archived_at', range),
        // KYC status only — never the document files (kyc_documents / Storage bucket "kyc")
        await fetchAll(sb, 'kyc_submissions', 'org_id, status, company_name, contact_name, contact_email, submitted_at, reviewed_at, created_at'),
      );
    case 'suppliers':
      return buildSuppliers(await fetchAll(sb, 'suppliers', 'id, code, legal_name, country, city, supplier_type, contact_name, contact_email, contact_phone, verified, main_categories, created_at, archived_at', range));
    case 'products': {
      const products = await fetchAll(
        sb, 'products',
        'id, slug, title, description, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm, origin_country, hs_code, octopus_dropship, ready_to_ship, featured, image_url, currency, created_at, updated_at, archived_at',
        range,
      );
      const tiers = await fetchAll(sb, 'price_tiers', 'product_id, min_qty, unit_price_cents, currency', undefined, 'min_qty');
      const ids = new Set(products.map((p) => String(p.id)));
      return buildProducts(products, tiers.filter((t) => ids.has(String(t.product_id))), await fetchAll(sb, 'categories', 'id, parent_id, name', undefined, 'sort'), await sups());
    }
    case 'categories':
      return buildCategories(await fetchAll(sb, 'categories', 'id, parent_id, name, slug, level, hs_code, sort, active, created_at', undefined, 'sort'));
    case 'orders':
      return buildOrders(
        await fetchAll(sb, 'orders', 'id, code, org_id, supplier_id, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, incoterm, delivered_at, created_at, updated_at', range),
        await orgs(), await sups(),
      );
    case 'invoices':
      return buildInvoices(
        await fetchAll(sb, 'documents', 'id, number, doc_type, status, org_id, supplier_id, order_id, amount_cents, currency, emailed_at, created_at', range),
        await orgs(), await once('orders', () => fetchAll(sb, 'orders', 'id, code')), await sups(),
      );
    case 'ledger':
      return buildLedger(
        await fetchAll(sb, 'ledger_entries', 'id, journal_id, account_id, org_id, debit_cents, credit_cents, currency, memo, created_at', range, 'id'),
        await fetchAll(sb, 'journals', 'id, number, stream, ref_type'),
        await fetchAll(sb, 'ledger_accounts', 'id, code, name, kind'),
        await orgs(),
      );
    case 'wallet':
      return buildWallet(
        await fetchAll(sb, 'wallets', 'org_id, currency, balance_minor', undefined, 'org_id'),
        await fetchAll(sb, 'wallet_topups', 'id, org_id, amount_cents, currency, method, reference, status, created_at', range),
        await orgs(),
      );
    case 'services':
      return buildServices(
        await fetchAll(sb, 'services', 'code, name, description, unit, active, sort, created_at', undefined, 'sort'),
        await fetchAll(sb, 'service_prices', 'service_code, amount_minor, currency, effective_from, created_at', range),
      );
    case 'tickets': {
      const tickets = await fetchAll(sb, 'tickets', 'id, code, org_id, order_id, subject, category, priority, status, csat, sla_due_at, created_at, updated_at', range);
      const ids = new Set(tickets.map((t) => String(t.id)));
      const msgs = (await fetchAll(sb, 'ticket_messages', 'ticket_id, is_staff, internal, body, attachments, created_at')).filter((x) => ids.has(String(x.ticket_id)));
      return buildTickets(tickets, msgs, await orgs(), await once('orders', () => fetchAll(sb, 'orders', 'id, code')));
    }
    case 'cms':
      return buildCms(
        await fetchAll(sb, 'content_blocks', 'key, value, status, updated_at', undefined, 'key'),
        await fetchAll(sb, 'pages', 'slug, title, body, status, is_legal, published_at, updated_at', undefined, 'slug'),
        await fetchAll(sb, 'terms_versions', 'version, status, sections, publish_at, published_at, created_at'),
        await fetchAll(sb, 'company_profile', 'legal_name, brand, tagline, address, address_cn, contact_person, phone, whatsapp, email, website, updated_at', undefined, 'updated_at'),
        await fetchAll(sb, 'branches', 'name, city, country, address, phone, email, sort, active, city_local, province, badge, is_hq, tagline, specialities, description, hours', undefined, 'sort'),
      );
  }
}

export type ExportRow = {
  id: string; code: string; title: string | null; modules: string[]; date_from: string | null; date_to: string | null;
  format: 'xlsx' | 'csv' | 'json'; status: string; email_link: boolean; created_by: string | null; file_path: string | null;
};

const CONTENT_TYPES = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8', json: 'application/json' } as const;

/**
 * Export worker: builds the file(s), stores them privately in bucket `exports` (`<code>/…`), updates data_exports,
 * and emails a signed link when requested. CSV = one file per sheet under `<code>/` (file_path is the folder).
 */
export async function runExport(sb: Sb, id: string, opts: { force?: boolean } = {}) {
  const { data: ex, error } = await sb.from('data_exports').select('id, code, title, modules, date_from, date_to, format, status, email_link, created_by, file_path').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ex) return { ok: false as const, status: 'missing', error: 'NOT_FOUND' };
  const row = ex as ExportRow;
  if (!opts.force && (row.status === 'running' || row.status === 'ready')) return { ok: true as const, status: row.status, file_path: row.file_path };

  // claim (queued/failed → running) so two workers never build the same export
  const { data: claimed } = await sb.from('data_exports').update({ status: 'running', error: null }).eq('id', id).in('status', opts.force ? ['queued', 'failed', 'ready', 'running'] : ['queued', 'failed']).select('id');
  if (!claimed?.length) return { ok: true as const, status: 'running' };

  try {
    const range = dateBounds(row.date_from, row.date_to);
    const modules = row.modules.filter((m): m is ExportModule => (EXPORT_MODULES as readonly string[]).includes(m));
    const sheets: Sheet[] = [];
    for (const m of modules) sheets.push(...(await buildModule(sb, m, range)));
    const meta = { export: row.code, title: row.title ?? '', modules: modules.join(', '), date_from: row.date_from ?? '', date_to: row.date_to ?? '', generated_at: new Date().toISOString(), format: row.format };

    const stem = `octopus-export-${row.code}`;
    const files: { path: string; body: Buffer; type: string }[] = [];
    if (row.format === 'xlsx') files.push({ path: `${row.code}/${stem}.xlsx`, body: await toXlsx(sheets, meta), type: CONTENT_TYPES.xlsx });
    else if (row.format === 'json') files.push({ path: `${row.code}/${stem}.json`, body: Buffer.from(toJson(sheets, meta)), type: CONTENT_TYPES.json });
    else for (const s of sheets) files.push({ path: `${row.code}/${s.name}.csv`, body: Buffer.from(toCsv(s)), type: CONTENT_TYPES.csv });

    for (const f of files) {
      const { error: upErr } = await sb.storage.from(EXPORTS_BUCKET).upload(f.path, f.body, { contentType: f.type, upsert: true });
      if (upErr) throw new Error(`upload ${f.path}: ${upErr.message}`);
    }
    const filePath = row.format === 'csv' ? `${row.code}/` : files[0].path;
    const size = files.reduce((a, f) => a + f.body.length, 0);
    const counts = rowCounts(sheets);
    const { error: updErr } = await sb
      .from('data_exports')
      .update({ status: 'ready', file_path: filePath, size_bytes: size, row_counts: counts, finished_at: new Date().toISOString(), error: null })
      .eq('id', id);
    if (updErr) throw new Error(updErr.message);
    await sb.from('audit_log').insert({ action: 'export.ready', entity: 'data_exports', entity_id: id, details: { code: row.code, size, files: files.length } });

    if (row.email_link) await emailExport(sb, row, files.map((f) => f.path)).catch((e) => console.error('[exports] email failed', e));
    return { ok: true as const, status: 'ready', file_path: filePath, size_bytes: size, row_counts: counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('data_exports').update({ status: 'failed', error: msg.slice(0, 2000), finished_at: new Date().toISOString() }).eq('id', id);
    return { ok: false as const, status: 'failed', error: msg };
  }
}

/** Lists the stored file paths of an export (csv = several files in the folder). */
export async function exportFiles(sb: Sb, filePath: string) {
  if (!filePath.endsWith('/')) return [filePath];
  const { data, error } = await sb.storage.from(EXPORTS_BUCKET).list(filePath.replace(/\/$/, ''), { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((o) => o.id !== null).map((o) => `${filePath}${o.name}`);
}

async function emailExport(sb: Sb, row: ExportRow, paths: string[]) {
  let to: string | null = null;
  if (row.created_by) {
    const { data } = await sb.from('profiles').select('email').eq('id', row.created_by).maybeSingle();
    to = (data?.email as string | undefined) ?? null;
  }
  if (!to) {
    const { data } = await sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
    to = ((data?.value as Record<string, unknown> | null)?.alert_email as string | undefined) ?? null;
  }
  if (!to) return;
  const links: string[] = [];
  for (const p of paths.slice(0, 20)) {
    const { data } = await sb.storage.from(EXPORTS_BUCKET).createSignedUrl(p, 24 * 3600);
    if (data?.signedUrl) links.push(`<li><a href="${data.signedUrl}">${p.split('/').pop()}</a></li>`);
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  await getEmail().send({
    to,
    subject: `Your Octopus B2B data export ${row.code} is ready`,
    html: `<p>Your export <b>${row.code}</b>${row.title ? ` (${escapeHtml(row.title)})` : ''} is ready.</p><ul>${links.join('')}</ul>
      <p>These links expire in 24 hours. You can download it again from <a href="${site}/admin/backups">Admin → Backup &amp; restore</a>.</p>`,
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
