import { Suspense } from 'react';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { portalProducts, withSuppliers } from '@/components/backoffice/hidden-columns';
import { Card, PageHeader, StatusBadge, EmptyState, Money } from '@/components/ui';
import { getManagedSuppliers, one } from '@/components/backoffice/server-utils';
import { QuoteForm } from '@/components/backoffice/quote-form';
import { sendQuote } from '@/components/backoffice/quote-actions';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';

export const metadata = { title: 'RFQs' };

const OPEN = ['submitted', 'assigned', 'quoting', 'quoted'];

/** Open RFQs — distributors see only city + country of the buyer, never names or contacts (SPEC §3). */
async function DistributorRfqsContent() {
  // role check before the service-role read below (the layout guard runs in parallel with the page)
  const s = await requireRole('distributor', '/distributor/rfqs');
  const sb = await createClient();
  const [suppliers, cx] = await Promise.all([getManagedSuppliers(s), getCurrencyContext()]);
  const myIds = new Set(suppliers.map((x) => x.id));
  // explicit column list: no org_id / contacts are ever selected here
  const { data: rfqRows } = await sb.from('rfqs')
    .select('id, code, title, details, quantity, unit, target_price_cents, currency, destination_country, destination_city, incoterm, status, created_at, expires_at, categories(name), products(id, title)')
    .in('status', OPEN).order('created_at', { ascending: false }).limit(100);
  // products.supplier_id is hidden from plain products reads (migration 195): portal_products() returns only the caller's
  // own / assigned suppliers' products, so a product found there is "your supplier".
  const prodIds = [...new Set((rfqRows ?? []).map((r) => one(r.products as unknown as { id: string } | { id: string }[] | null)?.id).filter((x): x is string => !!x))];
  const { data: myProds } = prodIds.length ? await portalProducts(sb).select('id, supplier_id').in('id', prodIds) : { data: [] };
  const supOfProduct = new Map(((myProds ?? []) as { id: string; supplier_id: string }[]).map((x) => [x.id, x.supplier_id]));
  const rfqs = rfqRows?.map((r) => {
    const p = one(r.products as unknown as { id: string; title: string } | { id: string; title: string }[] | null);
    return { ...r, products: p ? { ...p, supplier_id: supOfProduct.get(p.id) ?? '' } : null };
  }) ?? null;
  const ids = (rfqs ?? []).map((r) => r.id);
  const { data: quoteRows } = ids.length
    ? await sb.from('quotes').select('id, code, rfq_id, unit_price_cents, currency, quantity, incoterm, lead_time_days, status, created_at').in('rfq_id', ids)
    : { data: null };
  // quotes.supplier_id is hidden too: added with the service role for the quotes RLS returned; supplier codes via the session
  const quotes = await withSuppliers(sb, 'quotes', quoteRows, 'code');
  const supplierOpts = suppliers.map((x) => ({
    id: x.id,
    label: `${x.code} · ${x.legal_name}${x.supplier_switches?.rfq_replies === false ? ' (RFQ replies off)' : ''}`,
    disabled: x.supplier_switches?.rfq_replies === false,
  }));

  return (
    <>
      <PageHeader title="RFQ replies" subtitle="Open buyer requests. Quote on behalf of your assigned suppliers; the buyer sees only “Verified factory” and the country/region — never the supplier name or code." />
      {!rfqs?.length ? (
        <Card><EmptyState title="No open RFQs" body="New buyer requests appear here as soon as they are submitted." /></Card>
      ) : (
        <div className="space-y-4">
          {rfqs.map((r) => {
            const mine = (quotes ?? []).filter((q) => q.rfq_id === r.id && myIds.has(q.supplier_id ?? ''));
            const total = (quotes ?? []).filter((q) => q.rfq_id === r.id).length;
            const prod = one(r.products as unknown as { title: string; supplier_id: string } | { title: string; supplier_id: string }[] | null);
            const cat = one(r.categories as unknown as { name: string } | { name: string }[] | null);
            return (
              <section key={r.id} className="card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mono text-xs text-muted">{r.code} · received {fmtDate(r.created_at)}{r.expires_at ? ` · expires ${fmtDate(r.expires_at)}` : ''}</div>
                    <h2 className="text-lg font-semibold mt-1">{r.title}</h2>
                    <div className="text-sm text-muted mt-1">
                      {r.quantity.toLocaleString()} {r.unit} · Buyer in {[r.destination_city, r.destination_country ? COUNTRY_NAMES[r.destination_country] ?? r.destination_country : null].filter(Boolean).join(', ') || 'location not given'}
                      {r.incoterm ? ` · ${r.incoterm}` : ''}{r.target_price_cents ? ` · target ${money(r.target_price_cents, r.currency)}/${r.unit}` : ''}
                      {cat ? ` · ${cat.name}` : ''}
                    </div>
                    {prod && <div className="text-sm mt-1">Product: {prod.title}{myIds.has(prod.supplier_id) && <span className="ml-2 text-xs font-semibold text-ok">your supplier</span>}</div>}
                    {r.details && <p className="text-sm mt-2 whitespace-pre-line">{r.details}</p>}
                  </div>
                  <div className="text-right">
                    <StatusBadge status={r.status} />
                    <div className="text-xs text-muted mt-1">{total} quote{total === 1 ? '' : 's'} in total</div>
                  </div>
                </div>
                {mine.length > 0 && (
                  <ul className="mt-4 divide-y divide-line border border-line rounded-[10px]">
                    {mine.map((q) => (
                      <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                        <span className="mono">{q.code}</span>
                        <span className="mono text-muted">{one(q.suppliers as unknown as { code: string } | { code: string }[] | null)?.code}</span>
                        <Money cents={q.unit_price_cents} currency={q.currency} /> <span className="text-muted">× {q.quantity} · {q.incoterm} · {q.lead_time_days ?? '—'} days</span>
                        <span className="ml-auto"><StatusBadge status={q.status} /></span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="mt-4">
                  <summary className="btn btn-primary btn-sm cursor-pointer list-none inline-flex">Quote on behalf of a supplier</summary>
                  <div className="mt-4 rounded-[10px] bg-pearl p-4">
                    <QuoteForm idPrefix={`q-${r.id}`} action={sendQuote.bind(null, r.id)} suppliers={supplierOpts} defaultQty={r.quantity} defaultIncoterm={r.incoterm} unit={r.unit} currency={cx.currency} />
                  </div>
                </details>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

// Batch 3 (F-14): the request-time data loads inside a Suspense boundary (Next 16 Cache Components / instant navigation)
export default function DistributorRfqs() {
  return (
    <Suspense fallback={<div className="card p-6 text-ink" role="status">Loading…</div>}>
      <DistributorRfqsContent />
    </Suspense>
  );
}
