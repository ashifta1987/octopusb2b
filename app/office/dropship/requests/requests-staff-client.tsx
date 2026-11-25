'use client';
import { useState, useTransition } from 'react';
import { DsBadge, DsCard, DsEmptyState } from '@/components/dropship-ui';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import { quoteDropshipRequestAction } from './actions';

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
};

const OPEN = new Set(['submitted', 'assigned', 'quoting', 'quoted']);

function QuoteForm({ r }: { r: StaffDropshipRequest }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const countries = (r.ship_to_countries?.length ? r.ship_to_countries : ['AE']).map((c) => c.trim().toUpperCase());
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid={`quote-form-${r.rfq_code}`}
      action={(fd) =>
        start(async () => {
          const res = await quoteDropshipRequestAction(fd);
          setMsg({ ok: res.ok, text: res.ok ? res.message ?? 'Quote sent.' : res.error ?? 'Could not send the quote.' });
        })
      }
    >
      <input type="hidden" name="rfq_id" value={r.rfq_id} />
      <label className="flex flex-col text-[12px]">
        <span className="ds-mut">Landed price per unit (US$)</span>
        <input name="landed" inputMode="decimal" required className="ds-input w-[130px]" placeholder="18.50"
          defaultValue={r.quoted_landed_cents != null ? (r.quoted_landed_cents / 100).toFixed(2) : ''} aria-label={`Landed price for ${r.rfq_code}`} />
      </label>
      <label className="flex flex-col text-[12px]">
        <span className="ds-mut">Country</span>
        <select name="country" className="ds-input" defaultValue={r.quoted_country ?? countries[0]} aria-label={`Country for ${r.rfq_code}`}>
          {countries.map((c) => (
            <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="ds-btn ds-btn-primary" disabled={pending}>
        {pending ? 'Sending…' : r.rfq_status === 'quoted' ? 'Update quote' : 'Send quote'}
      </button>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`w-full text-[12.5px] m-0 ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>
      )}
    </form>
  );
}

/** Batch 3 (F-07): staff list of merchant product requests with a landed-cost quote form (DS edit only). */
export function StaffDropshipRequestsClient({ rows, canEdit }: { rows: StaffDropshipRequest[]; canEdit: boolean }) {
  if (rows.length === 0) {
    return (
      <DsEmptyState title="No product requests yet" description="When a merchant asks Octopus to source a product, the request appears here with its RFQ code." />
    );
  }
  return (
    <DsCard noPadding>
      <div className="ds-scroll">
        <table className="ds-tbl min-w-[880px]" data-testid="staff-dropship-requests-table">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Merchant</th>
              <th scope="col">Product</th>
              <th scope="col">Status</th>
              <th scope="col">Quote</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rfq_id} data-testid={`staff-request-row-${r.rfq_code}`}>
                <td>
                  <div className="font-mono font-semibold">{r.rfq_code}</div>
                  <div className="ds-mut text-[12px]">{fmtDate(r.created_at)}</div>
                </td>
                <td>{r.org_name}</td>
                <td>
                  <div className="font-semibold">{r.title}</div>
                  <div className="ds-mut text-[12px]">
                    {[r.category_label, r.monthly_volume_band, r.wants_brand ? 'wants own brand' : null].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {r.product_link && (
                    <a href={r.product_link} target="_blank" rel="noopener noreferrer nofollow" className="text-[12px] underline">Reference link</a>
                  )}
                </td>
                <td>
                  <DsBadge tone={r.rfq_status === 'quoted' || r.rfq_status === 'accepted' ? 'ok' : 'info'}>
                    {r.merchant_label ?? r.rfq_status}
                  </DsBadge>
                  {r.quoted_landed_cents != null && (
                    <div className="ds-mut text-[12px] mt-1">
                      {money(r.quoted_landed_cents, 'USD')} to {COUNTRY_NAMES[r.quoted_country ?? ''] ?? r.quoted_country}
                    </div>
                  )}
                </td>
                <td>
                  {canEdit && OPEN.has(r.rfq_status) ? (
                    <QuoteForm r={r} />
                  ) : (
                    <span className="ds-mut text-[12.5px]">
                      {OPEN.has(r.rfq_status) ? 'Only Dropshipping staff can send quotes.' : 'Closed — no quote needed.'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DsCard>
  );
}
