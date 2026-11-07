import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { parts } from '@/components/store/seo';
import { PageHeader, Card, EmptyState, Notice, Money, SupplierCode } from '@/components/ui';
import { fmtDate, money, COUNTRY_NAMES, humanize } from '@/lib/format';
import { getSettings, latestTermsId, supplierMap } from '@/components/account/data';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { nowMs } from '@/components/account/order-utils';
import { MessageForm, FileUpload } from '@/components/account/sourcing-forms';
import { MarkQuotesViewed } from '@/components/account/mark-quotes-viewed';
import { approveQuote } from '../../rfqs/actions';
import { STATUS_TONE, TYPE_LABEL, rfqStatus, serviceStatus, serviceType, timelineStep, type SourcingStatus } from '@/lib/sourcing';

export const metadata = { title: 'Sourcing request' };

type Quote = {
  id: string; code: string; supplier_id: string; unit_price_cents: number; quantity: number; incoterm: string; lead_time_days: number | null;
  shipping_cents: number; notes: string | null; status: string; valid_until: string; created_at: string; currency: string; moq: number | null; sample_price_cents: number | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /account/sourcing/[ref] — ref = request code (RFQ-… / SR-…) or id. RLS returns nothing for another customer's request → 404. */
export default async function SourcingDetail({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: raw } = await params;
  const ref = decodeURIComponent(raw);
  const s = await requireCustomer(`/account/sourcing/${raw}`);
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sb = await createClient();
  const col = UUID.test(ref) ? 'id' : 'code';
  const [{ data: rfq }, { data: svc }] = await Promise.all([
    sb.from('rfqs').select('*').eq(col, ref).maybeSingle(),
    sb.from('service_requests').select('*').eq(col, ref).maybeSingle(),
  ]);
  if (!rfq && !svc) notFound();
  const kind: 'rfq' | 'service' = rfq ? 'rfq' : 'service';
  const req = (rfq ?? svc)!;
  const id = req.id as string;
  const code = req.code as string;
  const fk = kind === 'rfq' ? 'rfq_id' : 'service_request_id';

  const [{ blocks }, { data: msgs }, { data: files }, settings, terms] = await Promise.all([
    getSiteContent(),
    sb.from('request_messages').select('id, from_staff, body, created_at').eq(fk, id).order('created_at'),
    sb.from('request_files').select('id, file_name, file_kind, size_bytes, from_staff, created_at').eq(fk, id).order('created_at'),
    getSettings(), latestTermsId(),
  ]);
  const steps = [1, 2, 3, 4, 5, 6].map((n) => parts(blocks, `request.next.${n}`)).filter((x) => x[0]);

  // sourcing: quotes, order and its invoices
  let quotes: (Quote & { total: number })[] = [];
  let order = null as { id: string; code: string; status: string } | null;
  let docs: { id: string; doc_type: string; number: string; created_at: string }[] = [];
  if (kind === 'rfq') {
    const [{ data: q }, { data: o }] = await Promise.all([
      sb.from('quotes').select('id, code, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_at, currency, moq, sample_price_cents').eq('rfq_id', id).order('unit_price_cents'),
      sb.from('orders').select('id, code, status').eq('rfq_id', id).maybeSingle(),
    ]);
    quotes = ((q ?? []) as Quote[]).map((x) => ({ ...x, unit_price_cents: Number(x.unit_price_cents), shipping_cents: Number(x.shipping_cents), sample_price_cents: x.sample_price_cents == null ? null : Number(x.sample_price_cents), total: Number(x.unit_price_cents) * x.quantity + Number(x.shipping_cents) }));
    order = o as typeof order;
    if (order) docs = ((await sb.from('documents').select('id, doc_type, number, created_at').eq('order_id', order.id).order('created_at')).data ?? []) as typeof docs;
  }
  const sup = await supplierMap(quotes.map((q) => q.supplier_id));
  const now = nowMs();
  const approvable = (q: (typeof quotes)[number]) => (q.status === 'sent' || q.status === 'viewed') && new Date(q.valid_until).getTime() > now && !order;
  const type = kind === 'rfq' ? 'sourcing' : serviceType(req.service_code as string);
  const status: SourcingStatus = kind === 'rfq' ? rfqStatus(req.status as string, order?.status) : serviceStatus(req.status as string, type);
  const reached: SourcingStatus = status === 'Closed' ? (quotes.length ? 'Quoted' : 'Submitted') : status;
  const step = timelineStep(status, reached);
  const details = (kind === 'service' ? (req.details ?? {}) : {}) as Record<string, unknown>;
  const hasNew = quotes.some((q) => q.status === 'sent');

  const rows: { label: string; render: (q: (typeof quotes)[number]) => React.ReactNode }[] = [
    { label: 'Unit price', render: (q) => <Money cents={q.unit_price_cents} currency={q.currency} className="text-lg" /> },
    { label: 'MOQ', render: (q) => (q.moq ? <span className="mono">{q.moq.toLocaleString('en-US')} {req.unit}</span> : <span className="text-muted">—</span>) },
    { label: 'Quantity quoted', render: (q) => <span className="mono">{q.quantity.toLocaleString('en-US')} {req.unit}</span> },
    { label: 'Total', render: (q) => <Money cents={q.total} currency={q.currency} /> },
    { label: 'Lead time', render: (q) => (q.lead_time_days != null ? `${q.lead_time_days} days` : '—') },
    { label: 'Incoterm', render: (q) => q.incoterm || '—' },
    { label: 'Valid until', render: (q) => fmtDate(q.valid_until) },
    { label: 'Sample price', render: (q) => (q.sample_price_cents != null ? <Money cents={q.sample_price_cents} currency={q.currency} /> : <span className="text-muted">—</span>) },
    { label: 'Notes', render: (q) => <span className="text-sm text-muted">{q.notes || '—'}</span> },
  ];

  return (
    <>
      {hasNew && <MarkQuotesViewed rfqId={id} />}
      <div className="mb-2 text-sm"><Link href="/account/sourcing" className="text-blue">← Product sourcing</Link></div>
      <PageHeader eyebrow={<span className="mono text-xs text-muted">{code} · {TYPE_LABEL[type]}</span>}
        title={(kind === 'rfq' ? req.title : (details.title ?? details.product ?? TYPE_LABEL[type])) as string}
        subtitle={`Sent ${fmtDate(req.created_at as string)}`}
        actions={<>
          <span className={`inline-flex rounded-full px-3 py-1.5 text-[13px] font-semibold ${STATUS_TONE[status]}`} data-testid="request-status">{status}</span>
          {kind === 'rfq' && <RealtimeRefresh channel={`rfq-${id}`} subs={[{ table: 'quotes', event: 'INSERT', filter: `rfq_id=eq.${id}` }, { table: 'quotes', event: 'UPDATE', filter: `rfq_id=eq.${id}` }]} />}
          <Link href="/request/sourcing" className="btn btn-ghost btn-sm">+ New request</Link>
        </>} />

      {order && (
        <div className="mb-6"><Notice tone="green">You accepted a quote — order <b>{order.code}</b> was created with a {settings.deposit_pct}% deposit held in escrow. <Link href={`/account/orders/${order.id}`} className="underline font-semibold" data-testid="go-to-order">Go to order</Link></Notice></div>
      )}

      {/* the same six steps as the request page */}
      {steps.length > 0 && (
        <ol className="card p-5 mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Progress" data-testid="timeline">
          {steps.map(([t, b], i) => {
            const done = i < step || (i === step && status !== 'Closed');
            const current = i === step && status !== 'Closed';
            return (
              <li key={t} aria-current={current ? 'step' : undefined} className="flex gap-2.5">
                <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold shrink-0 ${done ? 'bg-blue-fill text-white' : 'bg-line text-muted'}`}>{i < step ? '✓' : i + 1}</span>
                <span><b className={`block text-[14px] ${current ? 'text-blue' : ''}`}>{t}</b><span className="block text-[12.5px] text-muted leading-snug">{(b ?? '').replace('{currency}', String(req.currency ?? ''))}</span></span>
              </li>
            );
          })}
        </ol>
      )}
      {status === 'Closed' && <div className="mb-6"><Notice tone="amber">This request is closed ({humanize(req.status as string)}). Start a new request any time.</Notice></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        <div className="space-y-6 min-w-0">
          <Card title="Request details">
            <dl className="px-6 pb-6 grid gap-x-6 gap-y-3 sm:grid-cols-2 text-[14.5px]">
              {kind === 'rfq' ? <>
                <Item k="Product">{req.title as string}</Item>
                <Item k="Quantity">{Number(req.quantity).toLocaleString('en-US')} {req.unit as string}</Item>
                <Item k="Destination">{req.destination_country ? `${COUNTRY_NAMES[req.destination_country as string] ?? req.destination_country}${req.destination_city ? `, ${req.destination_city}` : ''}` : '—'}</Item>
                <Item k="Incoterm">{(req.incoterm as string) || '—'}</Item>
                <Item k="Target price">{req.target_price_cents ? <Money cents={Number(req.target_price_cents)} currency={req.currency as string} /> : '—'}</Item>
                <Item k="Expires">{req.expires_at ? fmtDate(req.expires_at as string) : '—'}</Item>
                {req.details && <div className="sm:col-span-2"><dt className="text-[12px] text-muted">Details</dt><dd className="whitespace-pre-line">{req.details as string}</dd></div>}
              </> : Object.entries(details).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                <Item key={k} k={humanize(k)}>{k.endsWith('country') || k === 'target_market' ? (COUNTRY_NAMES[String(v)] ?? String(v)) : String(v)}</Item>
              ))}
            </dl>
            {req.product_id && <ProductLink id={req.product_id as string} />}
          </Card>

          {kind === 'rfq' && (
            <Card title={`Quotes (${quotes.length})`} action={quotes.length > 1 ? <span className="text-sm text-muted">Side by side · supplier code only</span> : undefined}>
              {quotes.length === 0 ? (
                <EmptyState title="No quotes yet" body="Matched suppliers usually quote within 24 hours. This page updates by itself when a quote arrives." />
              ) : (
                <div className="overflow-x-auto px-2 pb-4" tabIndex={0} role="region" aria-label="Quotes compared">
                  <table className="w-full border-collapse min-w-[560px]" data-testid="quotes">
                    <thead><tr>
                      <th className="th w-40" scope="col"><span className="sr-only">Field</span></th>
                      {quotes.map((q) => (
                        <th key={q.id} scope="col" className="th align-top normal-case tracking-normal">
                          <div className="mono text-xs text-muted">{q.code}{q.status === 'sent' && <span className="ml-1.5 rounded-full bg-[#DC2626] text-white text-[10px] font-bold px-1.5 py-0.5">NEW</span>}</div>
                          <div className="mt-1"><SupplierCode code={sup.get(q.supplier_id)?.code ?? '—'} country={sup.get(q.supplier_id)?.country} verified={sup.get(q.supplier_id)?.verified} /></div>
                        </th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.label}><th scope="row" className="td text-left text-sm font-semibold text-muted">{r.label}</th>{quotes.map((q) => <td key={q.id} className="td">{r.render(q)}</td>)}</tr>
                      ))}
                      <tr>
                        <td className="td" />
                        {quotes.map((q) => (
                          <td key={q.id} className="td">
                            <div className="flex flex-col gap-2 items-start">
                              {approvable(q)
                                ? <ApproveQuoteButton quoteId={q.id} quoteCode={q.code} totalCents={q.total} currency={q.currency} depositPct={settings.deposit_pct} termsVersion={terms?.version} action={approveQuote} label="Accept quote" className="btn btn-primary btn-sm" />
                                : <span className="text-sm text-muted">{q.status === 'approved' ? 'Accepted' : order ? 'Not selected' : 'Not available'}</span>}
                              <a href="#ask" className="text-sm font-semibold text-blue">Ask a question</a>
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="px-6 pb-5 text-xs text-muted">Accepting creates the order and a proforma invoice; the {settings.deposit_pct}% deposit is held in escrow until the goods pass QC. <Link href="/legal/terms" className="underline">Terms</Link>.</p>
            </Card>
          )}

          <Card title="Messages with the sourcing team">
            <div className="px-6 pb-6 space-y-4">
              {(msgs ?? []).length === 0 ? <p className="text-sm text-muted">No messages yet. Questions about specs, packaging or samples go here.</p> : (
                <ul className="space-y-3" data-testid="messages">
                  {(msgs ?? []).map((m) => (
                    <li key={m.id as string} className={`rounded-[12px] px-4 py-3 max-w-[85%] ${m.from_staff ? 'bg-surface border border-line' : 'bg-[#E6EFFC] ml-auto'}`}>
                      <div className="text-[12px] text-muted">{m.from_staff ? 'Octopus sourcing team' : 'You'} · {fmtDate(m.created_at as string, true)}</div>
                      <p className="text-[14.5px] whitespace-pre-line mt-1">{m.body as string}</p>
                    </li>
                  ))}
                </ul>
              )}
              <MessageForm kind={kind} id={id} refCode={code} />
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Files">
            <div className="px-6 pb-6 space-y-4">
              {(files ?? []).length + docs.length === 0 ? <p className="text-sm text-muted">Photos, specs and invoices for this request appear here.</p> : (
                <ul className="space-y-2 text-[14px]" data-testid="files">
                  {(files ?? []).map((f) => (
                    <li key={f.id as string} className="flex justify-between gap-2">
                      <a href={`/api/request-files/${f.id}`} className="font-semibold text-blue truncate">{f.file_name as string}</a>
                      <span className="text-[12px] text-muted shrink-0">{humanize(f.file_kind as string)}{f.from_staff ? ' · team' : ''}</span>
                    </li>
                  ))}
                  {docs.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2">
                      <Link href={`/account/orders/${order!.id}`} className="font-semibold text-blue truncate">{d.number}</Link>
                      <span className="text-[12px] text-muted shrink-0">{humanize(d.doc_type)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <FileUpload kind={kind} id={id} refCode={code} />
            </div>
          </Card>
          <Card title="Wallet charge">
            <div className="px-6 pb-6 text-[14px] space-y-1" data-testid="wallet-charge">
              {Number(req.fee_minor ?? 0) > 0
                ? <><div className="text-[22px] font-bold">{money(Number(req.fee_minor), req.currency as string)}</div><div className="text-muted">{kind === 'rfq' ? 'Sourcing request fee' : `${TYPE_LABEL[type]} fee`}, charged {fmtDate(req.created_at as string)}{kind === 'service' && req.paid_via ? ` via ${humanize(req.paid_via as string)}` : ' from your wallet'}.</div><Link href="/account/ledger" className="text-blue font-semibold">See it in your ledger →</Link></>
                : <div className="text-muted">No fee was charged for this request.</div>}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-[12px] text-muted">{k}</dt><dd className="font-semibold">{children}</dd></div>;
}

async function ProductLink({ id }: { id: string }) {
  const sb = await createClient();
  const { data: p } = await sb.from('products').select('slug, title, image_url, status').eq('id', id).maybeSingle();
  if (!p) return null;
  return (
    <div className="mx-6 mb-6 rounded-[12px] border border-line p-3 flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.image_url && <img src={p.image_url as string} alt="" className="w-14 h-14 rounded-md object-cover border border-line" />}
      <div className="min-w-0"><div className="text-[12px] text-muted">Attached product</div>
        {p.status === 'live' ? <Link href={`/p/${p.slug}`} className="font-semibold hover:text-blue">{p.title as string}</Link> : <span className="font-semibold">{p.title as string}</span>}</div>
    </div>
  );
}
