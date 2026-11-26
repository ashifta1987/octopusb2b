'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsLinkButton, DsNotice, DsRadioCard, DsSwitch } from '@/components/dropship-ui';
import type { PaymentOption, WalletDsData } from '@/lib/dropship-orders';
import { usd } from '@/lib/dropship-orders-shared';
import { saveOrderSettingsAction } from '../ds8-actions';

/**
 * Release 3 · Step 8 — the Dropship part of the Wallet (screens/Wallet.html): Available + Held for protected orders, and
 * "How new orders are paid". The Pay later card is rendered ONLY when data.pay_later is not null (credit_eligible orgs).
 */
export function DsWalletPanel({ data }: { data: WalletDsData }) {
  const router = useRouter();
  const [mode, setMode] = useState<PaymentOption>(data.settings.payment_mode);
  const [auto, setAuto] = useState(data.settings.auto_pay);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; title: string; text?: string } | null>(null);
  const [pending, start] = useTransition();
  const paused = data.dropship_status !== 'on';
  const low = data.waiting_orders > 0 && data.waiting_cents > data.available_cents;
  const dirty = mode !== data.settings.payment_mode || auto !== data.settings.auto_pay;

  function save() {
    setNotice(null);
    start(async () => {
      const r = await saveOrderSettingsAction(mode, auto);
      setNotice(r.ok ? { tone: 'ok', title: 'Saved', text: 'New orders are paid this way from now on.' } : { tone: 'bad', title: 'Not saved', text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="ds-v2 flex flex-col gap-5 mb-6" data-testid="ds-wallet-panel">
      <div className="grid gap-5 sm:grid-cols-2">
        <DsCard testId="ds-available">
          <p className="m-0 text-[13px] text-muted">Available</p>
          <p className="m-0 text-[28px] font-bold text-ink">{usd(data.available_cents)}</p>
          {low ? (
            <DsBadge tone="warn" testId="ds-low">{`Low: ${data.waiting_orders} order${data.waiting_orders === 1 ? '' : 's'} waiting for payment`}</DsBadge>
          ) : data.waiting_orders > 0 ? (
            <p className="m-0 text-[13px] text-muted">{`${data.waiting_orders} order${data.waiting_orders === 1 ? '' : 's'} waiting; paid oldest first.`}</p>
          ) : null}
        </DsCard>
        <DsCard testId="ds-held">
          <p className="m-0 text-[13px] text-muted">Held for protected orders</p>
          <p className="m-0 text-[28px] font-bold text-ink">{usd(data.held_cents)}</p>
          <p className="m-0 text-[13px] text-muted">
            {data.held_orders ? `${data.held_orders} order${data.held_orders === 1 ? '' : 's'} · released ${data.protection_days} days after delivery` : `Nothing held. Protected orders are released ${data.protection_days} days after delivery.`}
          </p>
        </DsCard>
      </div>

      <DsCard title="How new orders are paid" icon="card" testId="ds-payment-mode"
        subtitle="Applies to every new order. You can change it for a single order on the Orders page.">
        {notice && <div className="mb-3"><DsNotice tone={notice.tone} title={notice.title} testId="ds-payment-notice">{notice.text}</DsNotice></div>}
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className="ds-label">Payment method for new orders</legend>
          <DsRadioCard name="ds-pay" value="wallet" checked={mode === 'wallet'} onChange={() => setMode('wallet')} disabled={paused}
            title="Wallet, automatically" badge={<DsBadge tone="ok">Recommended</DsBadge>}
            description={`Paid the moment the order arrives. If the balance is too low, the order waits as Awaiting payment for ${data.expiry_days} days.`} />
          <DsRadioCard name="ds-pay" value="protection" checked={mode === 'protection'} onChange={() => setMode('protection')} disabled={paused || !data.protection_enabled}
            title="Payment protection"
            description={data.protection_enabled
              ? `Paid from the wallet but held until ${data.protection_days} days after delivery. If something goes wrong, open a dispute before release.`
              : 'Switched off by Octopus at the moment.'} />
          {data.pay_later !== null && (
            <DsRadioCard name="ds-pay" value="pay_later" checked={mode === 'pay_later'} onChange={() => setMode('pay_later')} disabled={paused || !data.pay_later}
              title="Pay later (invoice)"
              description={data.pay_later ? 'Charged to your company\u2019s credit terms; the OCT-DS invoice is due in your net days.' : 'Your company has no active credit terms right now, or an invoice is overdue.'} />
          )}
        </fieldset>
        <div className="mt-3">
          <DsSwitch checked={auto} onChange={setAuto} disabled={paused} testId="ds-auto-pay" label="Charge new orders automatically"
            hint="Off: new orders wait in To pay until you choose Charge and ship." disabledReason={paused ? 'Dropshipping is paused, so settings can\u2019t change.' : undefined} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <DsButton icon="check" loading={pending} disabled={paused || pending || !dirty} testId="ds-save-payment"
            disabledReason={paused ? 'Dropshipping is paused, so settings can\u2019t change.' : !dirty ? 'No changes to save.' : undefined} onClick={save}>Save</DsButton>
          <DsLinkButton href="/account/dropship/orders" variant="link" icon="arrow">Orders</DsLinkButton>
        </div>
      </DsCard>

      <DsNotice tone="info" title="Online payment: available soon" testId="ds-online-soon">
        Use bank transfer for now (below). Waiting orders are paid oldest first as soon as Finance credits the transfer.
      </DsNotice>
    </div>
  );
}
