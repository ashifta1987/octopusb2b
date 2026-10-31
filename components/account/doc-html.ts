import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES, humanize } from '@/lib/format';

/**
 * Print-ready, self-contained HTML for customer documents (Invoice.png).
 * Seller is always company_profile; suppliers appear only by code (public_suppliers view).
 */

export const DOC_TITLE: Record<string, string> = {
  proforma_invoice: 'Proforma invoice',
  commercial_invoice: 'Commercial invoice',
  receipt: 'Receipt',
  confirmation: 'Order confirmation',
  statement: 'Statement',
  credit_note: 'Credit note',
  qc_report: 'QC report',
  purchase_order: 'Purchase order',
  remittance: 'Remittance',
};

export function esc(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!);
}

function money(cents: unknown): string {
  const n = Number(cents);
  if (cents == null || !Number.isFinite(n)) return '—';
  const v = n / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 3 : 2 }).format(v);
}
function date(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

type Row = Record<string, unknown>;
export type DocBundle = {
  doc: Row & { id: string; doc_type: string; number: string; amount_cents: number | null; status: string | null; data: Row | null; created_at: string; order_id: string | null; org_id: string | null };
  org: Row | null;
  order: Row | null;
  company: Row | null;
  kyc: Row | null;
  rfq: Row | null;
  quote: Row | null;
  supplier: { code: string; country: string | null } | null;
  hsCode: string | null;
  settings: { deposit_pct: number; claim_visible_days: number; claim_hidden_days: number; quote_validity_days: number };
};

/** Loads a document and its context with the user's RLS client. Returns null when not visible. */
export async function loadDocument(id: string): Promise<DocBundle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sb = await createClient();
  const { data: doc } = await sb.from('documents').select('*').eq('id', id).maybeSingle();
  if (!doc) return null;

  const [orgR, orderR, companyR, kycR, settingsR] = await Promise.all([
    doc.org_id ? sb.from('organizations').select('id, name, country, city, registration_no, website').eq('id', doc.org_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.order_id ? sb.from('orders').select('id, code, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, incoterm, rfq_id, quote_id, supplier_id, created_at').eq('id', doc.order_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('company_profile').select('legal_name, brand, address, address_cn, contact_person, phone, whatsapp, email, website').eq('id', 1).maybeSingle(),
    doc.org_id ? sb.from('kyc_submissions').select('company_name, registration_no, address, contact_name, contact_phone, contact_email').eq('org_id', doc.org_id).order('created_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('site_settings').select('key, value').in('key', ['deposit_pct', 'claim_visible_days', 'claim_hidden_days', 'quote_validity_days']),
  ]);
  const order = (orderR.data as Row | null) ?? null;
  const s: Record<string, unknown> = {};
  ((settingsR.data ?? []) as Row[]).forEach((r) => (s[r.key as string] = r.value));

  let rfq: Row | null = null;
  let quote: Row | null = null;
  let supplier: DocBundle['supplier'] = null;
  let hsCode: string | null = null;
  if (order) {
    const [rfqR, quoteR, supR] = await Promise.all([
      order.rfq_id ? sb.from('rfqs').select('code, product_id, unit, destination_country, destination_city').eq('id', order.rfq_id as string).maybeSingle() : Promise.resolve({ data: null }),
      order.quote_id ? sb.from('quotes').select('code, valid_until, lead_time_days').eq('id', order.quote_id as string).maybeSingle() : Promise.resolve({ data: null }),
      order.supplier_id ? sb.from('public_suppliers').select('code, country').eq('id', order.supplier_id as string).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    rfq = (rfqR.data as Row | null) ?? null;
    quote = (quoteR.data as Row | null) ?? null;
    supplier = (supR.data as DocBundle['supplier']) ?? null;
    if (rfq?.product_id) {
      const { data: p } = await sb.from('products').select('hs_code').eq('id', rfq.product_id as string).maybeSingle();
      hsCode = (p?.hs_code as string | null) ?? null;
    }
  }

  return {
    doc: doc as DocBundle['doc'],
    org: (orgR.data as Row | null) ?? null,
    order,
    company: (companyR.data as Row | null) ?? null,
    kyc: (kycR.data as Row | null) ?? null,
    rfq, quote, supplier, hsCode,
    settings: {
      deposit_pct: num(s.deposit_pct) ?? 30,
      claim_visible_days: num(s.claim_visible_days) ?? 7,
      claim_hidden_days: num(s.claim_hidden_days) ?? 30,
      quote_validity_days: num(s.quote_validity_days) ?? 30,
    },
  };
}

const STATUS_TEXT: Record<string, string> = {
  awaiting_payment: 'Awaiting payment', paid: 'Paid', issued: 'Issued', cancelled: 'Cancelled', void: 'Void',
};

export function renderDocumentHtml(b: DocBundle, opts: { origin: string; print?: boolean }): string {
  const { doc, org, order, company: co, kyc, rfq, quote, supplier, settings } = b;
  const d: Row = doc.data ?? {};
  const type = doc.doc_type;
  const title = DOC_TITLE[type] ?? humanize(type);
  const isInvoice = type === 'proforma_invoice' || type === 'commercial_invoice';
  const legal = esc(co?.legal_name ?? 'Octopus B2B');
  const website = String(co?.website ?? 'octopusb2b.com').replace(/^https?:\/\//, '');

  // Line item values: document snapshot first, order as fallback.
  const qty = num(d.qty) ?? num(order?.quantity);
  const unitPrice = num(d.unit_price_cents) ?? num(order?.unit_price_cents);
  const shipping = num(d.shipping_cents) ?? num(order?.shipping_cents) ?? 0;
  const itemTitle = (d.title as string) ?? (order?.title as string) ?? title;
  const unit = (d.unit as string) ?? (rfq?.unit as string) ?? 'pcs';
  const incoterm = (d.incoterm as string) ?? (order?.incoterm as string) ?? null;
  const subtotal = qty != null && unitPrice != null ? qty * unitPrice : null;
  const total = num(doc.amount_cents) ?? (subtotal != null ? subtotal + shipping : null) ?? num(order?.total_cents);
  const depPct = num(d.deposit_pct) ?? num(order?.deposit_pct) ?? settings.deposit_pct;
  const depCents = num(d.deposit_cents) ?? num(order?.deposit_cents) ?? (total != null ? Math.round((total * depPct) / 100) : null);
  const paid = num(d.paid_cents) ?? num(order?.paid_cents);
  const balance = num(d.balance_cents) ?? (total != null && paid != null ? total - paid : null);
  const leadDays = num(d.lead_time_days) ?? num(quote?.lead_time_days);
  const quoteCode = (d.quote as string) ?? (quote?.code as string) ?? null;
  const rfqCode = (d.rfq as string) ?? (rfq?.code as string) ?? null;
  const validUntil = quote?.valid_until
    ? (quote.valid_until as string)
    : new Date(new Date(doc.created_at).getTime() + settings.quote_validity_days * 86400_000).toISOString();

  /* ── meta strip ── */
  const meta: [string, string, boolean?][] = [['Issue date', date(doc.created_at)]];
  if (type === 'proforma_invoice') meta.push(['Valid until', date(validUntil)]);
  if (quoteCode || rfqCode) meta.push(['Quotation / RFQ', [quoteCode, rfqCode].filter(Boolean).map(esc).join(' · '), true]);
  if (type === 'receipt') {
    meta.push(['Method', esc(humanize((d.method as string) ?? '—'))]);
    if (d.reference) meta.push(['Reference', esc(d.reference), true]);
  }
  if (order?.code) meta.push(['Order', esc(order.code), true]);

  /* ── bill to ── */
  const billName = esc((kyc?.company_name as string) || (org?.name as string) || '—');
  const addr = [kyc?.address, [org?.city, org?.country ? COUNTRY_NAMES[org.country as string] ?? org.country : null].filter(Boolean).join(', ')].filter((x) => x && String(x).trim());
  const reg = (kyc?.registration_no as string) || (org?.registration_no as string) || null;
  const contact = [kyc?.contact_name, kyc?.contact_email, kyc?.contact_phone].filter(Boolean).map(esc).join(' · ');

  const destination = [rfq?.destination_city, rfq?.destination_country ? COUNTRY_NAMES[rfq.destination_country as string] ?? rfq.destination_country : null].filter(Boolean).join(', ');
  const isF = incoterm ? /^(FOB|FCA|EXW|FAS)$/i.test(incoterm) : false;

  /* ── body sections ── */
  let main = '';
  if (isInvoice || type === 'confirmation' || (qty != null && unitPrice != null)) {
    main += `
    <table class="items">
      <thead><tr><th style="width:28px">#</th><th>Description</th><th>HS code</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount (USD)</th></tr></thead>
      <tbody>
        <tr>
          <td class="mono">1</td>
          <td><b>${esc(itemTitle)}</b>${supplier ? `<div class="sub">Supplier ${esc(supplier.code)}${supplier.country ? ` · ${esc(supplier.country)}` : ''}${rfqCode ? ` · ${esc(rfqCode)}` : ''}</div>` : ''}</td>
          <td class="mono">${esc(b.hsCode ?? '—')}</td>
          <td class="r mono">${qty != null ? esc(new Intl.NumberFormat('en-US').format(qty)) : '—'}<div class="sub">${esc(unit)}</div></td>
          <td class="r mono">${money(unitPrice)}</td>
          <td class="r mono"><b>${money(subtotal)}</b></td>
        </tr>
      </tbody>
    </table>`;
  }

  if (type === 'receipt') {
    main += `
    <div class="box receipt">
      <div class="lbl">Payment received</div>
      <div class="big">${money(doc.amount_cents)}</div>
      <div class="kv"><b>Purpose:</b> ${esc(humanize((d.purpose as string) ?? 'payment'))}</div>
      <div class="kv"><b>Method:</b> ${esc(humanize((d.method as string) ?? '—'))}</div>
      ${d.reference ? `<div class="kv"><b>Reference:</b> <span class="mono">${esc(d.reference)}</span></div>` : ''}
      ${order ? `<div class="kv"><b>Order:</b> <span class="mono">${esc(order.code)}</span> · ${esc(order.title)} · order total ${money(order.total_cents)} · paid to date ${money(order.paid_cents)}</div>` : ''}
    </div>`;
  } else if (type === 'credit_note') {
    main += `
    <div class="box receipt">
      <div class="lbl">Credit issued</div>
      <div class="big">${money(doc.amount_cents)}</div>
      ${d.reason ? `<div class="kv"><b>Reason:</b> ${esc(d.reason)}</div>` : ''}
      ${order ? `<div class="kv"><b>Order:</b> <span class="mono">${esc(order.code)}</span> · ${esc(order.title)}</div>` : ''}
      <div class="kv">Credited to your Octopus wallet / account balance.</div>
    </div>`;
  } else if (!isInvoice && type !== 'confirmation' && !(qty != null && unitPrice != null)) {
    const rows = Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object');
    main += `
    <table class="items"><thead><tr><th>Field</th><th class="r">Value</th></tr></thead><tbody>
      ${rows.length ? rows.map(([k, v]) => `<tr><td>${esc(humanize(k))}</td><td class="r">${/_cents$/.test(k) ? money(v) : esc(v)}</td></tr>`).join('') : '<tr><td colspan="2">No additional details.</td></tr>'}
    </tbody></table>`;
  }

  /* payment schedule + totals */
  let schedule = '';
  if (type === 'proforma_invoice' || type === 'confirmation') {
    const bal = total != null && depCents != null ? total - depCents : null;
    schedule = `
      <div class="lbl">Payment schedule</div>
      <div class="row"><span>${esc(depPct)}% deposit on order confirmation</span><b class="mono">${money(depCents)}</b></div>
      <div class="row"><span>${esc(100 - depPct)}% balance before despatch</span><b class="mono">${money(bal)}</b></div>`;
  } else if (type === 'commercial_invoice') {
    schedule = `
      <div class="lbl">Payment status</div>
      <div class="row"><span>Paid to date</span><b class="mono">${money(paid)}</b></div>
      <div class="row"><span>Balance due before despatch</span><b class="mono">${money(balance)}</b></div>`;
  }
  const payBox = schedule
    ? `<div class="box pay">${schedule}
        <div class="lbl" style="margin-top:14px">Pay to</div>
        <div class="kv">${legal}</div>
        <div class="kv">Reference: <b class="mono">${esc(doc.number)}</b> · or pay from your Octopus wallet</div>
      </div>`
    : '<div></div>';

  const totalsBox = isInvoice || type === 'confirmation'
    ? `<div class="totals">
        <div class="row"><span>Subtotal</span><span class="mono">${money(subtotal)}</span></div>
        <div class="row"><span>Freight</span><span class="mono">${shipping > 0 ? money(shipping) : `Excluded${incoterm ? ` (${esc(incoterm)})` : ''}`}</span></div>
        <div class="row"><span>Duties &amp; import taxes</span><span class="mono">${isF || !incoterm ? `Buyer${incoterm ? ` (${esc(incoterm)})` : ''}` : esc(incoterm)}</span></div>
        <div class="grand"><span class="lbl" style="color:#fff">Total USD</span><span class="amt">${money(total)}</span></div>
      </div>`
    : `<div class="totals"><div class="grand"><span class="lbl" style="color:#fff">${type === 'credit_note' ? 'Credit USD' : type === 'receipt' ? 'Received USD' : 'Amount USD'}</span><span class="amt">${money(doc.amount_cents)}</span></div></div>`;

  const showTotals = !(type !== 'receipt' && type !== 'credit_note' && !isInvoice && type !== 'confirmation' && doc.amount_cents == null);

  /* key terms */
  const terms: string[] = [];
  if (type === 'proforma_invoice') terms.push(`Prices in US dollars; this proforma invoice is valid for ${settings.quote_validity_days} days from the issue date.`);
  else terms.push('All amounts in US dollars.');
  if (isInvoice || type === 'confirmation') {
    terms.push(`${depPct}% deposit on order confirmation, balance before despatch. Bank charges at both ends are paid by the buyer.`);
    terms.push('The order is binding only when Octopus B2B confirms it in writing; it can’t then be cancelled or amended without our written agreement.');
    if (incoterm) terms.push(`Delivery, duties and import taxes follow the Incoterm ${esc(incoterm)} (Incoterms 2020).`);
  }
  terms.push(`Report shortage or transit damage within ${settings.claim_visible_days} days of delivery, hidden defects within ${settings.claim_hidden_days} days.`);
  terms.push(`Full terms: ${esc(website)}/terms`);

  const deliveryBox = isInvoice || type === 'confirmation'
    ? `<div class="box">
        <div class="lbl">Delivery terms</div>
        ${incoterm ? `<div class="kv"><b>Incoterm:</b> ${esc(incoterm)} (Incoterms 2020)</div>` : ''}
        ${destination ? `<div class="kv"><b>Ship to:</b> ${esc(destination)}</div>` : ''}
        ${leadDays != null ? `<div class="kv"><b>Lead time:</b> ${esc(leadDays)} days after deposit</div>` : ''}
        ${isF ? `<div class="kv"><b>Carrier:</b> buyer's forwarder (${esc(incoterm)})</div>` : '<div class="kv"><b>Carrier:</b> arranged by Octopus B2B</div>'}
      </div>`
    : `<div class="box">
        <div class="lbl">Details</div>
        <div class="kv"><b>Document:</b> ${esc(title)} <span class="mono">${esc(doc.number)}</span></div>
        ${order ? `<div class="kv"><b>Order:</b> <span class="mono">${esc(order.code)}</span></div>` : ''}
        <div class="kv"><b>Status:</b> ${esc(STATUS_TEXT[doc.status ?? ''] ?? humanize(doc.status ?? 'issued'))}</div>
      </div>`;

  const statusText = type === 'proforma_invoice' && doc.status === 'awaiting_payment'
    ? 'Accepted · awaiting deposit'
    : STATUS_TEXT[doc.status ?? ''] ?? humanize(doc.status ?? 'issued');
  const statusTone = doc.status === 'paid' ? 'ok' : doc.status === 'cancelled' || doc.status === 'void' ? 'bad' : doc.status === 'awaiting_payment' ? 'warn' : 'info';

  const phone = co?.phone ? esc(co.phone) : '';
  const wa = co?.whatsapp ? String(co.whatsapp).replace(/[^0-9]/g, '') : '';
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} ${esc(doc.number)}</title>
<style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;background:#EEF0F4;color:#11133C;font:400 12px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif}
a{color:#2A6FD6;text-decoration:none}
.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.page{width:210mm;min-height:297mm;margin:24px auto;background:#fff;padding:16mm 16mm 14mm;box-shadow:0 2px 16px rgba(17,19,60,.08)}
.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:10px;padding:10px;background:#11133C}
.toolbar button,.toolbar a{font:600 13px/1 Inter,system-ui,sans-serif;border-radius:8px;padding:10px 16px;border:1px solid #fff;cursor:pointer;background:#fff;color:#11133C}
.toolbar .primary{background:#2A6FD6;border-color:#2A6FD6;color:#fff}
.head{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.logo{height:44px;width:auto;display:block}
h1{font:700 22px/1.2 Lexend,Inter,system-ui,sans-serif;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.01em}
h1 .num{color:#2A6FD6}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px}
.pill.warn{background:#FFF3D6;color:#8A5A00}.pill.ok{background:#E3F5EA;color:#156B3A}.pill.bad{background:#FDE8E8;color:#A32D2D}.pill.info{background:#E8F0FC;color:#1E4F9C}
.seller{font-size:11px;color:#3D4456}.seller b{display:block;color:#11133C;font-size:12px;margin-bottom:6px}.seller p{margin:0 0 6px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#F5F6F8;border-radius:10px;padding:14px 16px;margin:22px 0 16px}
.lbl{font:600 9.5px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#5A6475;margin-bottom:6px}
.meta .v{font-weight:600;font-size:12.5px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
.box{border:1px solid #E2E5EA;border-radius:10px;padding:14px 16px}
.box .name{font-weight:700;font-size:13px;margin-bottom:4px}
.kv{margin:3px 0}
table.items{width:100%;border-collapse:collapse;margin-bottom:8px}
table.items th{font:600 9.5px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#5A6475;text-align:left;padding:8px 10px;border-bottom:1.5px solid #11133C}
table.items td{font-size:12px;padding:10px;border-bottom:1px solid #E2E5EA;vertical-align:top}
.r{text-align:right!important}
.sub{color:#5A6475;font-size:11px}
.bottom{display:grid;grid-template-columns:1.15fr 1fr;gap:20px;margin-top:16px;align-items:start}
.row{display:flex;justify-content:space-between;gap:12px;margin:5px 0}
.totals .row{color:#3D4456}
.grand{display:flex;justify-content:space-between;align-items:center;background:#11133C;color:#fff;border-radius:10px;padding:14px 16px;margin-top:10px}
.grand .amt{font:700 20px/1 Lexend,Inter,system-ui,sans-serif}
.receipt .big{font:700 26px/1.1 Lexend,Inter,system-ui,sans-serif;margin:4px 0 10px}
.foot{display:grid;grid-template-columns:1.4fr 1fr;gap:24px;border-top:1px solid #E2E5EA;margin-top:22px;padding-top:16px;align-items:end}
.terms h3{font-size:12px;color:#2A6FD6;margin:0 0 6px}
.terms ul{margin:0;padding-left:16px;font-size:10.5px;color:#3D4456}.terms li{margin:2px 0}
.sign{text-align:center;border-top:1px solid #11133C;padding-top:8px}.sign b{display:block;font-size:12px}.sign span{font-size:10.5px;color:#5A6475}
.help{text-align:center;margin-top:22px;font-size:11px;color:#3D4456}.help b{display:block;color:#11133C;margin-bottom:4px}
.gen{font:400 9.5px/1.4 "IBM Plex Mono",ui-monospace,monospace;color:#5A6475;margin-top:4px}
@media print{html,body{background:#fff}.toolbar{display:none!important}.page{margin:0;width:auto;min-height:0;padding:0;box-shadow:none}.box,table.items,.bottom,.foot{break-inside:avoid}}
@media screen and (max-width:820px){.page{width:auto;margin:0;padding:20px}.head,.two,.bottom,.foot{grid-template-columns:1fr}.meta{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="toolbar" role="toolbar" aria-label="Document actions">
  <button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button>
  <button type="button" onclick="if(history.length>1){history.back()}else{window.close()}">Close</button>
</div>
<main class="page">
  <header class="head">
    <div>
      <img class="logo" src="${esc(opts.origin)}/logo.png" alt="${esc(co?.brand ?? 'Octopus B2B')}">
      <h1>${esc(title)} <span class="num">${esc(doc.number)}</span></h1>
      <span class="pill ${statusTone}">${esc(statusText)}</span>
    </div>
    <div class="seller">
      <b>${legal}</b>
      ${co?.address ? `<p>${esc(co.address)}</p>` : ''}
      ${co?.address_cn ? `<p lang="zh">${esc(co.address_cn)}</p>` : ''}
      <p>${[co?.contact_person, co?.phone, co?.email].filter(Boolean).map(esc).join(' · ')}</p>
    </div>
  </header>

  <section class="meta">
    ${meta.map(([k, v, mono]) => `<div><div class="lbl">${esc(k)}</div><div class="v${mono ? ' mono' : ''}">${v}</div></div>`).join('')}
  </section>

  <section class="two">
    <div class="box">
      <div class="lbl">Bill to</div>
      <div class="name">${billName}</div>
      ${addr.length ? `<div class="kv">${addr.map((x) => esc(x)).join(', ')}</div>` : ''}
      ${reg ? `<div class="kv">Reg. no. ${esc(reg)}</div>` : ''}
      ${contact ? `<div class="kv">${contact}</div>` : ''}
    </div>
    ${deliveryBox}
  </section>

  ${main}

  ${showTotals ? `<section class="bottom">${payBox}${totalsBox}</section>` : ''}

  <footer>
    <div class="foot">
      <div class="terms">
        <h3>Key terms</h3>
        <ul>${terms.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>
      <div class="sign"><b>Authorised signature</b><span>For ${legal}</span></div>
    </div>
    <div class="help">
      <b>Need help?</b>
      WhatsApp / phone ${wa ? `<a href="https://wa.me/${esc(wa)}">${phone}</a>` : phone}${co?.email ? ` · <a href="mailto:${esc(co.email)}">${esc(co.email)}</a>` : ''} · ${esc(website)}
      <div class="gen">Generated ${esc(generated)}${quoteCode ? ` from ${esc(quoteCode)}` : ''} · ${esc(doc.number)}</div>
    </div>
  </footer>
</main>
${opts.print ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});</script>' : ''}
</body></html>`;
}
