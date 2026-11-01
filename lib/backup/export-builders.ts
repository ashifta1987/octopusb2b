import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS } from '@/components/backoffice/import-columns';

/**
 * Pure builders for business data exports (SPEC §16.1 layer 3). The worker (lib/backup/exports.ts) fetches raw rows;
 * these functions shape them into sheets and serialise to xlsx / csv / json. Never exported: KYC document files,
 * API key hashes or any secret-looking column (stripped by `sanitize`).
 * The `products` sheet uses exactly the bulk-upload template columns, so it can be re-imported (SPEC §16.3).
 */
export const EXPORT_MODULES = ['customers', 'suppliers', 'products', 'categories', 'orders', 'invoices', 'ledger', 'wallet', 'services', 'tickets', 'cms'] as const;
export type ExportModule = (typeof EXPORT_MODULES)[number];
export type Row = Record<string, unknown>;
export type Sheet = { name: string; module: ExportModule; columns: string[]; rows: Row[] };

const SECRET_KEY = /(hash|secret|password|token|private_key|api_key)/i;

/** Drops secret-looking keys; turns objects/arrays into JSON text. */
export function sanitize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  }
  return out;
}

/** For every `*_cents` / `*_minor` column add a decimal `*_amount` sibling (both currencies use 2 decimals). */
export function withAmounts(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v;
    const m = /^(.*)_(cents|minor)$/.exec(k);
    if (m && v !== null && v !== undefined && v !== '') out[`${m[1]}_amount`] = Number(v) / 100;
  }
  return out;
}

const cur = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? 'USD');
const byId = <T extends Row>(rows: T[], key = 'id') => new Map(rows.map((r) => [String(r[key]), r]));
const name = (m: Map<string, Row>, id: unknown, field = 'name') => (id ? ((m.get(String(id))?.[field] as string | undefined) ?? null) : null);
const columnsOf = (rows: Row[], preferred: string[] = []) => {
  const set = new Set(preferred);
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
};
const sheet = (module: ExportModule, name: string, rows: Row[], preferred?: string[]): Sheet => {
  const clean = rows.map((r) => sanitize(withAmounts(r)));
  return { module, name, rows: clean, columns: columnsOf(clean, preferred) };
};

/* ───────── categories ───────── */
export function categoryPaths(cats: Row[]) {
  const m = byId(cats);
  const cache = new Map<string, string>();
  const pathOf = (id: string, guard = 0): string => {
    if (cache.has(id)) return cache.get(id)!;
    const c = m.get(id);
    if (!c || guard > 20) return '';
    const parent = c.parent_id ? pathOf(String(c.parent_id), guard + 1) : '';
    const p = parent ? `${parent} > ${c.name}` : String(c.name);
    cache.set(id, p);
    return p;
  };
  return new Map(cats.map((c) => [String(c.id), pathOf(String(c.id))]));
}

export function buildCategories(cats: Row[]): Sheet[] {
  const paths = categoryPaths(cats);
  const rows = [...cats]
    .sort((a, b) => (paths.get(String(a.id)) ?? '').localeCompare(paths.get(String(b.id)) ?? ''))
    .map((c) => ({ category_path: paths.get(String(c.id)), name: c.name, slug: c.slug, level: c.level, hs_code: c.hs_code, sort: c.sort, active: c.active, id: c.id, parent_id: c.parent_id, created_at: c.created_at }));
  return [sheet('categories', 'categories', rows)];
}

/* ───────── products (template columns) ───────── */
export const PRODUCT_TEMPLATE_COLUMNS: string[] = IMPORT_COLUMNS.map((c) => c.key);

export function buildProducts(products: Row[], tiers: Row[], cats: Row[], suppliers: Row[]): Sheet[] {
  const paths = categoryPaths(cats);
  const sup = byId(suppliers);
  const tiersBy = new Map<string, Row[]>();
  for (const t of tiers) {
    const k = String(t.product_id);
    if (!tiersBy.has(k)) tiersBy.set(k, []);
    tiersBy.get(k)!.push(t);
  }
  for (const list of tiersBy.values()) list.sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
  const yn = (v: unknown) => (v ? 'yes' : 'no');
  const template: Row[] = [];
  const meta: Row[] = [];
  for (const p of products) {
    const ts = tiersBy.get(String(p.id)) ?? [];
    const currency = cur(ts[0]?.currency ?? p.currency);
    const t = (i: number, f: 'min_qty' | 'unit_price_cents') => (ts[i] ? (f === 'min_qty' ? Number(ts[i].min_qty) : Number(ts[i].unit_price_cents) / 100) : null);
    const row: Row = {
      title: p.title,
      category_path: paths.get(String(p.category_id)) ?? '',
      supplier_code: name(sup, p.supplier_id, 'code'),
      unit: p.unit,
      moq: p.moq,
      lead_time_days: p.lead_time_days,
      incoterm: p.incoterm,
      origin_country: p.origin_country,
      hs_code: p.hs_code,
      currency,
      tier1_qty: t(0, 'min_qty'),
      tier1_price: t(0, 'unit_price_cents'),
      tier2_qty: t(1, 'min_qty'),
      tier2_price: t(1, 'unit_price_cents'),
      tier3_qty: t(2, 'min_qty'),
      tier3_price: t(2, 'unit_price_cents'),
      octopus_dropship: yn(p.octopus_dropship),
      ready_to_ship: yn(p.ready_to_ship),
      description: p.description,
    };
    template.push(Object.fromEntries(PRODUCT_TEMPLATE_COLUMNS.map((k) => [k, row[k] ?? null])));
    meta.push({
      id: p.id, slug: p.slug, title: p.title, status: p.status, supplier_code: row.supplier_code, category_path: row.category_path, currency,
      tiers: ts.map((x) => `${x.min_qty}@${(Number(x.unit_price_cents) / 100).toFixed(2)} ${cur(x.currency)}`).join('; '),
      featured: p.featured, image_url: p.image_url, created_at: p.created_at, updated_at: p.updated_at, archived_at: p.archived_at,
    });
  }
  return [
    // template sheet: no derived *_amount columns, exactly the bulk-upload header
    { module: 'products', name: 'products', columns: PRODUCT_TEMPLATE_COLUMNS, rows: template.map(sanitize) },
    sheet('products', 'products_details', meta),
  ];
}

/* ───────── customers / suppliers ───────── */
export function buildCustomers(orgs: Row[], kyc: Row[]): Sheet[] {
  const latest = new Map<string, Row>();
  for (const k of [...kyc].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) latest.set(String(k.org_id), k);
  const rows = orgs.map((o) => {
    const k = latest.get(String(o.id));
    return {
      id: o.id, name: o.name, country: o.country, city: o.city, business_type: o.business_type, registration_no: o.registration_no, website: o.website,
      kyc_status: o.kyc_status, kyc_submission_status: k?.status ?? null, kyc_company_name: k?.company_name ?? null, kyc_contact_name: k?.contact_name ?? null,
      kyc_contact_email: k?.contact_email ?? null, kyc_submitted_at: k?.submitted_at ?? null, kyc_reviewed_at: k?.reviewed_at ?? null,
      created_at: o.created_at, archived_at: o.archived_at,
    };
  });
  return [sheet('customers', 'customers', rows)];
}

export function buildSuppliers(suppliers: Row[]): Sheet[] {
  const rows = suppliers.map((s) => ({
    code: s.code, legal_name: s.legal_name, country: s.country, city: s.city, supplier_type: s.supplier_type, verified: s.verified, main_categories: s.main_categories,
    contact_name: s.contact_name, contact_email: s.contact_email, contact_phone: s.contact_phone, id: s.id, created_at: s.created_at, archived_at: s.archived_at,
  }));
  return [sheet('suppliers', 'suppliers', rows)];
}

/* ───────── money modules (every amount with its own currency) ───────── */
export function buildOrders(orders: Row[], orgs: Row[], suppliers: Row[]): Sheet[] {
  const o = byId(orgs);
  const s = byId(suppliers);
  const rows = orders.map((r) => ({
    code: r.code, customer: name(o, r.org_id), supplier_code: name(s, r.supplier_id, 'code'), status: r.status, title: r.title, quantity: r.quantity, currency: cur(r.currency),
    unit_price_cents: r.unit_price_cents, shipping_cents: r.shipping_cents, total_cents: r.total_cents, deposit_pct: r.deposit_pct, deposit_cents: r.deposit_cents, paid_cents: r.paid_cents,
    incoterm: r.incoterm, delivered_at: r.delivered_at, created_at: r.created_at, updated_at: r.updated_at, id: r.id,
  }));
  return [sheet('orders', 'orders', rows)];
}

export function buildInvoices(docs: Row[], orgs: Row[], orders: Row[], suppliers: Row[]): Sheet[] {
  const o = byId(orgs);
  const ord = byId(orders);
  const s = byId(suppliers);
  const rows = docs.map((d) => ({
    number: d.number, doc_type: d.doc_type, status: d.status, customer: name(o, d.org_id), supplier_code: name(s, d.supplier_id, 'code'), order_code: name(ord, d.order_id, 'code'),
    currency: cur(d.currency), amount_cents: d.amount_cents, emailed_at: d.emailed_at, created_at: d.created_at, id: d.id,
  }));
  return [sheet('invoices', 'invoices', rows)];
}

export function buildLedger(entries: Row[], journals: Row[], accounts: Row[], orgs: Row[]): Sheet[] {
  const j = byId(journals);
  const a = byId(accounts);
  const o = byId(orgs);
  const rows = entries.map((e) => {
    const jr = j.get(String(e.journal_id));
    const ac = a.get(String(e.account_id));
    return {
      entry_id: e.id, created_at: e.created_at, journal: jr?.number ?? e.journal_id, stream: jr?.stream ?? null, ref_type: jr?.ref_type ?? null,
      account_code: ac?.code ?? null, account_name: ac?.name ?? null, account_kind: ac?.kind ?? null, customer: name(o, e.org_id),
      currency: cur(e.currency), debit_cents: e.debit_cents, credit_cents: e.credit_cents, memo: e.memo,
    };
  });
  return [sheet('ledger', 'ledger', rows)];
}

export function buildWallet(wallets: Row[], topups: Row[], orgs: Row[]): Sheet[] {
  const o = byId(orgs);
  return [
    sheet('wallet', 'wallet_balances', wallets.map((w) => ({ customer: name(o, w.org_id), currency: cur(w.currency), balance_minor: w.balance_minor, org_id: w.org_id }))),
    sheet('wallet', 'wallet_topups', topups.map((t) => ({ customer: name(o, t.org_id), currency: cur(t.currency), amount_cents: t.amount_cents, method: t.method, reference: t.reference, status: t.status, created_at: t.created_at, id: t.id }))),
  ];
}

/* ───────── services / tickets / cms ───────── */
export function buildServices(services: Row[], prices: Row[]): Sheet[] {
  return [
    sheet('services', 'services', services.map((s) => ({ code: s.code, name: s.name, description: s.description, unit: s.unit, active: s.active, sort: s.sort, created_at: s.created_at }))),
    sheet('services', 'service_prices', prices.map((p) => ({ service_code: p.service_code, currency: cur(p.currency), amount_minor: p.amount_minor, effective_from: p.effective_from, created_at: p.created_at }))),
  ];
}

export function buildTickets(tickets: Row[], messages: Row[], orgs: Row[], orders: Row[]): Sheet[] {
  const o = byId(orgs);
  const ord = byId(orders);
  const t = byId(tickets);
  return [
    sheet('tickets', 'tickets', tickets.map((x) => ({
      code: x.code, customer: name(o, x.org_id), order_code: name(ord, x.order_id, 'code'), subject: x.subject, category: x.category, priority: x.priority, status: x.status,
      csat: x.csat, sla_due_at: x.sla_due_at, created_at: x.created_at, updated_at: x.updated_at,
    }))),
    sheet('tickets', 'ticket_messages', messages.map((m) => ({
      ticket: name(t, m.ticket_id, 'code'), from_staff: m.is_staff, internal: m.internal, body: m.body,
      attachments: Array.isArray(m.attachments) ? m.attachments.length : 0, // file names only live in Storage — files are not exported
      created_at: m.created_at,
    }))),
  ];
}

export function buildCms(blocks: Row[], pages: Row[], terms: Row[], company: Row[], branches: Row[]): Sheet[] {
  return [
    sheet('cms', 'content_blocks', blocks.map((b) => ({ key: b.key, value: b.value, status: b.status, updated_at: b.updated_at }))),
    sheet('cms', 'pages', pages.map((p) => ({ slug: p.slug, title: p.title, status: p.status, is_legal: p.is_legal, body: p.body, published_at: p.published_at, updated_at: p.updated_at }))),
    sheet('cms', 'terms_versions', terms.map((t) => ({ version: t.version, status: t.status, sections: t.sections, publish_at: t.publish_at, published_at: t.published_at, created_at: t.created_at }))),
    sheet('cms', 'company', company.map((c) => ({ ...c }))),
    sheet('cms', 'branches', branches.map((b) => ({ name: b.name, city: b.city, country: b.country, address: b.address, phone: b.phone, email: b.email, sort: b.sort, active: b.active, city_local: b.city_local, province: b.province, badge: b.badge, is_hq: b.is_hq, tagline: b.tagline, specialities: Array.isArray(b.specialities) ? (b.specialities as string[]).join(', ') : b.specialities, description: b.description, hours: b.hours }))),
  ];
}

/* ───────── serialisers ───────── */
const cell = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** RFC 4180 CSV with a UTF-8 BOM (Excel opens Chinese text correctly). */
export function toCsv(s: Pick<Sheet, 'columns' | 'rows'>) {
  const esc = (v: unknown) => {
    const t = cell(v);
    return /[",\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [s.columns.map(esc).join(','), ...s.rows.map((r) => s.columns.map((c) => esc(r[c])).join(','))];
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export function toJson(sheets: Sheet[], meta: Row) {
  const out: Record<string, unknown> = { _meta: meta };
  for (const s of sheets) out[s.name] = s.rows;
  return JSON.stringify(out, null, 2);
}

export async function toXlsx(sheets: Sheet[], meta: Row) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octopus B2B';
  wb.created = new Date();
  const used = new Set<string>();
  for (const s of sheets) {
    let n = s.name.slice(0, 31);
    for (let i = 2; used.has(n); i++) n = `${s.name.slice(0, 28)}_${i}`;
    used.add(n);
    const ws = wb.addWorksheet(n, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c, key: c, width: Math.min(60, Math.max(10, c.length + 2)) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11133C' } };
    for (const r of s.rows) ws.addRow(Object.fromEntries(s.columns.map((c) => [c, r[c] === undefined ? null : (r[c] as ExcelJS.CellValue)])));
  }
  const info = wb.addWorksheet('About');
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 80;
  for (const [k, v] of Object.entries(meta)) info.addRow([k, cell(v)]);
  info.addRow([]);
  info.addRow(['note', 'Amounts: *_cents / *_minor are minor units of the row currency; *_amount is the decimal value. The "products" sheet matches the bulk-upload template and can be re-imported.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function rowCounts(sheets: Sheet[]) {
  return Object.fromEntries(sheets.map((s) => [s.name, s.rows.length]));
}

/** Inclusive date range filter → [gte, lt) ISO bounds on created_at. */
export function dateBounds(from: string | null | undefined, to: string | null | undefined) {
  const gte = from ? new Date(`${from}T00:00:00Z`).toISOString() : null;
  const lt = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000).toISOString() : null;
  return { gte, lt };
}
