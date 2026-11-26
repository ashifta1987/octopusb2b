'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsIcon, DsInput, DsLinkButton, DsNotice, DsSelect, DsTextarea, type DsBadgeTone,
} from '@/components/dropship-ui';
import { createClient } from '@/lib/supabase/client';
import type { CaseRow, OrderDetail } from '@/lib/dropship-problems';
import {
  CASE_KIND_LABEL, RETURN_REASONS, addressLines, caseStatusLabel, caseSteps, claimPhotoPath, fmtDay, fmtStamp, orderProgress, ticketStatusLabel, usd,
} from '@/lib/dropship-problems-shared';
import { cancelOrderAction } from '../../ds8-actions';
import { disputeReweighAction, openClaimAction, openReturnAction, updateAddressFromDetailAction } from '../../ds10-actions';

/**
 * Release 4 · Step 10 — Order detail (screens/OrderDetail.html, mobile/M_OrderDetail.html, states/States-Orders.html):
 * Items, Progress (+ full timeline), "Need to change this order?" (Cancel until packed · Change address until the label ·
 * Lost or damaged after it ships · Return after delivery — each disabled with its reason), Cost (Processing its own line),
 * Payment, Ship to, the claim / return stepper, the re-weigh charge (photo + 7-day dispute) and the linked tickets.
 */

type Notice = { tone: 'ok' | 'bad' | 'warn' | 'info'; title: string; text?: string } | null;
type Req = 'cancel' | 'address' | 'claim' | 'return';

const STATUS: Record<string, { label: string; tone: DsBadgeTone }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn' }, on_hold: { label: 'On hold', tone: 'bad' }, processing: { label: 'Processing', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'ok' }, delivered: { label: 'Delivered', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'neutral' }, refunded: { label: 'Refunded', tone: 'neutral' },
};
const PAY_LABEL: Record<string, string> = { wallet: 'Wallet', protection: 'Payment protection', pay_later: 'Invoice' };

export function OrderDetailClient({ detail: d, orgId, countryNames }: { detail: OrderDetail; orgId: string; countryNames: Record<string, string> }) {
  const router = useRouter();
  const name = d.order.external_order_name ?? d.order.order_number;
  const st = STATUS[d.order.merchant_status] ?? { label: d.order.merchant_status, tone: 'neutral' as DsBadgeTone };
  const country = countryNames[d.order.destination_country] ?? d.order.destination_country;
  const [notice, setNotice] = useState<Notice>(null);
  const firstEnabled: Req = d.actions.cancel ? 'cancel' : d.actions.claim ? 'claim' : d.actions.return ? 'return' : 'address';
  const [req, setReq] = useState<Req>(firstEnabled);
  const progress = orderProgress({
    created_at: d.order.created_at, charged_at: d.payment.charged_at, payment_option: d.payment.option, address_ok: d.stage.address_ok,
    packing_started: d.stage.packing_started, packed: d.stage.packed, handed_over: d.stage.handed_over, delivered: d.stage.delivered,
    cancelled: Boolean(d.order.cancelled_at), channel: d.order.channel,
  });
  const done = (n: Notice) => { setNotice(n); router.refresh(); };
  const reasons: Record<Req, string | null> = {
    cancel: d.actions.cancel ? null : d.actions.cancel_reason,
    address: d.actions.address ? null : 'This order is cancelled.',
    claim: d.actions.claim ? null : d.actions.claim_reason,
    return: d.actions.return ? null : d.actions.return_reason,
  };
  const enabled = (r: Req) => reasons[r] === null;

  return (
    <div className="flex flex-col gap-5" data-testid="order-detail-page">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <Link href="/account/dropship/orders" className="text-coral-text underline">Orders</Link> / {name}
      </nav>
      <header className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] font-bold flex items-center gap-3 flex-wrap text-ink">
            <span aria-hidden="true" className="w-10 h-10 rounded-[10px] bg-tint text-coral-text inline-flex items-center justify-center shrink-0"><DsIcon name="cart" size={20} /></span>
            <span>{`Order ${name}`}</span>
            <DsBadge tone={st.tone} testId="order-status">{st.label}</DsBadge>
          </h1>
          <p className="mt-1.5 mb-0 text-[14px] text-muted" data-testid="order-subtitle">
            {[d.order.channel === 'shopify' ? 'Shopify' : d.order.channel === 'manual' ? (d.order.test_order ? 'Test order' : 'Octopus') : d.order.channel.toUpperCase(),
              d.order.external_order_name ? d.order.order_number : null, `placed ${fmtStamp(d.order.created_at)}`].filter(Boolean).join(' · ')}
          </p>
          {d.order.reship_of && (
            <p className="mt-1 mb-0 text-[13px] text-muted">Free reship of <Link className="text-coral-text underline" href={`/account/dropship/orders/${d.order.reship_of.id}`}>{d.order.reship_of.external_order_name ?? d.order.reship_of.order_number}</Link></p>
          )}
        </div>
        {d.tracking_token && <DsLinkButton href={`/t/${d.tracking_token}`} variant="secondary" icon="truck">Tracking page</DsLinkButton>}
      </header>

      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="detail-notice">{notice.text}</DsNotice>}
      {d.payment.hold_code && !d.order.cancelled_at && (
        <DsNotice tone="warn" title="This order is on hold" testId="detail-hold">{d.payment.hold_message ?? 'See the Orders page to resolve it.'}</DsNotice>
      )}

      <div className="flex gap-5 flex-wrap items-start">
        <div className="flex flex-col gap-4 min-w-0" style={{ flex: '3 1 520px' }}>
          <DsCard title="Items" noPadding testId="detail-items">
            <ul className="list-none m-0 p-0">
              {d.items.map((i) => (
                <li key={`${i.item_id}-${i.model_no}`} className="flex justify-between gap-3 px-5 py-3.5 border-b border-divider flex-wrap">
                  <div>
                    <strong className="text-ink">{i.title}</strong> ×{i.qty}
                    <div className="text-[13px] text-muted">{[i.variant, i.model_no].filter(Boolean).join(' · ')}</div>
                  </div>
                  <DsBadge tone="ok">Shipped by Octopus</DsBadge>
                </li>
              ))}
              {d.other_items > 0 && (
                <li className="flex justify-between gap-3 px-5 py-3.5 flex-wrap bg-pearl rounded-b-[12px]" data-testid="detail-other-items">
                  <div><strong className="text-ink">{`${d.other_items} other item${d.other_items === 1 ? '' : 's'}`}</strong><div className="text-[13px] text-muted">Not an Octopus product</div></div>
                  <DsBadge tone="neutral">You or another supplier ships this</DsBadge>
                </li>
              )}
            </ul>
          </DsCard>

          <DsCard title="Progress" testId="detail-progress">
            <ol className="list-none m-0 p-0 flex flex-col gap-3 text-[14px]">
              {progress.map((s) => (
                <li key={s.label} className="flex gap-3" aria-current={s.state === 'current' ? 'step' : undefined}>
                  <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-full mt-1 shrink-0 ${s.state === 'done' ? 'bg-ok' : s.state === 'current' ? 'bg-coral' : 'border-2 border-line-strong'}`} />
                  <div>
                    <strong className={s.state === 'upcoming' ? 'font-medium text-muted' : 'text-ink'}>{s.label}</strong>
                    {s.detail && <div className="text-[13px] text-muted">{s.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
            {d.timeline.length > 0 && (
              <details className="mt-4" data-testid="detail-timeline">
                <summary className="cursor-pointer text-[14px] font-semibold text-coral-text min-h-[44px] flex items-center">Full history ({d.timeline.length})</summary>
                <ol className="list-none m-0 mt-2 p-0 flex flex-col gap-2.5">
                  {d.timeline.map((e, n) => (
                    <li key={n} className="text-[14px] border-l-2 border-line pl-3">
                      <div className="flex justify-between gap-2 flex-wrap"><strong className="text-ink">{e.title}</strong><span className="text-[12px] text-muted">{fmtStamp(e.at)}</span></div>
                      {e.body && <p className="m-0 text-[13px] text-muted">{e.body}</p>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </DsCard>

          {d.cases.map((c) => <CaseCard key={c.id} c={c} />)}

          <section className="ds-card" aria-labelledby="change-title" data-testid="change-card">
            <h2 id="change-title" className="m-0 mb-1 text-[17px] font-bold text-ink">Need to change this order?</h2>
            <p className="m-0 mb-3 text-[13px] text-muted">Your request goes to Octopus support. Refunds go back to your wallet.</p>
            <fieldset className="border-0 m-0 p-0 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <legend className="ds-label">What happened</legend>
              {([['cancel', 'Cancel (until packed)'], ['address', 'Change address'], ['claim', 'Lost or damaged (after it ships)'], ['return', 'Return (after delivery)']] as [Req, string][]).map(([k, label]) => (
                <label key={k} className={`flex gap-2.5 items-center min-h-[44px] rounded-[8px] px-3 text-[14px] ${req === k ? 'border-2 border-coral' : 'border border-line-strong'} ${enabled(k) ? 'text-ink cursor-pointer' : 'text-muted border-line'}`}>
                  <input type="radio" name="change" value={k} checked={req === k} disabled={!enabled(k)} onChange={() => setReq(k)} data-testid={`req-${k}`} /> {label}
                </label>
              ))}
            </fieldset>
            {(['cancel', 'claim', 'return'] as Req[]).filter((k) => !enabled(k)).length > 0 && (
              <ul className="m-0 mt-3 pl-5 text-[13px] text-muted" data-testid="req-reasons">
                {(['cancel', 'claim', 'return'] as Req[]).filter((k) => !enabled(k)).map((k) => <li key={k}>{reasons[k]}</li>)}
              </ul>
            )}
            <div className="mt-4">
              {req === 'cancel' && enabled('cancel') && <CancelForm d={d} onDone={done} />}
              {req === 'address' && enabled('address') && <AddressForm d={d} country={country} onDone={done} />}
              {req === 'claim' && enabled('claim') && <ClaimForm d={d} orgId={orgId} onDone={done} />}
              {req === 'return' && enabled('return') && <ReturnForm d={d} onDone={done} />}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4 min-w-0" style={{ flex: '2 1 320px' }}>
          <DsCard title="Cost" testId="detail-cost">
            <div className="ds-row"><span className="ds-mut">{`Product ×${d.order.units}`}</span><span>{usd(d.cost.product_cents)}</span></div>
            <div className="ds-row"><span className="ds-mut">{`Processing, ${d.order.units} item${d.order.units === 1 ? '' : 's'}`}</span><span data-testid="cost-processing">{usd(d.cost.processing_cents)}</span></div>
            <div className="ds-row"><span className="ds-mut">Packaging</span><span>Included</span></div>
            <div className="ds-row"><span className="ds-mut">{`Shipping to ${country}, one parcel`}</span><span>{usd(d.cost.shipping_cents)}</span></div>
            <div className="ds-row"><span className="ds-mut">{`Duties and tax (${d.order.incoterm})`}</span><span>{d.order.incoterm === 'DAP' ? 'Paid by the buyer' : usd(d.cost.duties_cents)}</span></div>
            <div className="ds-row font-bold border-t border-divider pt-2.5"><span>Total</span><span data-testid="cost-total">{usd(d.cost.total_cents)}</span></div>
            {d.cost.refunded_cents > 0 && <div className="ds-row text-ok"><span>Refunded</span><span data-testid="cost-refunded">{`−${usd(d.cost.refunded_cents)}`}</span></div>}
          </DsCard>

          <DsCard title="Payment" testId="detail-payment">
            <div className="ds-row"><span className="ds-mut">Method</span><span>{d.payment.option ? <DsBadge tone="neutral">{PAY_LABEL[d.payment.option]}</DsBadge> : d.order.reship_of ? 'No charge (reship)' : 'Not paid yet'}</span></div>
            <div className="ds-row"><span className="ds-mut">Paid</span><span>{d.payment.charged_at ? fmtStamp(d.payment.charged_at) : '—'}</span></div>
            {d.payment.option === 'protection' && d.payment.protection_status && (
              <div className="ds-row"><span className="ds-mut">Protection</span><span>{d.payment.protection_status === 'disputed' ? 'Held · dispute open' : d.payment.protection_status === 'held' ? `Held until ${fmtDay(d.payment.protection_release_at)}` : d.payment.protection_status.replace('_', ' ')}</span></div>
            )}
            <div className="ds-row"><span className="ds-mut">Shown on</span><span>{d.payment.invoice_number ? `${d.payment.invoice_number} · weekly statement` : '—'}</span></div>
          </DsCard>

          <DsCard title="Ship to" testId="detail-ship-to">
            <p className="m-0 text-[14px] leading-[1.6] text-ink">
              {[d.ship_to.name, ...addressLines(d.ship_to.address, country)].filter(Boolean).map((l, n) => <span key={n} className="block">{l}</span>)}
            </p>
            {d.actions.address && <DsButton variant="secondary" className="mt-3" onClick={() => setReq('address')} testId="edit-address">{d.actions.address_after_label ? 'Ask to redirect the parcel' : 'Edit address (until the label is printed)'}</DsButton>}
          </DsCard>

          {d.reweigh && <ReweighCard d={d} onDone={done} />}

          {d.tickets.length > 0 && (
            <DsCard title="Support tickets" testId="detail-tickets">
              <ul className="list-none m-0 p-0 flex flex-col gap-2">
                {d.tickets.map((t) => {
                  const s = ticketStatusLabel(t.status);
                  return (
                    <li key={t.id} className="flex justify-between gap-2 flex-wrap items-center">
                      <Link className="text-[14px] text-coral-text underline min-h-[44px] inline-flex items-center" href={`/account/dropship/support/${t.id}`}>{`${t.code} · ${t.subject}`}</Link>
                      <DsBadge tone={s.tone}>{s.label}</DsBadge>
                    </li>
                  );
                })}
              </ul>
            </DsCard>
          )}
        </div>
      </div>
    </div>
  );
}

function CaseCard({ c }: { c: CaseRow }) {
  const s = caseStatusLabel(c.status, c.kind);
  const steps = caseSteps(c);
  return (
    <section className="ds-card" aria-labelledby={`case-${c.id}`} data-testid={`case-${c.code}`}>
      <div className="flex justify-between gap-2 flex-wrap items-start">
        <h2 id={`case-${c.id}`} className="m-0 text-[17px] font-bold text-ink">{`${CASE_KIND_LABEL[c.kind]} · ${c.code}`}</h2>
        <DsBadge tone={s.tone} testId={`case-status-${c.code}`}>{s.label}</DsBadge>
      </div>
      <ol className="list-none m-0 mt-3 p-0 flex flex-col gap-2.5 text-[14px]" aria-label={`${c.code} steps`}>
        {steps.map((st) => (
          <li key={st.label} className="flex gap-3" aria-current={st.state === 'current' ? 'step' : undefined}>
            <span aria-hidden="true" className={`inline-block w-3 h-3 rounded-full mt-1 shrink-0 ${st.state === 'done' ? 'bg-ok' : st.state === 'current' ? 'bg-coral' : 'border-2 border-line-strong'}`} />
            <div><strong className={st.state === 'upcoming' ? 'font-medium text-muted' : 'text-ink'}>{st.label}</strong>{st.detail && <div className="text-[13px] text-muted">{st.detail}</div>}</div>
          </li>
        ))}
      </ol>
      {c.outcome_message && <p className="m-0 mt-3 text-[14px] text-ink" data-testid={`case-outcome-${c.code}`}>{c.outcome_message}</p>}
      {c.refund_cents != null && c.status === 'refunded' && (
        <DsNotice tone="ok" title={`${usd(c.refund_cents)} refunded to your wallet for order ${c.external_order_name ?? c.order_number}.`}>{c.credit_note ? `Credit note ${c.credit_note}.` : undefined}</DsNotice>
      )}
      {c.reship && <p className="m-0 mt-2 text-[14px]">Reship: <Link className="text-coral-text underline" href={`/account/dropship/orders/${c.reship.id}`}>{c.reship.order_number}</Link></p>}
      {(c.photo_urls ?? []).some(Boolean) && (
        <div className="flex gap-2 flex-wrap mt-3">
          {(c.photo_urls ?? []).map((u, n) => u && <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="text-[13px] text-coral-text underline min-h-[44px] inline-flex items-center">{`Photo ${n + 1}`}</a>)}
        </div>
      )}
      {c.ticket && <p className="m-0 mt-2 text-[13px] text-muted">Conversation: <Link className="text-coral-text underline" href={`/account/dropship/support/${c.ticket.id}`}>{c.ticket.code}</Link></p>}
    </section>
  );
}

function CancelForm({ d, onDone }: { d: OrderDetail; onDone: (n: Notice) => void }) {
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
      const r = await cancelOrderAction(d.order.id, msg || undefined);
      if (!r.ok) { setError(r.message); return; }
      onDone({ tone: r.data.accepted ? 'ok' : 'warn', title: r.data.accepted ? 'Cancelled' : 'Cancellation refused', text: r.data.message });
    }); }} data-testid="cancel-form">
      <DsTextarea label="Message" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Why the buyer cancelled (optional)" maxLength={300} />
      {error && <p role="alert" className="mt-2 mb-0 text-[13px] text-bad">{error}</p>}
      <div className="flex gap-2.5 mt-3 flex-wrap items-center">
        <DsButton type="submit" variant="danger" icon="x" loading={pending} disabled={pending} testId="cancel-send">Cancel order</DsButton>
        <span className="text-[13px] text-muted">{d.payment.charged_at ? 'The money goes back to your wallet.' : 'Nothing was charged for this order.'}</span>
      </div>
    </form>
  );
}

function AddressForm({ d, country, onDone }: { d: OrderDetail; country: string; onDone: (n: Notice) => void }) {
  const a = d.ship_to.address ?? {};
  const [f, setF] = useState({ name: a.name ?? '', phone: a.phone ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', region: a.region ?? '', postcode: a.postcode ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
      const r = await updateAddressFromDetailAction(d.order.id, { ...f, country: d.order.destination_country });
      if (!r.ok) { setError(r.message); return; }
      onDone(r.data.applied ? { tone: 'ok', title: 'Address saved', text: 'The new address is checked again before packing.' }
        : { tone: 'warn', title: 'Address not changed', text: `${r.data.message ?? ''} A ticket was opened in Support.` });
    }); }} data-testid="address-form">
      {d.actions.address_after_label && <DsNotice tone="warn" title="The shipping label is already printed">The address can&rsquo;t change any more. Send it anyway and Octopus support checks whether the parcel can be redirected.</DsNotice>}
      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <DsInput label="Buyer name" value={f.name} onChange={set('name')} required containerClassName="sm:col-span-2" />
        <DsInput label="Street address" value={f.line1} onChange={set('line1')} required containerClassName="sm:col-span-2" />
        <DsInput label="Apartment, building (optional)" value={f.line2} onChange={set('line2')} containerClassName="sm:col-span-2" />
        <DsInput label="City" value={f.city} onChange={set('city')} required />
        <DsInput label="Region (optional)" value={f.region} onChange={set('region')} />
        <DsInput label="Postcode" value={f.postcode} onChange={set('postcode')} error={error && /postcode|zip/i.test(error) ? error : undefined} />
        <DsInput label="Phone (optional)" value={f.phone} onChange={set('phone')} inputMode="tel" />
      </div>
      <p className="m-0 mt-2 text-[13px] text-muted">{`Country: ${country}. A different country changes the shipping price, so it can\u2019t be changed here.`}</p>
      {error && !/postcode|zip/i.test(error) && <p role="alert" className="mt-2 mb-0 text-[13px] text-bad" data-testid="address-error">{error}</p>}
      <div className="flex gap-2.5 mt-3 flex-wrap items-center">
        <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="address-send">Send request</DsButton>
        <span className="text-[13px] text-muted">Address changes are checked again before packing.</span>
      </div>
    </form>
  );
}

function ClaimForm({ d, orgId, onDone }: { d: OrderDetail; orgId: string; onDone: (n: Notice) => void }) {
  const [kind, setKind] = useState<'lost' | 'damaged'>(d.stage.delivered ? 'damaged' : 'lost');
  const [choice, setChoice] = useState<'reship' | 'refund'>('reship');
  const [msg, setMsg] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === 'damaged' && files.length === 0) { setError('Photos: add at least one photo of the damage.'); return; }
    start(async () => {
      const paths: string[] = [];
      if (files.length) {
        const sb = createClient();
        for (const f of files) {
          const p = claimPhotoPath(orgId, d.order.id, crypto.randomUUID(), f.type);
          if (!p) { setError(`Photos: ${f.name} is not a JPG, PNG or WebP image.`); return; }
          if (f.size > 10 * 1024 * 1024) { setError(`Photos: ${f.name} is larger than 10 MB.`); return; }
          const { error: upErr } = await sb.storage.from('ds-claims').upload(p, f, { contentType: f.type });
          if (upErr) { setError(`Photos: ${f.name} could not be uploaded. Try again.`); return; }
          paths.push(p);
        }
      }
      const r = await openClaimAction({ orderId: d.order.id, kind, choice, message: msg, photos: paths });
      if (!r.ok) { setError(r.message); return; }
      onDone({ tone: 'ok', title: `Claim ${r.data.code} sent`, text: r.data.message });
    });
  }
  return (
    <form onSubmit={submit} data-testid="claim-form">
      <fieldset className="border-0 m-0 p-0 flex gap-2 flex-wrap">
        <legend className="ds-label">The parcel is</legend>
        {(['lost', 'damaged'] as const).map((k) => (
          <label key={k} className="flex gap-2 items-center min-h-[44px] px-3 border border-line-strong rounded-[8px] text-[14px] cursor-pointer">
            <input type="radio" name="claim-kind" checked={kind === k} disabled={k === 'lost' && d.stage.delivered} onChange={() => setKind(k)} /> {k === 'lost' ? 'Lost (never arrived)' : 'Damaged'}
          </label>
        ))}
      </fieldset>
      <fieldset className="border-0 m-0 mt-3 p-0 flex gap-2 flex-wrap">
        <legend className="ds-label">You would like</legend>
        {(['reship', 'refund'] as const).map((k) => (
          <label key={k} className="flex gap-2 items-center min-h-[44px] px-3 border border-line-strong rounded-[8px] text-[14px] cursor-pointer">
            <input type="radio" name="claim-choice" checked={choice === k} onChange={() => setChoice(k)} /> {k === 'reship' ? 'A reship' : 'A refund to your wallet'}
          </label>
        ))}
      </fieldset>
      <DsTextarea label="Message" containerClassName="mt-3" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What the buyer told you" rows={4} maxLength={2000} required />
      <div className="mt-3">
        <label className="ds-label" htmlFor="claim-photos">{kind === 'damaged' ? 'Photos (at least one)' : 'Photos (optional)'}</label>
        <input id="claim-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" className="block text-[14px] min-h-[44px]"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))} data-testid="claim-photos" />
        <p className="m-0 mt-1 text-[12px] text-muted">Up to 6 photos, JPG / PNG / WebP, 10 MB each. Only you and Octopus support can see them.</p>
      </div>
      {error && <p role="alert" className="mt-2 mb-0 text-[13px] text-bad" data-testid="claim-error">{error}</p>}
      <div className="flex gap-2.5 mt-3 flex-wrap items-center">
        <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="claim-send">Send request</DsButton>
        <span className="text-[13px] text-muted">{`Claims are possible up to ${d.actions.claim_window_days} days after delivery.`}</span>
      </div>
    </form>
  );
}

function ReturnForm({ d, onDone }: { d: OrderDetail; onDone: (n: Notice) => void }) {
  const [to, setTo] = useState<'warehouse' | 'merchant'>('warehouse');
  const [reason, setReason] = useState('changed_mind');
  const [msg, setMsg] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(d.items.map((i) => [i.item_id, String(i.qty)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ra = d.return_address.merchant;
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
      const lines = d.items.map((i) => ({ item_id: i.item_id, qty: Number(qty[i.item_id] ?? 0) })).filter((l) => l.qty > 0);
      if (!lines.length) { setError('Units: at least one unit must come back.'); return; }
      const r = await openReturnAction({ orderId: d.order.id, to, reason, message: msg, lines });
      if (!r.ok) { setError(r.message); return; }
      onDone({ tone: 'ok', title: `Return ${r.data.code} recorded`, text: r.data.message });
    }); }} data-testid="return-form">
      <fieldset className="border-0 m-0 p-0 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <legend className="ds-label">The buyer sends it to</legend>
        <label className="flex gap-2 items-center min-h-[44px] px-3 border border-line-strong rounded-[8px] text-[14px] cursor-pointer">
          <input type="radio" name="return-to" checked={to === 'warehouse'} onChange={() => setTo('warehouse')} /> The Octopus warehouse
        </label>
        <label className="flex gap-2 items-center min-h-[44px] px-3 border border-line-strong rounded-[8px] text-[14px] cursor-pointer">
          <input type="radio" name="return-to" checked={to === 'merchant'} onChange={() => setTo('merchant')} disabled={!ra} /> Your return address
        </label>
      </fieldset>
      <p className="m-0 mt-2 text-[13px] text-muted" data-testid="return-rules">
        {to === 'warehouse'
          ? 'Refund rules: after the warehouse checks it, you get the product price of units that can be sold again, minus the return handling fee. Processing, shipping and duties are not refunded. Faulty or wrong items: the product price of every returned unit. The buyer pays the return postage.'
          : ra ? `Your return address: ${[ra.name, ra.line1, ra.city, ra.country].filter(Boolean).join(', ')}. Octopus refunds nothing for returns you receive yourself.` : 'Your return address is not approved yet (Settings).'}
      </p>
      <DsSelect label="Why the buyer returns it" containerClassName="mt-3" value={reason} onChange={(e) => setReason(e.target.value)}>
        {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </DsSelect>
      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        {d.items.map((i) => (
          <DsInput key={i.item_id} label={`Units back: ${i.title}`} type="number" min={0} max={i.qty} value={qty[i.item_id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [i.item_id]: e.target.value }))} />
        ))}
      </div>
      <DsTextarea label="Message" containerClassName="mt-3" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What the buyer told you, and the return tracking number if you have it" rows={3} maxLength={2000} required />
      {error && <p role="alert" className="mt-2 mb-0 text-[13px] text-bad" data-testid="return-error">{error}</p>}
      <div className="flex gap-2.5 mt-3 flex-wrap items-center">
        <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="return-send">Send request</DsButton>
        <span className="text-[13px] text-muted">{`Returns are possible up to ${d.actions.return_window_days} days after delivery.`}</span>
      </div>
    </form>
  );
}

function ReweighCard({ d, onDone }: { d: OrderDetail; onDone: (n: Notice) => void }) {
  const r = d.reweigh!;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="ds-card" style={{ background: '#FFFBF2', borderColor: '#F3D9A4' }} aria-labelledby="rw-title" data-testid="reweigh-card">
      <DsBadge tone="warn">Extra charge</DsBadge>
      <h2 id="rw-title" className="m-0 mt-2 mb-1.5 text-[16px] font-bold text-ink">{`Re-weigh on order ${d.order.external_order_name ?? d.order.order_number}: +${usd(r.amount_cents)}`}</h2>
      <p className="m-0 text-[13px] leading-[1.5] text-ink">
        {`The parcel weighed ${r.billed_weight_g - r.quoted_weight_g} g more than the product data (${r.billed_weight_g} g billed vs ${r.quoted_weight_g} g at payment).`}
        {r.dispute_state === null && (r.can_dispute ? ` You can dispute this until ${fmtDay(r.dispute_until)}.` : ' The dispute window has ended.')}
      </p>
      {r.dispute_state === 'open' && <p className="m-0 mt-2 text-[13px] text-ink" data-testid="reweigh-disputed">Dispute open. Octopus checks the weight and photo.</p>}
      {r.dispute_state === 'refunded' && <p className="m-0 mt-2 text-[13px] text-ok" data-testid="reweigh-refunded">{`Refunded ${usd(r.refund_cents)}${r.credit_note ? ` (credit note ${r.credit_note})` : ''}. ${r.dispute_answer ?? ''}`}</p>}
      {r.dispute_state === 'rejected' && <p className="m-0 mt-2 text-[13px] text-ink" data-testid="reweigh-rejected">{`Dispute not accepted: ${r.dispute_answer ?? ''}`}</p>}
      <div className="flex gap-2.5 mt-3 flex-wrap">
        {r.photo_url ? <DsLinkButton href={r.photo_url} variant="secondary" icon="image">View photo</DsLinkButton> : <span className="text-[13px] text-muted">No scale photo is kept for this parcel.</span>}
        {r.can_dispute && !open && <DsButton variant="secondary" onClick={() => setOpen(true)} testId="reweigh-dispute">Dispute</DsButton>}
      </div>
      {open && (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
          const res = await disputeReweighAction(d.order.id, r.id, reason);
          if (!res.ok) { setError(res.message); return; }
          setOpen(false);
          onDone({ tone: 'ok', title: 'Dispute sent', text: res.data.message });
        }); }}>
          <DsTextarea label="Why the charge is wrong" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={600} required error={error ?? undefined} />
          <div className="flex gap-2.5 mt-2 flex-wrap">
            <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="reweigh-dispute-send">Send dispute</DsButton>
            <DsButton variant="link" onClick={() => setOpen(false)}>Close</DsButton>
          </div>
        </form>
      )}
    </section>
  );
}
