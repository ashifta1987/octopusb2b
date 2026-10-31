import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, StatusBadge, EmptyState, Notice, Money, SupplierCode } from '@/components/ui';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { getSettings, latestTermsId, supplierMap } from '@/components/account/data';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { nowMs } from '@/components/account/order-utils';
import { approveQuote } from '../actions';

export const metadata = { title: 'RFQ detail' };

type Quote = {
  id: string; code: string; supplier_id: string; unit_price_cents: number; quantity: number; incoterm: string; lead_time_days: number | null;
  shipping_cents: number; notes: string | null; status: string; valid_until: string; created_at: string;
};

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCustomer(`/account/rfqs/${id}`);
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sb = await createClient();
  const { data: rfq } = await sb.from('rfqs').select('*').eq('id', id).maybeSingle();
  if (!rfq) notFound();
  const [{ data: quotesRaw }, settings, terms, { data: order }] = await Promise.all([
    sb.from('quotes').select('id, code, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_at').eq('rfq_id', id).order('unit_price_cents'),
    getSettings(),
    latestTermsId(),
    sb.from('orders').select('id, code, status').eq('rfq_id', id).maybeSingle(),
  ]);
  const quotes = ((quotesRaw ?? []) as Quote[]).map((q) => ({ ...q, unit_price_cents: Number(q.unit_price_cents), shipping_cents: Number(q.shipping_cents), total: Number(q.unit_price_cents) * q.quantity + Number(q.shipping_cents) }));
  const sup = await supplierMap(quotes.map((q) => q.supplier_id));
  const now = nowMs();
  const approvable = (q: (typeof quotes)[number]) => (q.status === 'sent' || q.status === 'viewed') && new Date(q.valid_until).getTime() > now;
  const best = quotes.filter(approvable).reduce<number | null>((m, q) => (m == null || q.total < m ? q.total : m), null);
  const fastest = quotes.filter(approvable).reduce<number | null>((m, q) => (q.lead_time_days != null && (m == null || q.lead_time_days < m) ? q.lead_time_days : m), null);

  const rows: { label: string; render: (q: (typeof quotes)[number]) => React.ReactNode }[] = [
    { label: 'Unit price (USD)', render: (q) => <Money cents={q.unit_price_cents} className="text-lg" /> },
    { label: 'Quantity', render: (q) => <span className="mono">{q.quantity.toLocaleString('en-US')} {rfq.unit}</span> },
    { label: 'Shipping', render: (q) => (q.shipping_cents ? <Money cents={q.shipping_cents} /> : <span className="text-muted">Included / per Incoterm</span>) },
    { label: 'Total', render: (q) => <span><Money cents={q.total} className="text-lg" />{best === q.total && approvable(q) && <span className="ml-2 text-xs font-semibold text-ok">Best price</span>}</span> },
    { label: 'Incoterm', render: (q) => q.incoterm },
    { label: 'Lead time', render: (q) => <span>{q.lead_time_days != null ? `${q.lead_time_days} days` : '—'}{fastest != null && q.lead_time_days === fastest && approvable(q) && <span className="ml-2 text-xs font-semibold text-blue">Fastest</span>}</span> },
    { label: 'Valid until', render: (q) => fmtDate(q.valid_until) },
    { label: 'Deposit', render: (q) => <span className="text-sm">{settings.deposit_pct}% · <Money cents={Math.round((q.total * settings.deposit_pct) / 100)} /></span> },
    { label: 'Notes', render: (q) => <span className="text-sm text-muted">{q.notes || '—'}</span> },
  ];

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/account/rfqs" className="text-blue">← All RFQs</Link></div>
      <PageHeader
        eyebrow={<span className="mono text-xs text-muted">{rfq.code}</span>}
        title={rfq.title}
        subtitle={`${Number(rfq.quantity).toLocaleString('en-US')} ${rfq.unit}${rfq.destination_country ? ` · to ${COUNTRY_NAMES[rfq.destination_country] ?? rfq.destination_country}${rfq.destination_city ? `, ${rfq.destination_city}` : ''}` : ''}${rfq.incoterm ? ` · ${rfq.incoterm}` : ''} · created ${fmtDate(rfq.created_at)}`}
        actions={<><StatusBadge status={rfq.status} /><RealtimeRefresh channel={`rfq-${id}`} subs={[{ table: 'quotes', event: 'INSERT', filter: `rfq_id=eq.${id}` }, { table: 'quotes', event: 'UPDATE', filter: `rfq_id=eq.${id}` }]} /></>}
      />
      {order && (
        <div className="mb-6"><Notice tone="green">You approved a quote for this RFQ. <Link href={`/account/orders/${order.id}`} className="underline font-semibold">Go to order {order.code}</Link>.</Notice></div>
      )}
      {rfq.details && <Card className="p-6 mb-6"><h2 className="text-lg font-semibold mb-2">Your request</h2><p className="text-[15px] whitespace-pre-line">{rfq.details}</p>
        {rfq.target_price_cents ? <p className="text-sm text-muted mt-2">Target price: <Money cents={Number(rfq.target_price_cents)} /></p> : null}</Card>}

      <Card title={`Quotes (${quotes.length})`} action={quotes.length > 1 ? <span className="text-sm text-muted">Compared side by side · supplier names are never shown</span> : undefined}>
        {quotes.length === 0 ? (
          <EmptyState title="No quotes yet" body="Suppliers usually reply within 48 hours. This page updates automatically when a quote arrives." />
        ) : (
          <div className="overflow-x-auto px-2 pb-4">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr>
                  <th className="th w-44" scope="col"><span className="sr-only">Field</span></th>
                  {quotes.map((q) => (
                    <th key={q.id} scope="col" className="th align-top normal-case tracking-normal">
                      <div className="mono text-xs text-muted">{q.code}</div>
                      <div className="mt-1"><SupplierCode code={sup.get(q.supplier_id)?.code ?? '—'} country={sup.get(q.supplier_id)?.country} verified={sup.get(q.supplier_id)?.verified} /></div>
                      <div className="mt-2"><StatusBadge status={approvable(q) || !(q.status === 'sent' || q.status === 'viewed') ? q.status : 'expired'} /></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className="td text-left text-sm font-semibold text-muted">{r.label}</th>
                    {quotes.map((q) => <td key={q.id} className="td">{r.render(q)}</td>)}
                  </tr>
                ))}
                <tr>
                  <td className="td" />
                  {quotes.map((q) => (
                    <td key={q.id} className="td">
                      {approvable(q) ? (
                        <ApproveQuoteButton quoteId={q.id} quoteCode={q.code} totalCents={q.total} depositPct={settings.deposit_pct}
                          termsVersion={terms?.version} action={approveQuote} label="Approve quote" className="btn btn-primary btn-sm" />
                      ) : <span className="text-sm text-muted">{q.status === 'approved' ? 'Approved' : 'Not available'}</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted mt-3">Approving creates a proforma invoice with a {settings.deposit_pct}% deposit. Contract terms: <Link href="/legal/terms" className="underline">Terms &amp; Conditions</Link>.</p>
    </>
  );
}
