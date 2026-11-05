import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, StatusBadge, EmptyState, Notice, Money, OrderProgress, Table } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, money, humanize, asCurrency, CURRENCIES, type Currency } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { getSettings, latestTermsId, supplierMap, DOC_LABEL } from '@/components/account/data';
import { ACTIVE_ORDER } from '@/components/account/order-utils';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { AccountTeamStrip } from '@/components/account/assistant/team-card';
import { approveQuote } from './rfqs/actions';

export const metadata = { title: 'Dashboard' };

const OPEN_RFQ = ['submitted', 'assigned', 'quoting', 'quoted'];

const NOTICES: Record<string, string> = { 'not-in-account': "That area isn't part of your account." };

export default async function AccountDashboard({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const s = await requireCustomer('/account');
  const notice = NOTICES[(await searchParams).notice ?? ''];
  const firstName = (s.profile?.full_name ?? '').split(/\s+/)[0] || 'there';
  if (!s.org) {
    return (
      <>
        {notice && <div className="mb-4"><Notice tone="blue">{notice}</Notice></div>}
        <h1 className="text-[30px] font-bold">Welcome back, {firstName}</h1>
        <div className="mt-4"><Notice tone="amber">Your staff account has no buyer company. <Link href="/onboarding" className="underline">Create a company profile</Link> to use the customer portal.</Notice></div>
      </>
    );
  }
  const org = s.org;
  const sb = await createClient();
  const now = new Date();
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const weekAhead = new Date(now.getTime() + 7 * 86400000).toISOString();

  const [{ data: rfqs }, { data: quotes }, { data: orders }, { data: srs }, { data: docs }, { data: ads }, settings, terms, ctx] = await Promise.all([
    sb.from('rfqs').select('id, status, expires_at').eq('org_id', org.id),
    sb.from('quotes').select('id, code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, currency, valid_until, rfqs!inner(code, title, org_id)')
      .in('status', ['sent', 'viewed']).eq('rfqs.org_id', org.id).gt('valid_until', now.toISOString()).order('valid_until'),
    sb.from('orders').select('id, code, title, quantity, status, total_cents, currency, supplier_id, created_at, updated_at').eq('org_id', org.id).order('updated_at', { ascending: false }),
    sb.from('service_requests').select('id, code, service_code, status, details, created_at, services(name), products(title)').eq('org_id', org.id).order('created_at', { ascending: false }).limit(3),
    sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, created_at, orders(code)').eq('org_id', org.id).in('doc_type', ['proforma_invoice', 'commercial_invoice', 'credit_note', 'receipt']).order('created_at', { ascending: false }).limit(4),
    sb.from('ad_campaigns').select('id, headline, body, image_url, target_countries, max_cpc_cents').eq('status', 'active').order('max_cpc_cents', { ascending: false }).limit(10),
    getSettings(),
    latestTermsId(),
    getCurrencyContext(),
  ]);

  const openRfqs = (rfqs ?? []).filter((r) => OPEN_RFQ.includes(r.status as string));
  const closingSoon = openRfqs.filter((r) => r.expires_at && (r.expires_at as string) <= weekAhead).length;
  const qList = (quotes ?? []).map((q) => ({
    ...q, rfq: q.rfqs as unknown as { code: string; title: string },
    total: Number(q.unit_price_cents) * Number(q.quantity) + Number(q.shipping_cents),
  }));
  const rfqWithQuotes = new Set(qList.map((q) => q.rfq_id)).size;
  const activeOrders = (orders ?? []).filter((o) => ACTIVE_ORDER.includes(o.status as string));
  const inTransit = activeOrders.filter((o) => o.status === 'shipped').length;
  // Spend per order currency + a total converted to the platform currency at the approved rate (labelled "converted").
  const spendBy: Partial<Record<Currency, number>> = {};
  (orders ?? []).filter((o) => o.status !== 'cancelled' && new Date(o.created_at as string) >= qStart)
    .forEach((o) => { const c = asCurrency(o.currency as string); spendBy[c] = (spendBy[c] ?? 0) + Number(o.total_cents); });
  const spendCurs = CURRENCIES.filter((c) => spendBy[c]);
  const mixedSpend = spendCurs.length > 1;
  const spendQuarter = mixedSpend
    ? spendCurs.reduce((a, c) => a + (toPlatform(ctx, spendBy[c]!, c) ?? 0), 0)
    : (spendCurs[0] ? spendBy[spendCurs[0]]! : 0);
  const spendCur = mixedSpend ? ctx.currency : (spendCurs[0] ?? ctx.currency);
  const spendHint = mixedSpend
    ? `Converted to ${ctx.currency} at the approved rate · ${spendCurs.map((c) => money(spendBy[c]!, c, { compact: true })).join(' + ')}`
    : `${spendCur}, order value`;
  const latest = activeOrders[0] ?? (orders ?? [])[0];
  const sup = await supplierMap([...qList.map((q) => q.supplier_id as string), latest?.supplier_id as string]);
  const ad = settings.ads_enabled
    ? (ads ?? []).find((a) => !(a.target_countries as string[] | null)?.length || (org.country && (a.target_countries as string[]).includes(org.country)))
    : undefined;

  let latestShipment = null as { tracking_no: string | null; carrier_code: string; eta: string | null } | null;
  let latestDocs: { id: string; doc_type: string; number: string }[] = [];
  let latestEvents: { title: string; created_at: string }[] = [];
  if (latest) {
    const [{ data: sh }, { data: ld }, { data: ev }] = await Promise.all([
      sb.from('shipments').select('tracking_no, carrier_code, eta').eq('order_id', latest.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('documents').select('id, doc_type, number').eq('order_id', latest.id).in('doc_type', ['commercial_invoice', 'proforma_invoice', 'confirmation']).order('created_at', { ascending: false }),
      sb.from('order_events').select('title, created_at').eq('order_id', latest.id).order('created_at', { ascending: false }).limit(1),
    ]);
    latestShipment = sh as typeof latestShipment;
    latestDocs = (ld ?? []) as typeof latestDocs;
    latestEvents = (ev ?? []) as typeof latestEvents;
  }
  const latestSup = latest ? sup.get(latest.supplier_id as string) : undefined;

  return (
    <>
      {notice && <div className="mb-4"><Notice tone="blue">{notice}</Notice></div>}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[30px] font-bold leading-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-muted">{qList.length ? `${qList.length} quote${qList.length === 1 ? ' is' : 's are'} waiting for your decision.` : 'No quotes are waiting for you right now.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RealtimeRefresh channel="dashboard" subs={[{ table: 'order_events', filter: `org_id=eq.${org.id}` }, { table: 'quotes', event: 'INSERT' }, { table: 'notifications', event: 'INSERT', filter: `org_id=eq.${org.id}` }]} />
          <Link href="/account/services" className="btn btn-ghost">New service request</Link>
          <Link href="/request/sourcing" className="btn btn-primary">New RFQ</Link>
        </div>
      </div>

      {org.kyc_status !== 'verified' && (
        <div className="mb-6"><Notice tone="amber">Your company is not verified yet (KYC: {humanize(org.kyc_status)}). Browsing and RFQs work now; live API keys and wallet withdrawals unlock after <Link href="/account/kyc" className="underline font-semibold">verification</Link>.</Notice></div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Open RFQs" value={openRfqs.length} hint={closingSoon ? `${closingSoon} closing this week` : 'none closing this week'} />
        <Stat label="Quotes to review" value={qList.length} hint={qList.length ? `across ${rfqWithQuotes} RFQ${rfqWithQuotes === 1 ? '' : 's'}` : 'all caught up'} hintTone={qList.length ? 'ok' : undefined} />
        <Stat label="Active orders" value={activeOrders.length} hint={`${inTransit} in transit`} />
        <Stat label={mixedSpend ? 'Spend this quarter (converted)' : 'Spend this quarter'} value={money(spendQuarter, spendCur, { compact: true })} hint={spendHint} />
      </div>

      <AccountTeamStrip orgId={org.id} />

      {ad && (
        <div className="mb-6">
          <div className="card px-5 py-4 flex flex-wrap items-center gap-4">
            <span className="mono text-[10px] font-semibold tracking-wider bg-surface border border-line rounded px-2 py-1 text-muted">SPONSORED</span>
            {ad.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={ad.image_url as string} alt="" className="w-14 h-14 rounded-[8px] object-cover" />
              : <div className="ph w-14 h-14 rounded-[8px]" aria-hidden />}
            <div className="flex-1 min-w-[200px]"><div className="font-semibold">{ad.headline}</div>{ad.body && <div className="text-sm text-muted">{ad.body}</div>}</div>
            <a href={`/api/ads/click?c=${ad.id}`} rel="sponsored noopener" className="btn btn-ghost btn-sm">Learn more</a>
          </div>
          <div className="text-right text-xs text-muted mt-1">Ad</div>
        </div>
      )}

      <Card className="mb-6" title="Quotes waiting for you" action={<Link href="/account/rfqs" className="text-sm font-semibold text-blue">All RFQs →</Link>}>
        <Table head={['RFQ', 'Product', 'Supplier code', 'Unit price', 'Incoterm', 'Lead time', 'Valid until', '']}
          empty={<EmptyState title="No quotes waiting" body="When suppliers reply to your RFQs, their quotes appear here." action={<Link href="/request/sourcing" className="btn btn-primary btn-sm">New RFQ</Link>} />}>
          {qList.slice(0, 8).map((q) => {
            const sp = sup.get(q.supplier_id as string);
            return (
              <tr key={q.id}>
                <td className="td mono text-sm whitespace-nowrap">{q.rfq.code}</td>
                <td className="td font-semibold">{q.rfq.title}</td>
                <td className="td mono text-sm">{sp?.code ?? '—'} {sp?.country && <span className="text-[10px] font-semibold bg-surface border border-line rounded px-1 ml-1">{sp.country}</span>}</td>
                <td className="td"><Money cents={Number(q.unit_price_cents)} currency={q.currency as string} /></td>
                <td className="td">{q.incoterm}</td>
                <td className="td">{q.lead_time_days != null ? `${q.lead_time_days} days` : '—'}</td>
                <td className="td">{fmtDate(q.valid_until as string)}</td>
                <td className="td">
                  <div className="flex justify-end gap-2">
                    <Link href={`/account/rfqs/${q.rfq_id}`} className="btn btn-ghost btn-sm">Compare</Link>
                    <ApproveQuoteButton quoteId={q.id as string} quoteCode={q.code as string} totalCents={q.total} currency={q.currency as string} depositPct={settings.deposit_pct} termsVersion={terms?.version} action={approveQuote} />
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card className="p-6">
          {latest ? (
            <>
              <div className="flex justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold"><Link href={`/account/orders/${latest.id}`} className="hover:text-blue">Order {latest.code}</Link></h2>
                  <p className="text-sm text-muted">{Number(latest.quantity).toLocaleString('en-US')} · {latest.title}{latestSup ? ` · Supplier ${latestSup.code}${latestSup.country ? ` (${latestSup.country})` : ''}` : ''} · {money(Number(latest.total_cents), latest.currency as string)}</p>
                </div>
                <StatusBadge status={latest.status as string} />
              </div>
              <div className="mt-5"><OrderProgress status={latest.status as string} /></div>
              {latestEvents[0] && <p className="text-xs text-muted mt-3">Last update: {latestEvents[0].title} · {fmtDate(latestEvents[0].created_at, true)}</p>}
              {latestShipment?.tracking_no && (
                <div className="mt-4 rounded-[10px] bg-surface px-4 py-3 flex flex-wrap justify-between gap-2">
                  <span className="text-sm">{latestShipment.carrier_code === 'yunexpress' ? 'YunExpress' : latestShipment.carrier_code} · <span className="mono">{latestShipment.tracking_no}</span>{latestShipment.eta ? ` · ETA ${fmtDate(latestShipment.eta)}` : ''}</span>
                  <Link href={`/account/orders/${latest.id}`} className="text-sm font-semibold text-blue">Track shipment</Link>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {latestDocs.slice(0, 2).map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-2 text-sm"><span className="text-muted">{DOC_LABEL[d.doc_type] ?? d.doc_type} {d.number}</span><DocumentButton docId={d.id} compact /></span>
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="No orders yet" body="Approve a quote to create your first order." action={<Link href="/account/rfqs" className="btn btn-primary btn-sm">View RFQs</Link>} />
          )}
        </Card>

        <Card title="Service requests" action={<Link href="/account/services" className="text-sm font-semibold text-blue">View all →</Link>}>
          <div className="px-6 pb-6 space-y-3">
            {(srs ?? []).length === 0 ? <EmptyState title="No service requests" body="Samples, QC, certification, 3PL and dropshipping requests appear here." /> : (srs ?? []).map((r) => {
              const d = (r.details ?? {}) as Record<string, unknown>;
              const sub = (d.title ?? (r.products as { title?: string } | null)?.title ?? '') as string;
              return (
                <div key={r.id} className="rounded-[12px] border border-line px-4 py-3 flex flex-wrap justify-between items-center gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{(r.services as { name?: string } | null)?.name ?? humanize(r.service_code as string)}{sub ? ` · ${sub}` : ''}</div>
                    <div className="text-xs text-muted"><span className="mono">{r.code}</span> · {fmtDate(r.created_at as string)}</div>
                  </div>
                  <StatusBadge status={r.status as string} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Recent invoices" action={<Link href="/account/ledger" className="text-sm font-semibold text-blue">All invoices →</Link>}>
        {(docs ?? []).length === 0 ? <EmptyState title="No invoices yet" body="Proforma and commercial invoices appear here once you approve a quote." /> : (
          <ul className="px-6 pb-4">
            {(docs ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 border-t border-line text-sm">
                <span className="mono flex-[1_1_130px]">{d.number}</span>
                <span className="flex-[2_1_200px] text-muted">{DOC_LABEL[d.doc_type as string] ?? d.doc_type}{(d.orders as unknown as { code: string } | null)?.code ? ` · ${(d.orders as unknown as { code: string }).code}` : ''}</span>
                <span className="flex-[1_1_100px]">{d.amount_cents != null ? <Money cents={Number(d.amount_cents)} currency={d.currency as string} /> : '—'}</span>
                <StatusBadge status={(d.status as string) ?? 'issued'} />
                <DocumentButton docId={d.id as string} compact />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
