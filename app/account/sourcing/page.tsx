import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { PageHeader, Card, EmptyState, Notice } from '@/components/ui';
import { fmtDate, money, COUNTRY_NAMES } from '@/lib/format';
import { listSourcing } from '@/components/account/sourcing-data';
import { SOURCING_STATUSES, SOURCING_TYPES, STATUS_TONE, TYPE_LABEL, isSourcingType, type SourcingStatus } from '@/lib/sourcing';

export const metadata = { title: 'Product sourcing' };

/** Account › Product sourcing: every request this customer sent from /request/* (sourcing + services), newest first. */
export default async function SourcingList({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; q?: string }> }) {
  const s = await requireCustomer('/account/sourcing');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sp = await searchParams;
  const all = await listSourcing(s.org.id);
  const status = (SOURCING_STATUSES as readonly string[]).includes(sp.status ?? '') ? (sp.status as SourcingStatus) : undefined;
  const type = isSourcingType(sp.type) ? sp.type : undefined;
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = all.filter((r) => (!status || r.status === status) && (!type || r.type === type) && (!q || r.ref.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)));
  const newQuotes = all.reduce((n, r) => n + r.newQuotes, 0);
  return (
    <>
      <PageHeader title="Product sourcing" subtitle="Your sourcing and service requests, the quotes you received and what happens next."
        actions={<Link href="/request/sourcing" className="btn btn-primary" data-testid="new-request">+ New request</Link>} />
      {newQuotes > 0 && <div className="mb-4"><Notice tone="blue"><b>{newQuotes} new quote{newQuotes === 1 ? '' : 's'}</b> waiting for you — open the request to compare.</Notice></div>}

      <form className="card p-4 mb-4 flex flex-wrap gap-3 items-end" role="search">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="sq" className="label">Search reference or product</label>
          <input id="sq" name="q" defaultValue={sp.q} className="input" placeholder="e.g. RFQ-1042 or handheld fan" />
        </div>
        <div>
          <label htmlFor="sst" className="label">Status</label>
          <select id="sst" name="status" defaultValue={status ?? ''} className="input">
            <option value="">All statuses</option>
            {SOURCING_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sty" className="label">Type</label>
          <select id="sty" name="type" defaultValue={type ?? ''} className="input">
            <option value="">All types</option>
            {SOURCING_TYPES.map((x) => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
          </select>
        </div>
        <button className="btn btn-dark">Filter</button>
        {(status || type || q) && <Link href="/account/sourcing" className="btn btn-ghost">Reset</Link>}
      </form>

      <Card>
        {rows.length === 0 ? (
          all.length === 0
            ? <EmptyState title="No sourcing requests yet" body="Tell us the product, quantity and destination. Matched, verified factories quote within 24 hours."
                action={<Link href="/request/sourcing" className="btn btn-primary">Start a sourcing request</Link>} />
            : <EmptyState title="No requests match" body="Try another status, type or search." action={<Link href="/account/sourcing" className="btn btn-ghost">Show all</Link>} />
        ) : (
          <ul className="divide-y divide-line" data-testid="sourcing-list">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/account/sourcing/${encodeURIComponent(r.ref)}`} className="grid gap-x-4 gap-y-1 px-5 py-4 hover:bg-pearl md:grid-cols-[150px_1fr_130px_120px_110px_110px] items-center" data-ref={r.ref}>
                  <div>
                    <div className="mono text-[13px] font-semibold">{r.ref}</div>
                    <div className="text-[12px] text-muted">{fmtDate(r.created_at)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.title}</div>
                    <div className="text-[13px] text-muted">
                      {TYPE_LABEL[r.type]}
                      {r.quantity != null && <> · {r.quantity.toLocaleString('en-US')} {r.unit ?? ''}</>}
                      {r.destination && <> · to {COUNTRY_NAMES[r.destination] ?? r.destination}</>}
                    </div>
                  </div>
                  <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS_TONE[r.status]}`}>{r.status}</span></div>
                  <div className="text-[13px]">
                    {r.kind === 'rfq' ? <>{r.quotes} quote{r.quotes === 1 ? '' : 's'}{r.newQuotes > 0 && <span className="ml-1.5 inline-flex rounded-full bg-bad text-white text-[11px] font-bold px-1.5" data-testid="row-new-quotes">{r.newQuotes} new</span>}</> : <span className="text-muted">—</span>}
                  </div>
                  <div className="text-[13px]">{r.fee > 0 ? money(r.fee, r.currency) : <span className="text-muted">No fee</span>}</div>
                  <div className="text-right text-[13px] font-semibold text-coral-text">{r.newQuotes > 0 ? 'Compare quotes →' : r.order ? 'Go to order →' : 'Open →'}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted mt-3">Quotes show the supplier code only. Supplier names and contacts stay with our sourcing team.</p>
    </>
  );
}
