'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsChip, DsDialog, DsEmptyState, DsIcon, DsInput, DsLinkButton, DsNotice, DsPageHeader,
} from '@/components/dropship-ui';
import type { OrderRow, OrdersPageData } from '@/lib/dropship-orders';
import {
  bulkPlan, channelLabel, chipCounts, inChip, itemsSummary, otherItemsText, paymentLabel, rowAction, statusLabel, usd, type Chip,
} from '@/lib/dropship-orders-shared';
import { cancelOrderAction, chargeOrdersAction, updateAddressAction, type ChargeResult } from '../ds8-actions';

/**
 * Release 3 · Step 8 — Orders screen (screens/Orders.html, mobile/M_Orders.html, states/States-Orders.html):
 * header, wallet bar (Available, Held, Add funds), filter chips, the orders table with a Payment column, the high-risk review
 * panel (Charge and ship / Cancel order), Fix address dialog, bulk "Charge and ship" (oldest first). Step 10: the order number
 * opens the order detail page (claims, returns, re-weigh, tickets). Pay later is offered only
 * when the server says the organisation is credit_eligible (data.pay_later is null for everyone else — never shown, not even
 * disabled).
 */

type Notice = { tone: 'ok' | 'bad' | 'warn' | 'info'; title: string; text?: string; testId?: string } | null;

const CHIPS: { key: Chip; label: (n: number) => string; count: boolean }[] = [
  { key: 'to_pay', label: (n) => `To pay (${n})`, count: true },
  { key: 'all', label: () => 'All', count: false },
  { key: 'processing', label: (n) => `Processing (${n})`, count: true },
  { key: 'shipped', label: () => 'Shipped', count: false },
  { key: 'delivered', label: () => 'Delivered', count: false },
  { key: 'issues', label: (n) => `Issues (${n})`, count: true },
];

const orderName = (r: OrderRow) => r.external_order_name ?? r.order_number;

export function OrdersClient({ data, countryNames, paused }: {
  data: OrdersPageData;
  countryNames: Record<string, string>;
  paused: { status: 'paused' | 'off'; reason: string | null } | null;
}) {
  const router = useRouter();
  const counts = useMemo(() => chipCounts(data.rows), [data.rows]);
  const [chip, setChip] = useState<Chip>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<OrderRow | null>(null);
  const [fix, setFix] = useState<OrderRow | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<OrderRow | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [option, setOption] = useState<'wallet' | 'protection' | 'pay_later'>(data.settings.payment_mode === 'pay_later' && !data.pay_later ? 'wallet' : data.settings.payment_mode);
  const [pending, start] = useTransition();
  const rows = data.rows.filter((r) => inChip(r, chip));
  const plan = bulkPlan(data.rows, data.wallet.available_cents);
  const waitingShort = plan.due.length > 0 && plan.totalDue > data.wallet.available_cents;
  const lowWallet = waitingShort || data.rows.some((r) => r.last_charge_error === 'WALLET_INSUFFICIENT' && rowAction(r) === 'pay');
  const canStart = !paused;
  const pausedReason = 'Dropshipping is paused for your company, so new charges can\u2019t start. Orders already paid keep shipping.';
  const selectable = rows.filter((r) => rowAction(r) === 'pay');
  const selRows = data.rows.filter((r) => selected.includes(r.id));
  const selTotal = selRows.reduce((s, r) => s + (r.total_cents ?? 0), 0);

  function report(results: ChargeResult[], charged: number) {
    const bad = results.filter((x) => !x.ok);
    if (!bad.length) {
      setNotice({ tone: 'ok', title: charged === 1 ? `Order ${results[0]?.order_number ?? ''} paid and sent to the warehouse` : `${charged} orders paid and sent to the warehouse`,
        text: results.some((x) => x.invoice_number) ? `Invoice ${results.filter((x) => x.invoice_number).map((x) => x.invoice_number).join(', ')}.` : 'Held under payment protection until 7 days after delivery.', testId: 'orders-notice' });
    } else {
      setNotice({ tone: charged ? 'warn' : 'bad', title: charged ? `${charged} paid, ${bad.length} not paid` : 'Not paid',
        text: bad.map((x) => `${x.order_number}: ${x.message ?? x.code}`).join(' '), testId: 'orders-notice' });
    }
  }

  function charge(ids: string[]) {
    setNotice(null);
    start(async () => {
      const r = await chargeOrdersAction(ids, option === data.settings.payment_mode ? null : option);
      if (!r.ok) setNotice({ tone: 'bad', title: 'Not paid', text: r.message, testId: 'orders-notice' });
      else report(r.data.results, r.data.charged);
      setSelected([]);
      setReview(null);
      router.refresh();
    });
  }

  function cancel(r: OrderRow) {
    setNotice(null);
    start(async () => {
      const res = await cancelOrderAction(r.id);
      if (!res.ok) setNotice({ tone: 'bad', title: 'Not cancelled', text: res.message, testId: 'orders-notice' });
      else setNotice({ tone: res.data.accepted ? 'ok' : 'warn', title: res.data.accepted ? 'Cancelled' : 'Cancellation refused', text: res.data.message, testId: 'orders-notice' });
      setConfirmCancel(null);
      setReview(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-orders-page">
      <DsPageHeader
        title="Orders"
        icon="cart"
        subtitle={data.store_connected
          ? 'Orders with Octopus products from all your stores.'
          : 'Orders with Octopus products from all your stores. Connect a store and new orders arrive here by themselves.'}
        actions={<DsLinkButton href="/account/invoices" variant="secondary" icon="file">Statements &amp; invoices</DsLinkButton>}
      />

      {paused && (
        <DsNotice tone="info" title="Paid orders in progress continue shipping" testId="orders-paused-fulfilment-note">
          Your Dropshipping service is currently {paused.status === 'paused' ? 'paused' : 'closed'}{paused.reason ? ` (${paused.reason})` : ''}. Every paid order below
          continues through packing, shipping and delivery as normal; new orders can&rsquo;t be charged.
        </DsNotice>
      )}

      <section aria-label="Wallet" data-testid="orders-wallet-bar" className="ds-card flex flex-wrap items-center gap-x-8 gap-y-3 !py-3.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-[#5B6478]">Available</span>
          <strong className="text-[20px] text-[#1A174A]" data-testid="wallet-available">{usd(data.wallet.available_cents)}</strong>
          {lowWallet && <DsBadge tone="warn" testId="wallet-low">Low</DsBadge>}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-[#5B6478]">Held</span>
          <strong className="text-[20px] text-[#1A174A]" data-testid="wallet-held">{usd(data.wallet.held_cents)}</strong>
        </div>
        <div className="ml-auto"><DsLinkButton href="/account/dropship/wallet#add-funds" icon="plus" testId="orders-add-funds">Add funds</DsLinkButton></div>
      </section>

      {notice && <DsNotice tone={notice.tone} title={notice.title} testId={notice.testId}>{notice.text}</DsNotice>}

      {!data.store_connected && data.rows.length > 0 && (
        <p className="m-0 text-[13px] text-[#5B6478]" data-testid="orders-no-store">
          No store is connected yet. <Link className="font-semibold text-[#2A6FD1] underline" href="/account/dropship/stores">Connect a store</Link> to receive orders automatically.
        </p>
      )}

      {data.rows.length === 0 ? (
        <DsCard testId="orders-empty">
          <DsEmptyState icon="cart" title="No orders yet"
            description={data.store_connected
              ? 'Orders with Octopus products appear here within minutes of a sale.'
              : 'Orders with Octopus products appear here within minutes of a sale, once a store is connected.'}
            actionLabel={data.store_connected ? 'Push more products' : 'Connect a store'}
            actionHref={data.store_connected ? '/account/dropship/catalogue?list=1' : '/account/dropship/stores'}
            actionIcon={data.store_connected ? 'upload' : 'store'} />
        </DsCard>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter orders" data-testid="orders-chips">
            {CHIPS.map((c) => (
              <DsChip key={c.key} pressed={chip === c.key} onClick={() => { setChip(c.key); setSelected([]); }} testId={`chip-${c.key}`}>
                {c.count ? c.label(counts[c.key]) : c.label(0)}
              </DsChip>
            ))}
          </div>

          {(chip === 'to_pay' || chip === 'all') && selectable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3" data-testid="orders-bulk">
              <DsButton icon="check" testId="bulk-charge" loading={pending}
                disabled={!canStart || pending || selected.length === 0}
                disabledReason={!canStart ? pausedReason : selected.length === 0 ? 'Select the orders to pay.' : undefined}
                onClick={() => charge(selected)}>
                {selected.length ? `Charge and ship (${selected.length}) · ${usd(selTotal)}` : 'Charge and ship selected'}
              </DsButton>
              {waitingShort && (
                <span className="text-[13px] text-[#8A5300]" data-testid="bulk-short">
                  {`Waiting orders need ${usd(plan.totalDue)}; your wallet has ${usd(data.wallet.available_cents)}. They are paid oldest first.`}
                </span>
              )}
              {(
                <label className="flex items-center gap-2 text-[13px] text-[#1A174A]">
                  <span>Pay with</span>
                  <select className="ds-input !min-h-[44px] !w-auto" value={option} onChange={(e) => setOption(e.target.value as typeof option)} aria-label="Pay with" data-testid="bulk-option">
                    <option value="wallet">Wallet</option>
                    <option value="protection">Payment protection</option>
                    {data.pay_later && <option value="pay_later">Pay later (invoice)</option>}
                  </select>
                </label>
              )}
            </div>
          )}

          <DsCard noPadding testId="orders-table-card">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Orders table">
              <table className="ds-tbl min-w-[980px]" data-testid="merchant-store-orders-table">
                <thead>
                  <tr>
                    <th scope="col" className="w-10"><span className="sr-only">Select</span></th>
                    <th scope="col">Order</th>
                    <th scope="col">Items</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-[14px] text-[#5B6478] py-6" data-testid="orders-chip-empty">No orders here.</td></tr>
                  )}
                  {rows.map((r) => {
                    const st = statusLabel(r);
                    const pay = paymentLabel(r);
                    const act = rowAction(r);
                    const other = otherItemsText(r.other_items);
                    return (
                      <tr key={r.id} data-testid={`merchant-order-row-${r.order_number}`}>
                        <td>
                          {act === 'pay' && (
                            <input type="checkbox" className="w-4 h-4 accent-[#2A6FD1]" aria-label={`Select order ${orderName(r)}`}
                              checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
                          )}
                        </td>
                        <td>
                          <Link href={`/account/dropship/orders/${r.id}`} className="block font-mono font-bold text-[#2A6FD1] underline" data-testid={`order-link-${r.order_number}`}>{orderName(r)}</Link>
                          <span className="block text-[12px] text-[#5B6478]">{channelLabel(r)}{r.external_order_name ? ` · ${r.order_number}` : ''}</span>
                        </td>
                        <td>
                          <span className="block">{itemsSummary(r)}</span>
                          {other && <span className="block text-[12px] text-[#5B6478]" data-testid={`other-items-${r.order_number}`}>{other}</span>}
                        </td>
                        <td>{[r.buyer, r.destination_country].filter(Boolean).join(' · ')}</td>
                        <td className="font-mono whitespace-nowrap">{usd(r.total_cents)}</td>
                        <td><DsBadge tone={pay.tone} testId={`payment-${r.order_number}`}>{pay.label}</DsBadge></td>
                        <td><DsBadge tone={st.tone} testId={`status-${r.order_number}`}>{st.label}</DsBadge></td>
                        <td>
                          {act === 'pay' && (
                            <DsButton variant="secondary" disabled={!canStart || pending} disabledReason={!canStart ? 'Paused' : undefined}
                              onClick={() => charge([r.id])} testId={`pay-${r.order_number}`}>{`Pay ${usd(r.total_cents)}`}</DsButton>
                          )}
                          {act === 'review' && <DsButton variant="secondary" onClick={() => setReview(r)} testId={`review-${r.order_number}`}>Review</DsButton>}
                          {act === 'fix_address' && <DsButton variant="secondary" onClick={() => setFix(r)} testId={`fix-${r.order_number}`}>Fix address</DsButton>}
                          {act === 'track' && r.track_token && <DsLinkButton href={`/t/${r.track_token}`} variant="link" icon="truck">Track</DsLinkButton>}
                          {act === 'none' && <span className="text-[#5B6478]" aria-label="No action needed">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </DsCard>
          <OrderMessages rows={data.rows} expiryDays={data.expiry_days} available={data.wallet.available_cents} />
        </>
      )}

      {review && (
        <section className="ds-card border-[#F2C4C2]" aria-labelledby="review-title" data-testid="review-panel">
          <h2 id="review-title" className="m-0 text-[17px] font-bold text-[#1A174A] flex items-center gap-2">
            <span className="text-[#A8201A] inline-flex"><DsIcon name="stop" size={18} /></span>
            {`Order ${orderName(review)} is on hold: high risk`}
          </h2>
          <p className="mt-1.5 mb-3 text-[14px] text-[#1A174A]">Your store rated this order high risk. We have not charged your wallet or shipped it. Check it in your store, then choose.</p>
          <div className="flex flex-wrap gap-2.5">
            <DsButton icon="check" loading={pending} disabled={!canStart || pending || review.total_cents == null}
              disabledReason={!canStart ? pausedReason : review.total_cents == null ? 'Duties for this country are not known yet.' : undefined}
              onClick={() => charge([review.id])} testId="review-charge">{`Charge ${usd(review.total_cents)} and ship`}</DsButton>
            <DsButton variant="danger" icon="x" disabled={pending} onClick={() => setConfirmCancel(review)} testId="review-cancel">Cancel order</DsButton>
            <DsButton variant="link" onClick={() => setReview(null)}>Close</DsButton>
          </div>
        </section>
      )}

      {confirmCancel && (
        <DsDialog title={`Cancel order ${orderName(confirmCancel)}?`} testId="cancel-dialog"
          description={confirmCancel.payment_state === 'unpaid'
            ? 'Nothing was charged for this order. It goes back to your store as cancelled with Octopus.'
            : 'If packing hasn\u2019t started, the order is cancelled and the money goes back to your wallet.'}
          confirmLabel="Cancel order" cancelLabel="Keep order" onConfirm={() => cancel(confirmCancel)} onCancel={() => setConfirmCancel(null)} />
      )}

      {fix && <FixAddress row={fix} countryName={countryNames[fix.destination_country] ?? fix.destination_country} onClose={() => setFix(null)}
        onDone={(n) => { setNotice(n); setFix(null); router.refresh(); }} />}
    </div>
  );
}

/** States-Orders boards: waiting for payment, payment window ended, cancelled, protection released, address problem after packing. */
function OrderMessages({ rows, expiryDays, available }: { rows: OrderRow[]; expiryDays: number; available: number }) {
  const waiting = rows.filter((r) => rowAction(r) === 'pay' && r.last_charge_error === 'WALLET_INSUFFICIENT').slice(0, 1);
  const ended = rows.filter((r) => r.expired_at).slice(0, 1);
  const problems = rows.filter((r) => r.problem_code === 'address_after_packing' && !r.cancelled_at).slice(0, 1);
  const rejected = rows.filter((r) => r.cancel_state === 'rejected' && !r.cancelled_at).slice(0, 1);
  if (!waiting.length && !ended.length && !problems.length && !rejected.length) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="order-messages">
      {waiting.map((r) => (
        <DsNotice key={r.id} tone="warn" title={`Order ${orderName(r)} needs ${usd(r.total_cents)}`} testId="state-waiting"
          action={<DsLinkButton href="/account/dropship/wallet#add-funds" icon="plus">Add funds</DsLinkButton>}>
          {`Your wallet has ${usd(available)}. It waits ${expiryDays} days, then goes back to your store as unfulfilled.`}
        </DsNotice>
      ))}
      {ended.map((r) => (
        <DsNotice key={r.id} tone="info" title={`Order ${orderName(r)} went back to your store`} testId="state-ended">
          It wasn&rsquo;t paid in time, so Octopus didn&rsquo;t ship it. Fulfil it yourself or cancel it in your store.
        </DsNotice>
      ))}
      {problems.map((r) => (
        <DsNotice key={r.id} tone="warn" title={`Address change on ${orderName(r)} after the label`} testId="state-address-problem"
          action={<DsLinkButton href={`/account/dropship/orders/${r.id}`} variant="secondary" icon="help">Open order</DsLinkButton>}>
          The shipping label is already printed, so the address was not changed. Octopus support checks whether the parcel can still be redirected.
        </DsNotice>
      ))}
      {rejected.map((r) => (
        <DsNotice key={r.id} tone="info" title={`Order ${orderName(r)} can\u2019t be cancelled`} testId="state-cancel-rejected">
          {r.cancel_message ?? 'Packing has started.'}
        </DsNotice>
      ))}
    </div>
  );
}

function FixAddress({ row, countryName, onClose, onDone }: {
  row: OrderRow; countryName: string; onClose: () => void; onDone: (n: Notice) => void;
}) {
  const a = row.address ?? {};
  const [form, setForm] = useState({
    name: a.name ?? '', phone: a.phone ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', region: a.region ?? '', postcode: a.postcode ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await updateAddressAction(row.id, { ...form, country: row.destination_country });
      if (!r.ok) { setError(r.message); return; }
      onDone(r.data.applied
        ? { tone: 'ok', title: 'Address saved and resubmitted', text: `Order ${orderName(row)} is back in the queue.`, testId: 'orders-notice' }
        : { tone: 'warn', title: 'Address not changed', text: r.data.message, testId: 'orders-notice' });
    });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A174A]/40">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="fix-title" data-testid="fix-address-dialog"
        className="bg-white border border-[#E3E7EF] rounded-[12px] p-[18px] shadow-[0_12px_32px_rgba(26,23,74,0.16)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <h2 id="fix-title" className="m-0 mb-1 text-[17px] font-bold text-[#1A174A]">{`Fix the address for ${orderName(row)}`}</h2>
        {row.address_issue && <p className="m-0 mb-3 text-[13px] text-[#B42318]" data-testid="fix-issue">{row.address_issue}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <DsInput label="Buyer name" value={form.name} onChange={set('name')} autoFocus required containerClassName="sm:col-span-2" />
          <DsInput label="Street address" value={form.line1} onChange={set('line1')} required containerClassName="sm:col-span-2" />
          <DsInput label="Apartment, building (optional)" value={form.line2} onChange={set('line2')} containerClassName="sm:col-span-2" />
          <DsInput label="City" value={form.city} onChange={set('city')} required />
          <DsInput label="Region (optional)" value={form.region} onChange={set('region')} />
          <DsInput label="Postcode" value={form.postcode} onChange={set('postcode')} error={error && /postcode|zip/i.test(error) ? error : undefined} />
          <DsInput label="Phone (optional)" value={form.phone} onChange={set('phone')} inputMode="tel" />
          <p className="m-0 text-[13px] text-[#5B6478] sm:col-span-2">{`Country: ${countryName}. A different country changes the shipping price, so it can\u2019t be changed here.`}</p>
        </div>
        {error && !/postcode|zip/i.test(error) && <p role="alert" className="mt-3 mb-0 text-[13px] text-[#B42318]" data-testid="fix-error">{error}</p>}
        <div className="flex justify-end gap-2.5 mt-4 flex-wrap">
          <DsButton variant="secondary" onClick={onClose}>Close</DsButton>
          <DsButton type="submit" icon="check" loading={pending} disabled={pending} testId="fix-save">Save and resubmit</DsButton>
        </div>
      </form>
    </div>
  );
}
