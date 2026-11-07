import Link from 'next/link';
import { serviceName } from '@/lib/service-names';
import { getCompanyBankAccount } from '@/components/account/bank-data';
import { bankLines } from '@/lib/bank-accounts';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { Card, StatusBadge, Notice, Money, SupplierCode, OrderProgress, Timeline } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, humanize } from '@/lib/format';
import { getSettings, getWalletFunds, supplierMap, DOC_LABEL } from '@/components/account/data';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { OrderList, type OrderListItem } from '@/components/account/order-list';
import { PayWalletButton, CancelOrderButton } from '@/components/account/order-actions';
import { dueNow, CANCELLABLE, relTime, nowMs } from '@/components/account/order-utils';
import { payFromWallet, cancelOrder } from '../actions';

export const metadata = { title: 'Order' };

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  const s = await requireCustomer(`/account/orders/${id}`);
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sb = await createClient();
  const { data: o } = await sb.from('orders').select('*').eq('id', id).maybeSingle();
  if (!o) notFound();
  const [{ data: docs }, { data: events }, { data: shipments }, { data: list }, { data: pi }, settings, funds, content] = await Promise.all([
    sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, created_at').eq('order_id', id).order('created_at'),
    sb.from('order_events').select('id, kind, title, body, created_at').eq('order_id', id).order('created_at', { ascending: false }),
    sb.from('shipments').select('id, code, service_code, tracking_no, status, weight_kg, parcels, eta, last_event_at, created_at').eq('order_id', id).order('created_at', { ascending: false }),
    sb.from('orders').select('id, code, title, quantity, status, updated_at').eq('org_id', o.org_id).order('updated_at', { ascending: false }).limit(12),
    sb.from('proforma_invoices').select('number').eq('order_id', id).maybeSingle(),
    getSettings(),
    // Orders are paid from the wallet in the ORDER's currency (an old USD order stays payable in USD after a switch).
    getWalletFunds(o.currency as string),
    getSiteContent(),
  ]);
  const shipIds = (shipments ?? []).map((x) => x.id as string);
  const { data: tracking } = shipIds.length
    ? await sb.from('tracking_events').select('id, status, description, location, occurred_at').in('shipment_id', shipIds).order('occurred_at', { ascending: false })
    : { data: [] as { id: string; status: string; description: string | null; location: string | null; occurred_at: string }[] };
  const sup = (await supplierMap([o.supplier_id])).get(o.supplier_id);

  const money = { status: o.status as string, total_cents: Number(o.total_cents), deposit_cents: Number(o.deposit_cents), paid_cents: Number(o.paid_cents) };
  const due = dueNow(money);
  const cur = o.currency as string;
  const balanceDue = money.total_cents - money.paid_cents;
  const balance = funds.balance;
  const depositLeft = Math.max(0, money.deposit_cents - money.paid_cents);
  const ship = shipments?.[0];
  const lastTrack = tracking?.[0];
  const reference = pi?.number ?? o.code;
  const acct = await getCompanyBankAccount(cur);   // principal company account in the order currency
  const bank = content.blocks['payment.bank_details'] ?? content.blocks['bank.details'] ?? null;
  const company = content.company;

  const timeline = [
    ...(tracking ?? []).map((t) => ({ title: t.description || humanize(t.status), body: [t.location, 'Tracking'].filter(Boolean).join(' · '), at: t.occurred_at as string })),
    ...(events ?? []).map((e) => ({ title: e.title as string, body: (e.body as string | null) ?? null, at: e.created_at as string })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).map((it, i) => ({ ...it, tone: (i === 0 ? 'current' : 'done') as 'current' | 'done' }));

  const now = nowMs();
  const visibleOpen = o.claim_visible_until && new Date(o.claim_visible_until).getTime() > now;
  const hiddenOpen = o.claim_hidden_until && new Date(o.claim_hidden_until).getTime() > now;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="mb-2 text-sm"><Link href="/account/orders" className="text-blue">← All orders</Link></div>
          <h1 className="text-[30px] font-bold leading-tight">Orders &amp; tracking</h1>
          <p className="mt-1 text-muted">Every update on this order, as it happens.</p>
        </div>
        <RealtimeRefresh channel={`order-${id}`} subs={[{ table: 'order_events', filter: `order_id=eq.${id}` }, { table: 'tracking_events', filter: `org_id=eq.${o.org_id}` }]} />
      </div>
      {created && <div className="mb-6"><Notice tone="green">Quote approved. Proforma invoice {pi?.number ?? ''} has been issued — pay the {o.deposit_pct}% deposit to confirm the order.</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <aside className="hidden lg:block"><OrderList orders={(list ?? []) as OrderListItem[]} activeId={id} /></aside>

        <div className="space-y-6 min-w-0">
          <Card className="p-6">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <div className="mono text-xs text-muted">{o.code}{pi?.number ? ` · ${pi.number}` : ''}</div>
                <h2 className="text-2xl font-semibold mt-1">{o.title}</h2>
                <div className="mt-1 text-muted flex flex-wrap items-center gap-x-2">
                  {sup && <SupplierCode code={sup.code} country={sup.country} verified={sup.verified} />}
                  <span>· {Number(o.quantity).toLocaleString('en-US')} units · <Money cents={money.total_cents} currency={cur} className="text-navy" />{o.incoterm ? ` · ${o.incoterm}` : ''}</span>
                </div>
              </div>
              <StatusBadge status={o.status} />
            </div>
            {o.status !== 'cancelled' && <div className="mt-6"><OrderProgress status={o.status} /></div>}
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Order total', money.total_cents],
                [`Deposit (${o.deposit_pct}%)`, money.deposit_cents],
                ['Paid', money.paid_cents],
                ['Balance', balanceDue],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-[10px] bg-surface px-4 py-3">
                  <dt className="text-xs text-muted">{l}</dt>
                  <dd className="mt-1"><Money cents={v as number} currency={cur} className="text-lg" /></dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Payment */}
          {o.status !== 'cancelled' && (due || depositLeft > 0) && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold">{due ? `Pay the ${due.purpose}` : 'Payment'}</h2>
              {due ? (
                <p className="text-sm text-muted mt-1">Amount due now: <Money cents={due.amount} currency={cur} className="text-navy" /> · reference <span className="mono">{reference}</span></p>
              ) : <p className="text-sm text-muted mt-1">The balance invoice is issued before despatch. Nothing is due right now.</p>}
              {due && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {settings.wallet_enabled ? (
                    <div className="rounded-[10px] border border-line p-4">
                      <div className="font-semibold">Pay from {cur} wallet</div>
                      <p className="text-sm text-muted mt-1">{cur} wallet balance: <Money cents={balance} currency={cur} className="text-navy" />{funds.credit > 0 && <> · credit limit <Money cents={funds.credit} currency={cur} className="text-navy" /></>}</p>
                      <div className="mt-3"><PayWalletButton orderId={id} amountCents={due.amount} balanceCents={balance} creditCents={funds.credit} currency={cur} purpose={due.purpose} action={payFromWallet} /></div>
                    </div>
                  ) : null}
                  <div className="rounded-[10px] border border-line p-4">
                    <div className="font-semibold">Bank transfer</div>
                    <dl className="mt-2 text-sm space-y-1">
                      {acct ? bankLines(acct).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className={`font-semibold text-right ${/number|SWIFT|code/i.test(k) ? 'mono' : ''}`}>{v}</dd></div>
                      )) : <>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd className="font-semibold text-right">{company?.legal_name ?? '—'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Bank details</dt><dd className="text-right whitespace-pre-line">{bank ?? `Bank transfer in ${cur} is not set up yet — pay from your wallet or contact us.`}</dd></div>
                      </>}
                      <div className="flex justify-between gap-3"><dt className="text-muted">Reference</dt><dd className="mono font-semibold">{reference}</dd></div>
                    </dl>
                    {acct?.notes && <p className="text-sm mt-2">{acct.notes}</p>}
                    <p className="text-xs text-muted mt-2">Finance matches your transfer, usually within one business day. Bank charges at both ends are paid by the buyer.</p>
                  </div>
                </div>
              )}
              {!settings.wallet_enabled && due && <p className="text-xs text-muted mt-3">The wallet is switched off — please pay by bank transfer.</p>}
            </Card>
          )}

          {/* Live tracking */}
          {ship && (
            <Card className="p-6">
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="text-lg font-semibold flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-ok" aria-hidden />Live tracking · {serviceName(ship.service_code)}</h2>
                <span className="text-sm text-muted">Updated {relTime(ship.last_event_at ?? lastTrack?.occurred_at ?? ship.created_at)}</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[10px] bg-surface px-4 py-3"><div className="text-xs text-muted">Current location</div><div className="font-semibold mt-1">{lastTrack?.location ?? '—'}</div></div>
                <div className="rounded-[10px] bg-surface px-4 py-3"><div className="text-xs text-muted">Estimated delivery</div><div className="font-semibold mt-1">{ship.eta ? fmtDate(ship.eta) : '—'}</div></div>
                <div className="rounded-[10px] bg-surface px-4 py-3"><div className="text-xs text-muted">Waybill</div><div className="mono font-semibold mt-1 break-all">{ship.tracking_no ?? 'Pending'}</div></div>
                <div className="rounded-[10px] bg-surface px-4 py-3"><div className="text-xs text-muted">Shipment status</div><div className="mt-1"><StatusBadge status={ship.status} /></div></div>
                {(ship.parcels || ship.weight_kg) && <div className="rounded-[10px] bg-surface px-4 py-3"><div className="text-xs text-muted">Parcels</div><div className="font-semibold mt-1">{ship.parcels ?? 1} cartons{ship.weight_kg ? ` · ${ship.weight_kg} kg` : ''}</div></div>}
              </div>
            </Card>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">{ship ? 'Tracking history' : 'Order timeline'}</h2>
              <Timeline items={timeline} />
            </Card>
            <div className="space-y-6">
              <Card className="p-5">
                <h2 className="text-lg font-semibold mb-3">Documents</h2>
                {(docs ?? []).length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
                  <ul className="space-y-3">
                    {(docs ?? []).map((d) => (
                      <li key={d.id} className="rounded-[10px] border border-line p-3">
                        <div className="flex justify-between gap-2"><span className="font-semibold text-sm">{DOC_LABEL[d.doc_type] ?? humanize(d.doc_type)}</span><StatusBadge status={d.status ?? 'issued'} /></div>
                        <div className="mono text-xs text-muted mt-0.5">{d.number}{d.amount_cents != null ? ` · ` : ''}{d.amount_cents != null && <Money cents={Number(d.amount_cents)} currency={(d.currency as string) ?? cur} className="font-normal" />}</div>
                        <div className="mt-2"><DocumentButton docId={d.id} compact /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {o.delivered_at && (
                <Card className="p-5">
                  <h2 className="text-lg font-semibold">Claim window</h2>
                  <p className="text-sm text-muted mt-1">Delivered {fmtDate(o.delivered_at)}.</p>
                  <ul className="text-sm mt-2 space-y-1">
                    <li>Visible defects / shortage: until <strong>{fmtDate(o.claim_visible_until)}</strong> {visibleOpen ? '(open)' : '(closed)'}</li>
                    <li>Hidden defects: until <strong>{fmtDate(o.claim_hidden_until)}</strong> {hiddenOpen ? '(open)' : '(closed)'}</li>
                  </ul>
                </Card>
              )}
              <Card className="p-5">
                <h2 className="text-lg font-semibold">Need help?</h2>
                <p className="text-sm text-muted mt-1">Message us about {o.code}. Your reference is attached automatically.</p>
                <Link href={`/account/support?order=${id}`} className="btn btn-ghost w-full mt-3">Report a problem</Link>
                {CANCELLABLE.includes(o.status) && <div className="mt-3"><CancelOrderButton orderId={id} orderCode={o.code} action={cancelOrder} /></div>}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
