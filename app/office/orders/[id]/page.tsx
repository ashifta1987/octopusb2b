import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Money, Timeline, OrderProgress, EmptyState } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { ActionForm, ReasonButton } from '@/components/backoffice/action-form';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize, usd } from '@/lib/format';
import { transitionOrder, recordPayment } from '../../actions';

export const metadata = { title: 'Order' };

// mirrors order_transition_allowed()
const NEXT: Record<string, string[]> = {
  pi_issued: ['deposit_pending', 'cancelled'], deposit_pending: ['deposit_paid', 'cancelled'], deposit_paid: ['confirmed'], confirmed: ['in_production'],
  in_production: ['qc', 'balance_pending'], qc: ['balance_pending'], balance_pending: ['balance_paid'], balance_paid: ['ready_to_ship'],
  ready_to_ship: ['shipped'], shipped: ['delivered'], delivered: ['closed', 'disputed'], disputed: ['closed'],
};

export default async function OfficeOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('orders', 'view', `/office/orders/${id}`);
  const sb = await createClient();
  const { data: o } = await sb.from('orders')
    .select('id, code, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, deposit_pct, paid_cents, incoterm, created_at, delivered_at, claim_visible_until, claim_hidden_until, organizations(id, name, country, city, kyc_status), suppliers(code, legal_name, country), quotes(code), rfqs(code)')
    .eq('id', id).maybeSingle();
  if (!o) notFound();
  const [{ data: events }, { data: docs }, { data: pays }, { data: ships }] = await Promise.all([
    sb.from('order_events').select('id, kind, title, body, created_at').eq('order_id', id).order('created_at'),
    sb.from('documents').select('id, doc_type, number, amount_cents, status, created_at').eq('order_id', id).order('created_at'),
    sb.from('payments').select('id, purpose, method, amount_cents, reference, status, created_at').eq('order_id', id).order('created_at'),
    sb.from('shipments').select('id, code, tracking_no, status, service_code, label_url, created_at').eq('order_id', id).order('created_at'),
  ]);
  const org = one(o.organizations as unknown as { id: string; name: string; country: string | null; city: string | null; kyc_status: string } | null);
  const sup = one(o.suppliers as unknown as { code: string; legal_name: string; country: string } | null);
  const canEdit = can(s, 'orders', 'edit');
  const canPay = can(s, 'finance', 'approve');
  const outstanding = o.total_cents - o.paid_cents;
  const depositDue = Math.max(0, o.deposit_cents - o.paid_cents);
  const next = (NEXT[o.status] ?? []).filter((t) => t !== 'shipped'); // shipping goes through the Shipping screen

  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/office/orders">Orders</Link> / {o.code}</nav>}
        title={`${o.code} · ${o.title}`}
        subtitle={`${org?.name ?? ''} · ${[org?.city, org?.country].filter(Boolean).join(', ')} · supplier ${sup?.code ?? '—'} · created ${fmtDate(o.created_at)}`}
        actions={<StatusBadge status={o.status} />}
      />
      <div className="card p-6 mb-6"><OrderProgress status={o.status} /></div>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <Card title="Summary">
            <dl className="grid sm:grid-cols-3 gap-4 px-6 pb-6 text-[15px]">
              <div><dt className="text-sm text-muted">Quantity</dt><dd className="font-semibold">{o.quantity.toLocaleString()} × {usd(o.unit_price_cents)}</dd></div>
              <div><dt className="text-sm text-muted">Shipping</dt><dd><Money cents={o.shipping_cents} /></dd></div>
              <div><dt className="text-sm text-muted">Total</dt><dd><Money cents={o.total_cents} /></dd></div>
              <div><dt className="text-sm text-muted">Deposit ({o.deposit_pct}%)</dt><dd><Money cents={o.deposit_cents} /></dd></div>
              <div><dt className="text-sm text-muted">Paid</dt><dd><Money cents={o.paid_cents} /></dd></div>
              <div><dt className="text-sm text-muted">Outstanding</dt><dd><Money cents={outstanding} className={outstanding > 0 ? 'text-warn' : 'text-ok'} /></dd></div>
              <div><dt className="text-sm text-muted">Incoterm</dt><dd className="font-semibold">{o.incoterm ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Quote / RFQ</dt><dd className="mono text-sm">{one(o.quotes as unknown as { code: string } | null)?.code ?? '—'} · {one(o.rfqs as unknown as { code: string } | null)?.code ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Supplier</dt><dd className="text-sm"><span className="mono">{sup?.code}</span> · {sup?.legal_name}</dd></div>
              {o.delivered_at && <div className="sm:col-span-3 text-sm text-muted">Delivered {fmtDate(o.delivered_at)} · visible-defect claims until {fmtDate(o.claim_visible_until)} · hidden-defect claims until {fmtDate(o.claim_hidden_until)}</div>}
            </dl>
          </Card>
          <Card title="Documents">
            {!docs?.length ? <EmptyState title="No documents yet" /> : (
              <ul className="px-6 pb-6 space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 border border-line rounded-[10px] px-4 py-2">
                    <span className="mono text-sm font-semibold">{d.number}</span>
                    <span className="text-sm text-muted">{humanize(d.doc_type)}</span>
                    <Money cents={d.amount_cents} className="text-sm" />
                    <StatusBadge status={d.status ?? 'issued'} />
                    <span className="ml-auto"><DocumentButton docId={d.id} compact /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Payments">
            {!pays?.length ? <EmptyState title="No payments recorded" /> : (
              <ul className="px-6 pb-6 divide-y divide-line">
                {pays.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <Money cents={p.amount_cents} /> <span>{humanize(p.purpose)} · {humanize(p.method)}</span>
                    <span className="mono text-muted">{p.reference}</span>
                    <span className="text-muted">{fmtDate(p.created_at, true)}</span>
                    <span className="ml-auto"><StatusBadge status={p.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Order events">
            <div className="px-6 pb-6"><Timeline items={(events ?? []).map((e) => ({ title: e.title, body: e.body, at: e.created_at }))} /></div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Move order">
            <div className="px-6 pb-6">
              {!canEdit ? <p className="text-sm text-muted">View only.</p> : !next.length && o.status !== 'ready_to_ship' ? <p className="text-sm text-muted">No further moves from {humanize(o.status)}.</p> : (
                <div className="flex flex-wrap gap-2">
                  {next.map((to) => ['cancelled', 'disputed'].includes(to)
                    ? <ReasonButton key={to} action={transitionOrder.bind(null, o.id, to)} label={humanize(to)} title={`${humanize(to)} ${o.code}`} className="btn btn-ghost btn-sm text-bad" danger confirmLabel={humanize(to)} />
                    : <ReasonButton key={to} action={transitionOrder.bind(null, o.id, to)} label={`→ ${humanize(to)}`} title={`Move ${o.code} to ${humanize(to)}`} placeholder="Note for the order timeline (optional)" required={false} className="btn btn-primary btn-sm" confirmLabel="Move" />)}
                  {o.status === 'ready_to_ship' && <Link href={`/office/shipping?order=${o.id}`} className="btn btn-primary btn-sm">Create shipment →</Link>}
                </div>
              )}
              <p className="text-xs text-muted mt-3">Moves follow the order state machine; payment steps advance automatically when Finance matches money.</p>
            </div>
          </Card>
          <Card title="Record bank payment">
            <div className="px-6 pb-6">
              {!canPay ? <p className="text-sm text-muted">Only Finance can record payments.</p> : outstanding <= 0 ? <p className="text-sm text-ok">Fully paid.</p> : (
                <ActionForm action={recordPayment.bind(null, o.id)} submitLabel="Record payment" resetOnSuccess confirm="Record this payment? It posts to the ledger and cannot be edited.">
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="rp-amt" className="label">Amount (USD)</label>
                      <input id="rp-amt" name="amount" type="number" step="0.01" min="0.01" max={outstanding / 100} defaultValue={((depositDue || outstanding) / 100).toFixed(2)} className="input mono" required />
                      <p className="text-xs text-muted mt-1">{depositDue > 0 ? `Deposit due ${usd(depositDue)}` : `Balance due ${usd(outstanding)}`}</p>
                    </div>
                    <div>
                      <label htmlFor="rp-m" className="label">Method</label>
                      <select id="rp-m" name="method" className="input"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select>
                    </div>
                    <div>
                      <label htmlFor="rp-ref" className="label">Bank reference *</label>
                      <input id="rp-ref" name="reference" className="input mono" required placeholder="e.g. SWIFT ref / PI number" />
                    </div>
                  </div>
                </ActionForm>
              )}
            </div>
          </Card>
          <Card title="Shipments">
            {!ships?.length ? <EmptyState title="No shipments" /> : (
              <ul className="px-6 pb-6 space-y-2">
                {ships.map((sh) => (
                  <li key={sh.id} className="border border-line rounded-[10px] px-4 py-2 text-sm">
                    <div className="flex justify-between gap-2"><span className="mono font-semibold">{sh.tracking_no}</span><StatusBadge status={sh.status} /></div>
                    <div className="text-muted">{sh.code} · {sh.service_code}</div>
                    {sh.label_url && <a href={sh.label_url} target="_blank" rel="noopener" className="text-blue font-semibold text-xs">Print label</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
