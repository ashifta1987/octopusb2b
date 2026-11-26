'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsChip, DsEmptyState, DsLinkButton, DsNotice, DsPageHeader, DsRadioCard, DsSelect, DsTableCard,
} from '@/components/dropship-ui';
import { money } from '@/lib/format';
import type { PackingData } from '@/lib/dropship-ds6';
import { packingSaveAction, rateMappingAction } from '../ds6-actions';

const usd = (c: number | null | undefined) => (c == null ? 'Not set yet' : money(c, 'USD'));
const METHOD: Record<string, string> = { economy: 'Economy', standard: 'Standard', express: 'Express' };
const DUTY_NOTE: Record<string, string> = {
  US: 'Recommended: the duty-free allowance for small parcels is suspended',
  AE: 'Recommended',
};

export function PackingClient({ data, countryNames }: { data: PackingData; countryNames: Record<string, string> }) {
  const router = useRouter();
  const s = data.settings;
  const fees = data.fees;
  const [pack, setPack] = useState(s.default_packaging);
  const [brandedSku, setBrandedSku] = useState(s.branded_sku_id ?? data.own_stock[0]?.id ?? '');
  const [giftMessage, setGiftMessage] = useState(s.gift_message);
  const [slip, setSlip] = useState(s.packing_slip);
  const [method, setMethod] = useState(s.default_method);
  const [fallback, setFallback] = useState(s.fallback_method);
  const [duty, setDuty] = useState<Record<string, 'DDP' | 'DAP'>>(Object.fromEntries(data.markets.map((m) => [m.country, m.mode])));
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; title: string; text?: string } | null>(null);
  const hasStock = data.own_stock.length > 0;
  const brandedReason = fees?.branded_cents == null ? 'The branded packaging handling fee is not set yet.' : !hasStock ? 'You have no branded packaging stored at the Octopus warehouse.' : null;
  const insertReason = !hasStock ? 'Inserts come from your own stock at the warehouse; you have none stored yet.' : 'The handling fee for inserts is not set yet.';
  const tolerance = fees?.weigh_tolerance_g != null || fees?.weigh_tolerance_pct != null
    ? `within ${[fees?.weigh_tolerance_g != null ? `${fees.weigh_tolerance_g} g` : null, fees?.weigh_tolerance_pct != null ? `${fees.weigh_tolerance_pct}%` : null].filter(Boolean).join(' or ')} of the estimate`
    : null;
  const ex = data.example && data.example.ok ? data.example as unknown as { title: string; product_cents: number; processing_cents: number; shipping_cents: number; duties_cents: number | null; billed_weight_g: number; incoterm: string; total_cents: number | null } : null;

  function save() {
    setNotice(null);
    start(async () => {
      const r = await packingSaveAction({
        default_packaging: pack, branded_sku_id: pack === 'branded' ? brandedSku || null : null,
        insert_card: false, insert_card_sku_id: null, sticker: false, sticker_sku_id: null,
        gift_message: giftMessage, packing_slip: slip, insurance: false, signature: false,
        default_method: method, fallback_method: fallback, duty_modes: duty,
      });
      setNotice(r.ok ? { tone: 'ok', title: 'Changes saved', text: r.message } : { tone: 'bad', title: 'Not saved', text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ds6-packing">
      <DsPageHeader
        title="Packing and shipping"
        icon="package"
        subtitle="How your orders are packed, which shipping method each Shopify rate uses, and who pays duties. One place for all of it."
        actions={<DsButton icon="check" loading={pending} disabled={pending} onClick={save} testId="save-packing">Save changes</DsButton>}
      />
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="packing-notice">{notice.text}</DsNotice>}

      <DsTableCard title="What you pay per order" icon="dollar" testId="pay-per-order" minWidth={640}
        headers={['Line', 'How it is priced', ex ? `Example: 2 × ${ex.title}` : 'Example']}
        footer={fees ? `Fees from Octopus fee schedule version ${fees.version}.` : 'Octopus has not set its fees yet; prices show once they are set.'}>
        <tr><td>Product</td><td>Per unit, with volume tiers</td><td>{ex ? money(ex.product_cents, 'USD') : '—'}</td></tr>
        <tr><td><strong>Processing</strong></td><td>{fees ? `${money(fees.processing_first_cents, 'USD')} first item, ${money(fees.processing_extra_cents, 'USD')} each extra item; standard packaging included` : 'Not set yet'}</td><td>{ex ? money(ex.processing_cents, 'USD') : '—'}</td></tr>
        <tr><td>Packaging upgrade</td><td>Only if you choose one</td><td>{pack === 'branded' && fees?.branded_cents != null ? money(fees.branded_cents, 'USD') : money(0, 'USD')}</td></tr>
        <tr><td>Shipping</td><td>By country and method, on billed weight; one combined parcel per order</td><td>{ex ? `${money(ex.shipping_cents, 'USD')} (${ex.billed_weight_g} g billed)` : '—'}</td></tr>
        <tr><td>Duties and tax</td><td>Duties included (DDP): charged. Buyer pays (DAP): none</td><td>{ex ? (ex.incoterm === 'DAP' ? 'Paid by buyer' : ex.duties_cents == null ? 'Not known yet' : money(ex.duties_cents, 'USD')) : '—'}</td></tr>
        <tr><td><strong>Total</strong></td><td /><td><strong>{ex ? (ex.total_cents == null ? 'Not known yet' : money(ex.total_cents, 'USD')) : '—'}</strong></td></tr>
      </DsTableCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <DsCard title="Default packaging" icon="box" testId="default-packaging" subtitle="Fragile products always use protective packaging.">
          <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
            <legend className="sr-only">Default packaging</legend>
            <DsRadioCard name="pack" value="standard" checked={pack === 'standard'} onChange={() => setPack('standard')} title="Standard"
              description="Plain mailer or box picked by size. No Octopus or supplier marks." badge={<DsBadge tone="ok">Included in Processing</DsBadge>} />
            <DsRadioCard name="pack" value="protective" checked={pack === 'protective'} disabled onChange={() => setPack('protective')} title="Protective"
              description="Box with padding, for breakable or premium items. Can't be chosen until Octopus sets the fee." badge={<DsBadge tone="neutral">{`+ ${usd(fees?.protective_cents)} per order`}</DsBadge>} />
            <DsRadioCard name="pack" value="branded" checked={pack === 'branded'} disabled={Boolean(brandedReason)} onChange={() => setPack('branded')} title="My branded packaging"
              description={hasStock ? 'Your printed mailers, stored at the Octopus warehouse.' : 'You have no branded packaging stored at the Octopus warehouse. Make My Brand can print mailers and cards; they show here once they arrive at the warehouse.'}
              badge={<DsBadge tone="neutral">{`+ ${usd(fees?.branded_cents)} handling`}</DsBadge>} />
          </fieldset>
          {brandedReason && <p className="mt-2 mb-0 text-[12px] text-[#5B6478]" data-testid="branded-reason">{brandedReason}</p>}
          {pack === 'branded' && hasStock && (
            <DsSelect id="bsku" label="Which stored item is your mailer" value={brandedSku} onChange={(e) => setBrandedSku(e.target.value)} containerClassName="mt-3">
              {data.own_stock.map((k) => <option key={k.id} value={k.id}>{`${k.name} (${k.sku}) · ${k.available} in stock`}</option>)}
            </DsSelect>
          )}
          <DsLinkButton href="/account/brand" variant="link" icon="sparkle">{hasStock ? 'Order more from Make My Brand' : 'Ask Make My Brand for branded packaging'}</DsLinkButton>
        </DsCard>

        <DsCard title="Inside the parcel" icon="package" testId="inside-parcel">
          <DsCheckbox label="Thank-you card from my branded stock" disabled checked={false} onChange={() => {}} hint={insertReason} />
          <DsCheckbox label="Sticker on the parcel" disabled checked={false} onChange={() => {}} hint={insertReason} />
          <DsCheckbox label="Print the buyer's gift note when there is one" checked={giftMessage} onChange={(e) => setGiftMessage(e.target.checked)} />
          <span className="ds-label mt-2 block" id="slip-label">Packing slip</span>
          <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="slip-label">
            <DsChip pressed={slip === 'brand_no_prices'} onClick={() => setSlip('brand_no_prices')} testId="slip-brand">My brand, no prices</DsChip>
            <DsChip pressed={slip === 'none'} onClick={() => setSlip('none')} testId="slip-none">No packing slip</DsChip>
          </div>
          <p className="mt-2 mb-0 text-[12px] text-[#5B6478]">Inserts come from your branded stock at the warehouse. When it runs out, parcels ship without them and you get an alert.</p>
        </DsCard>

        <DsCard title="Extras" icon="shield" testId="extras">
          <DsCheckbox label={fees?.insurance_bp ? `Shipping insurance: ${fees.insurance_bp / 100}% of the declared value` : 'Shipping insurance'} disabled checked={false} onChange={() => {}}
            hint={fees?.insurance_bp ? 'Coming with orders.' : 'Not offered yet.'} />
          <DsCheckbox label="Signature on delivery, where the carrier offers it" disabled checked={false} onChange={() => {}} hint="The signature fee is not set yet." />
          <div className="mt-2">
            <strong className="text-[#1A174A] text-[14px]">Weighing rule</strong>
            <p className="mt-1 mb-0 text-[13px] text-[#1A174A]" data-testid="weighing-rule">
              {tolerance
                ? `Every parcel is weighed and measured after packing. If it is ${tolerance}, Octopus absorbs the difference. Above that, you get an adjustment with a photo and ${fees?.dispute_window_days ?? 7} days to dispute it.`
                : 'Every parcel is weighed and measured after packing. The tolerance Octopus absorbs is not set yet; it shows here once set.'}
            </p>
          </div>
        </DsCard>

        <DsCard title="Your Shopify shipping rates" icon="truck" testId="rate-mapping" subtitle="The buyer picks a rate at checkout. Choose which Octopus method ships it.">
          {!data.store ? (
            <DsNotice tone="info" title="Connect a store to map rates" testId="rates-connect-store"
              action={<DsLinkButton href="/account/dropship/stores" variant="secondary" icon="store">Stores</DsLinkButton>}>
              Your store&apos;s delivery rates are read from Shopify once a store is connected. Until then every order uses the default method below.
            </DsNotice>
          ) : data.rate_mappings.length === 0 ? (
            <DsEmptyState title="No rates read yet" description="Your store's delivery rates appear here after they are read from Shopify." icon="truck" />
          ) : (
            <table className="ds-tbl w-full">
              <thead><tr><th scope="col">Shopify rate</th><th scope="col">Countries</th><th scope="col">Ships with</th></tr></thead>
              <tbody>
                {data.rate_mappings.map((m) => (
                  <tr key={m.id}>
                    <td>{m.rate_name}{!m.method && <> <DsBadge tone="warn">New, not mapped</DsBadge></>}</td>
                    <td>{m.countries.map((c) => countryNames[c] ?? c).join(', ')}</td>
                    <td>
                      <select className="ds-input" aria-label={`Method for ${m.rate_name}`} value={m.method ?? ''}
                        onChange={(e) => start(async () => { const r = await rateMappingAction(m.id, (e.target.value || null) as 'economy' | 'standard' | 'express' | null); if (!r.ok) setNotice({ tone: 'bad', title: 'Not saved', text: r.message }); router.refresh(); })}>
                        <option value="">Choose a method</option><option value="economy">Economy</option><option value="standard">Standard</option><option value="express">Express</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            <DsSelect id="dm" label="Default method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} hint="Used for your prices and when no store rate is mapped.">
              {(['economy', 'standard', 'express'] as const).map((m) => {
                const d = data.methods.find((x) => x.method === m);
                return <option key={m} value={m}>{`${METHOD[m]}${d?.days_min != null ? ` · ${d.days_min}–${d.days_max} days` : ''}`}</option>;
              })}
            </DsSelect>
            <DsSelect id="fm" label="If a rate is not mapped" value={fallback} onChange={(e) => setFallback(e.target.value as typeof fallback)}>
              <option value="cheapest_on_time">Cheapest method that meets the delivery you promise</option>
              <option value="economy">Always Economy</option><option value="standard">Always Standard</option><option value="express">Always Express</option>
            </DsSelect>
          </div>
          <p className="mt-2 mb-0 text-[12px] text-[#5B6478]">So no order waits. Battery, liquid, magnet and powder items only use services that can carry them.</p>
        </DsCard>
      </div>

      <DsTableCard title="Who pays duties" icon="globe" testId="duties" subtitle="Your choice shows on every price in your import list and on your orders." headers={['Country', 'Duties', 'Note']} minWidth={560}>
        {data.markets.length === 0 ? (
          <tr><td colSpan={3}><DsEmptyState title="No selling countries yet" description="Choose your selling countries in Find products first." icon="globe" actionLabel="Find products" actionHref="/account/dropship/catalogue" /></td></tr>
        ) : data.markets.map((m) => (
          <tr key={m.country} data-testid={`duty-${m.country}`}>
            <td>{countryNames[m.country] ?? m.country}</td>
            <td>
              <select className="ds-input" aria-label={`Duties for ${countryNames[m.country] ?? m.country}`} value={duty[m.country]}
                onChange={(e) => setDuty((d) => ({ ...d, [m.country]: e.target.value as 'DDP' | 'DAP' }))}>
                <option value="DDP">Included (DDP)</option><option value="DAP">Buyer pays (DAP)</option>
              </select>
            </td>
            <td className="text-[13px] text-[#5B6478]">{DUTY_NOTE[m.country] ?? ''}{!m.saved ? `${DUTY_NOTE[m.country] ? ' · ' : ''}Default` : ''}</td>
          </tr>
        ))}
      </DsTableCard>
    </div>
  );
}
