import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Money, EmptyState, Table } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { QuoteForm } from '@/components/backoffice/quote-form';
import { sendQuote } from '@/components/backoffice/quote-actions';
import { fmtDate, usd, COUNTRY_NAMES } from '@/lib/format';

export const metadata = { title: 'RFQ' };

export default async function OfficeRfq({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('requests', 'view', `/office/rfqs/${id}`);
  const sb = await createClient();
  const { data: r } = await sb.from('rfqs')
    .select('id, code, title, details, quantity, unit, target_price_cents, destination_country, destination_city, incoterm, status, fee_usd_cents, created_at, expires_at, organizations(city, country, kyc_status), categories(name), products(id, title, slug, product_specs(name, value, sort))')
    .eq('id', id).maybeSingle();
  if (!r) notFound();
  const [{ data: quotes }, { data: sups }] = await Promise.all([
    sb.from('quotes').select('id, code, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_at, suppliers(code, legal_name, country)').eq('rfq_id', id).order('created_at'),
    sb.from('suppliers').select('id, code, legal_name, country, supplier_switches(rfq_replies)').is('archived_at', null).order('code'),
  ]);
  const org = one(r.organizations as unknown as { city: string | null; country: string | null; kyc_status: string } | null);
  const prod = one(r.products as unknown as { id: string; title: string; slug: string; product_specs: { name: string; value: string; sort: number }[] } | null);
  const open = ['submitted', 'assigned', 'quoting', 'quoted'].includes(r.status);
  const canQuote = can(s, 'requests', 'create');
  const supplierOpts = (sups ?? []).map((x) => {
    const off = one(x.supplier_switches as unknown as { rfq_replies: boolean } | null)?.rfq_replies === false;
    return { id: x.id, label: `${x.code} · ${x.legal_name} · ${x.country}${off ? ' (RFQ replies off)' : ''}`, disabled: off };
  });

  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/office/rfqs">RFQs &amp; quotes</Link> / {r.code}</nav>}
        title={r.title}
        subtitle={`${r.code} · received ${fmtDate(r.created_at, true)}${r.expires_at ? ` · expires ${fmtDate(r.expires_at)}` : ''}`}
        actions={<StatusBadge status={r.status} />}
      />
      <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
        <div className="space-y-6">
          <Card title="Request">
            <dl className="grid sm:grid-cols-3 gap-4 px-6 pb-4 text-[15px]">
              <div><dt className="text-sm text-muted">Quantity</dt><dd className="font-semibold">{r.quantity.toLocaleString()} {r.unit}</dd></div>
              <div><dt className="text-sm text-muted">Target price</dt><dd className="font-semibold">{r.target_price_cents ? `${usd(r.target_price_cents)} / ${r.unit}` : '—'}</dd></div>
              <div><dt className="text-sm text-muted">Incoterm</dt><dd className="font-semibold">{r.incoterm ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Customer</dt><dd className="font-semibold">{[org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', ') || '—'}</dd><dd className="text-xs text-muted">KYC {org?.kyc_status?.replace('_', ' ')}</dd></div>
              <div><dt className="text-sm text-muted">Ship to</dt><dd className="font-semibold">{[r.destination_city, r.destination_country].filter(Boolean).join(', ') || '—'}</dd></div>
              <div><dt className="text-sm text-muted">Category</dt><dd className="font-semibold">{one(r.categories as unknown as { name: string } | null)?.name ?? '—'}</dd></div>
            </dl>
            <div className="px-6 pb-6">
              <h3 className="font-semibold mb-1">Requested specs</h3>
              <p className="text-sm whitespace-pre-line">{r.details || <span className="text-muted">No details given.</span>}</p>
              {prod && (
                <div className="mt-4 rounded-[10px] bg-surface p-4">
                  <div className="text-sm">Linked product: <Link href={`/p/${prod.slug}`} className="text-blue font-semibold">{prod.title}</Link></div>
                  {prod.product_specs?.length > 0 && (
                    <dl className="grid sm:grid-cols-2 gap-x-6 mt-2 text-sm">
                      {[...prod.product_specs].sort((a, b) => a.sort - b.sort).map((sp) => <div key={sp.name} className="flex justify-between border-b border-line py-1"><dt className="text-muted">{sp.name}</dt><dd>{sp.value}</dd></div>)}
                    </dl>
                  )}
                </div>
              )}
            </div>
          </Card>
          <Card title={`Quotes · ${quotes?.length ?? 0}`}>
            <Table head={['Quote', 'Supplier', 'Unit price', 'Qty', 'Shipping', 'Total', 'Lead', 'Valid until', 'Status']} empty={<EmptyState title="No quotes yet" body="Add the first quote with the form." />}>
              {(quotes ?? []).map((q) => {
                const sp = one(q.suppliers as unknown as { code: string; legal_name: string; country: string } | null);
                return (
                  <tr key={q.id}>
                    <td className="td mono text-sm">{q.code}</td>
                    <td className="td text-sm"><div className="mono">{sp?.code} · {sp?.country}</div><div className="text-xs text-muted">{sp?.legal_name}</div></td>
                    <td className="td"><Money cents={q.unit_price_cents} /></td>
                    <td className="td text-sm">{q.quantity.toLocaleString()}</td>
                    <td className="td"><Money cents={q.shipping_cents} /></td>
                    <td className="td"><Money cents={q.unit_price_cents * q.quantity + q.shipping_cents} /></td>
                    <td className="td text-sm">{q.lead_time_days ?? '—'} d · {q.incoterm}</td>
                    <td className="td text-sm">{fmtDate(q.valid_until)}</td>
                    <td className="td"><StatusBadge status={q.status} /></td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
        <Card title="Add a quote">
          <div className="px-6 pb-6">
            {!open ? <p className="text-sm text-muted">This RFQ is {r.status.replace('_', ' ')} and no longer accepts quotes.</p>
              : !canQuote ? <p className="text-sm text-muted">You don&apos;t have permission to send quotes.</p>
                : <QuoteForm idPrefix="oq" action={sendQuote.bind(null, r.id)} suppliers={supplierOpts} defaultQty={r.quantity} defaultIncoterm={r.incoterm} unit={r.unit} />}
            <p className="text-xs text-muted mt-3">The buyer sees the supplier as code + country only. Quote validity comes from the quote_validity_days setting.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
