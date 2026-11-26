'use client';
import { useMemo, useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsChip, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import { declineDropshipRequestAction, quoteDropshipRequestAction } from './actions';

export type StaffDropshipRequest = {
  rfq_id: string;
  rfq_code: string;
  title: string;
  rfq_status: string;
  merchant_label: string | null;
  org_name: string;
  product_link: string | null;
  category_label: string | null;
  monthly_volume_band: string | null;
  ship_to_countries: string[] | null;
  wants_brand: boolean;
  quoted_landed_cents: number | null;
  quoted_country: string | null;
  created_dropship_product_id: string | null;
  created_at: string;
  target_landed_cents: number | null;
  details: string | null;
  org_kyc_status: string | null;
  updated_at: string | null;
};

/** design v2 StaffRequests chips → Sourcing request statuses (the RFQ code and status stay real). */
type Bucket = 'new' | 'quoting' | 'quoted' | 'accepted' | 'declined' | 'closed';
const BUCKET: Record<string, Bucket> = {
  submitted: 'new', assigned: 'quoting', quoting: 'quoting', quoted: 'quoted', accepted: 'accepted',
  cancelled: 'declined', expired: 'closed', draft: 'closed',
};
const BUCKET_LABEL: Record<Bucket, string> = {
  new: 'New', quoting: 'Quoting', quoted: 'Quoted', accepted: 'Accepted', declined: 'Declined', closed: 'Closed',
};
const BUCKET_TONE: Record<Bucket, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  new: 'info', quoting: 'warn', quoted: 'ok', accepted: 'ok', declined: 'bad', closed: 'neutral',
};
const OPEN = new Set(['submitted', 'assigned', 'quoting', 'quoted']);
const countryName = (c: string) => COUNTRY_NAMES[c] ?? c;

function waiting(from: string): string {
  const h = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 3_600_000));
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
/** The merchant's own words: the request details minus the lines we already show as fields. */
function notesOf(details: string | null): string | null {
  if (!details) return null;
  const lines = details.split('\n').filter((l) => l.trim() && !/^\[Dropship product request\]|^(Category|Reference link|Expected orders\/month|Ship to|Branding requested):/.test(l));
  return lines.length ? lines.join('\n') : null;
}

function Detail({ r, canEdit, canSeeSourcing, processingCents }: {
  r: StaffDropshipRequest; canEdit: boolean; canSeeSourcing: boolean; processingCents: number | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const countries = (r.ship_to_countries?.length ? r.ship_to_countries : []).map((c) => c.trim().toUpperCase());
  const notes = notesOf(r.details);
  const open = OPEN.has(r.rfq_status);
  const say = (res: { ok: boolean; message?: string; error?: string }) => setMsg({ ok: res.ok, text: res.ok ? res.message ?? 'Done.' : res.error ?? 'Something went wrong.' });

  return (
    <div className="flex flex-col gap-4" data-testid={`request-detail-${r.rfq_code}`}>
      <DsCard title="Request details" icon="file">
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <dt className="text-muted">Merchant</dt>
          <dd className="m-0">{r.org_name}{r.org_kyc_status === 'verified' ? ' · verified' : r.org_kyc_status ? ` · KYC ${r.org_kyc_status.replace(/_/g, ' ')}` : ''}</dd>
          <dt className="text-muted">Link they sent</dt>
          <dd className="m-0 break-all">{r.product_link ? <a href={r.product_link} target="_blank" rel="noopener noreferrer nofollow" className="underline text-coral-text">{r.product_link}</a> : '—'}</dd>
          <dt className="text-muted">Notes</dt><dd className="m-0 whitespace-pre-line">{notes ?? '—'}</dd>
          <dt className="text-muted">Sourcing request</dt>
          <dd className="m-0"><span className="font-mono">{r.rfq_code}</span> · {r.merchant_label ?? r.rfq_status}</dd>
        </dl>
      </DsCard>

      {canSeeSourcing && (
        <DsCard title="Sourcing match (staff with cost permission only)" icon="lock" testId="request-sourcing-match">
          <p className="m-0 text-[13px]">Supplier, Sourcing model no. and purchase cost are kept on the Sourcing request.{' '}
            <a href={`/office/rfqs/${r.rfq_id}`} className="underline text-coral-text">Open {r.rfq_code} in Sourcing</a></p>
        </DsCard>
      )}

      <DsCard title="Landed quote for the merchant" icon="dollar" noPadding testId="request-landed-quote">
        <div className="ds-scroll">
          <table className="ds-tbl min-w-[560px]">
            <thead><tr><th scope="col">Country</th><th scope="col">Product</th><th scope="col">Processing</th><th scope="col">Shipping</th><th scope="col">Duties</th><th scope="col">Landed</th></tr></thead>
            <tbody>
              {countries.length === 0 && <tr><td colSpan={6} className="text-muted">The merchant didn’t choose countries.</td></tr>}
              {countries.map((c) => (
                <tr key={c}>
                  <td>{countryName(c)}</td>
                  <td className="text-muted">After the product is set up</td>
                  <td className="font-mono">{processingCents != null ? money(processingCents, 'USD') : 'Not set'}</td>
                  <td className="text-muted">Needs weight and box size</td>
                  <td className="text-muted">Not known yet</td>
                  <td className="font-mono">{r.quoted_country === c && r.quoted_landed_cents != null ? money(r.quoted_landed_cents, 'USD') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 px-5 py-3 text-[12.5px] text-muted">The quote sent is one landed price per unit for one country. The full breakdown comes from the quote engine once the private product has weight, box size and a verified HS code.</p>
      </DsCard>

      {canEdit && open ? (
        <DsCard title="Send quote" icon="send">
          <form className="flex flex-wrap items-end gap-3" data-testid={`quote-form-${r.rfq_code}`}
            onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => say(await quoteDropshipRequestAction(fd))); }}>
            <input type="hidden" name="rfq_id" value={r.rfq_id} />
            <DsInput label="Landed price per unit (US$)" name="landed" inputMode="decimal" required placeholder="18.50"
              defaultValue={r.quoted_landed_cents != null ? (r.quoted_landed_cents / 100).toFixed(2) : ''} />
            <DsSelect label="Country" name="country" defaultValue={r.quoted_country ?? countries[0] ?? ''} required>
              {countries.length === 0 && <option value="">Choose</option>}
              {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </DsSelect>
            <DsButton type="submit" disabled={pending || countries.length === 0} disabledReason={countries.length === 0 ? 'The request has no country' : undefined}>
              {r.rfq_status === 'quoted' ? 'Update quote' : 'Send quote'}
            </DsButton>
          </form>
          <p className="mt-2 mb-0 text-[12.5px] text-muted">No supplier names or costs are sent to the merchant.</p>
          <div className="mt-4 border-t border-line pt-3">
            {declining ? (
              <form className="flex flex-wrap gap-2 items-end" action={() => start(async () => { const res = await declineDropshipRequestAction(r.rfq_id, reason); say(res); if (res.ok) setDeclining(false); })}>
                <DsInput label="Why is it declined?" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>Decline request</DsButton>
                <DsButton variant="link" onClick={() => setDeclining(false)}>Cancel</DsButton>
              </form>
            ) : (
              <DsButton variant="secondary" testId={`decline-${r.rfq_code}`} onClick={() => { setDeclining(true); setReason(''); }}>Decline request</DsButton>
            )}
          </div>
        </DsCard>
      ) : (
        <p className="m-0 text-[13px] text-muted">
          {!open ? (r.created_dropship_product_id ? <>Accepted: <a className="underline text-coral-text" href={`/office/dropship/${r.created_dropship_product_id}`}>open the private product</a> (only this merchant can see it).</> : 'Closed. No quote needed.')
            : 'Support can view requests but can’t send quotes.'}
        </p>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </div>
  );
}

/** EA-1 (design v2 StaffRequests): one queue for merchant product requests, linked to the real RFQ code. */
export function StaffDropshipRequestsClient({ rows, canEdit, canSeeSourcing, processingCents }: {
  rows: StaffDropshipRequest[]; canEdit: boolean; canSeeSourcing: boolean; processingCents: number | null;
}) {
  // open on the first filter that has requests (New first)
  const [bucket, setBucket] = useState<Bucket>(() =>
    (Object.keys(BUCKET_LABEL) as Bucket[]).find((b) => rows.some((r) => (BUCKET[r.rfq_status] ?? 'closed') === b)) ?? 'new');
  const [selected, setSelected] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { new: 0, quoting: 0, quoted: 0, accepted: 0, declined: 0, closed: 0 };
    for (const r of rows) c[BUCKET[r.rfq_status] ?? 'closed'] += 1;
    return c;
  }, [rows]);
  const shown = rows.filter((r) => (BUCKET[r.rfq_status] ?? 'closed') === bucket);
  const current = rows.find((r) => r.rfq_id === selected) ?? shown[0] ?? null;

  if (rows.length === 0) {
    return <DsEmptyState icon="file" title="No product requests yet" description="When a merchant asks us to source a product, the request appears here with its RFQ code." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter requests">
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
          <DsChip key={b} pressed={bucket === b} onClick={() => { setBucket(b); setSelected(null); }} testId={`request-filter-${b}`}>
            {BUCKET_LABEL[b]}{counts[b] ? ` (${counts[b]})` : ''}
          </DsChip>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-5 items-start">
        <DsCard title="Requests" icon="list" noPadding>
          {shown.length === 0 ? <div className="p-5"><DsEmptyState icon="file" title={`No ${BUCKET_LABEL[bucket].toLowerCase()} requests`} description="Choose another filter." /></div> : (
            <div className="ds-scroll">
              <table className="ds-tbl min-w-[860px]" data-testid="staff-dropship-requests-table">
                <thead><tr>
                  <th scope="col">Request</th><th scope="col">Merchant</th><th scope="col">Product</th><th scope="col">Target landed</th>
                  <th scope="col">Countries</th><th scope="col">Orders / month</th><th scope="col">Own brand</th><th scope="col">Waiting</th>
                </tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const isCurrent = current?.rfq_id === r.rfq_id;
                    return (
                      <tr key={r.rfq_id} data-testid={`staff-request-row-${r.rfq_code}`} aria-selected={isCurrent} className={isCurrent ? 'bg-tint-2' : undefined}>
                        <td>
                          <button type="button" className="font-mono font-semibold underline text-coral-text min-h-[44px]" onClick={() => setSelected(r.rfq_id)}
                            aria-label={`Open ${r.rfq_code}`}>{r.rfq_code}</button>
                          <div><DsBadge tone={BUCKET_TONE[BUCKET[r.rfq_status] ?? 'closed']}>{r.merchant_label ?? r.rfq_status}</DsBadge></div>
                        </td>
                        <td>{r.org_name}</td>
                        <td>{r.title}</td>
                        <td className="font-mono">{r.target_landed_cents != null ? money(r.target_landed_cents, 'USD') : '—'}</td>
                        <td>{(r.ship_to_countries ?? []).map((c) => countryName(c.trim().toUpperCase())).join(', ') || '—'}</td>
                        <td>{r.monthly_volume_band ?? '—'}</td>
                        <td>{r.wants_brand ? 'Yes' : 'No'}</td>
                        <td>{OPEN.has(r.rfq_status) ? waiting(r.created_at) : fmtDate(r.updated_at ?? r.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DsCard>
        <div>
          {current && (current.rfq_id === selected || (BUCKET[current.rfq_status] ?? 'closed') === bucket) ? (
            <>
              <h2 className="m-0 mb-3 text-[18px] font-bold text-ink"><span className="font-mono">{current.rfq_code}</span> · {current.title}</h2>
              <Detail key={current.rfq_id} r={current} canEdit={canEdit} canSeeSourcing={canSeeSourcing} processingCents={processingCents} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
