'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsSelect, DsTableCard,
} from '@/components/dropship-ui';
import { money } from '@/lib/format';
import {
  bandsProblem, computePrice, multiplierText, parseMultiplier, pct, storeMoney, type PriceBand, type Rounding,
} from '@/lib/dropship-pricing';
import type { PricingData } from '@/lib/dropship-ds6';
import { priceApprovalAction, pricingSaveAction } from '../ds6-actions';
import { fmtWhen, optionText } from '../ds6-ui';

type BandRow = { from: string; to: string; mult: string; fixed: string };

const usdIn = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
const usdParse = (s: string): number | null => {
  const m = s.replace(/^\s*(?:US\$|\$)\s*/i, '').replace(/,/g, '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
};
const pctParse = (s: string): number | null => {
  const m = s.replace('%', '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : null;
};

export function PricingClient({ data, countryNames }: { data: PricingData; countryNames: Record<string, string> }) {
  const router = useRouter();
  const r = data.rules;
  const [bands, setBands] = useState<BandRow[]>(() => (r.bands.length ? r.bands : [{ from_cents: 0, to_cents: null, multiplier_milli: 2000, fixed_cents: 0 }])
    .map((b) => ({ from: usdIn(b.from_cents), to: usdIn(b.to_cents), mult: multiplierText(b.multiplier_milli), fixed: usdIn(b.fixed_cents) })));
  const [rounding, setRounding] = useState<Rounding>(r.rounding);
  const [compare, setCompare] = useState<string>(r.compare_at_bp ? String(r.compare_at_bp) : '');
  const [minPct, setMinPct] = useState(String(r.min_profit_bp / 100));
  const [currency, setCurrency] = useState(data.currency);
  const [threshold, setThreshold] = useState(r.fx_threshold_bp != null ? String(r.fx_threshold_bp / 100) : '');
  const [market, setMarket] = useState(r.main_market ?? data.market ?? '');
  const [up, setUp] = useState(r.when_landed_up);
  const [down, setDown] = useState(r.when_landed_down);
  const [oos, setOos] = useState(r.when_out_of_stock);
  const [every, setEvery] = useState(String(r.check_every_hours));
  const [lowAlert, setLowAlert] = useState(r.alert_low_stock);
  const [email, setEmail] = useState(r.email_alerts);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; title: string; text?: string } | null>(null);

  const parsed: PriceBand[] = bands.map((b, i) => ({
    from_cents: usdParse(b.from) ?? NaN,
    to_cents: i === bands.length - 1 ? null : usdParse(b.to) ?? NaN,
    multiplier_milli: parseMultiplier(b.mult) ?? NaN,
    fixed_cents: b.fixed.trim() === '' ? 0 : usdParse(b.fixed) ?? NaN,
  }));
  const bandErr = bandsProblem(parsed);
  const minBp = pctParse(minPct);
  const minErr = minBp == null || minBp > 9000 ? 'Enter a minimum margin between 0% and 90%.' : null;
  const thrBp = threshold.trim() === '' ? null : pctParse(threshold);
  const thrErr = currency !== 'USD' && (thrBp == null || thrBp > 5000) ? 'Enter when to reprice (0% to 50%) after the exchange rate moves.' : null;
  const fx = data.fx_rates[currency] ?? null;
  const fxText = currency === 'USD' ? null : fx && fx.source_name ? `1 USD = ${fx.rate} ${currency}` : null;
  const landed = data.sample?.landed && data.sample.landed.ok ? data.sample.landed.landed_usd_cents : null;
  const preview = !bandErr && landed != null ? computePrice(landed, { bands: parsed, rounding, compare_at_bp: compare ? (Number(compare) as 2500 | 5000) : null, min_profit_bp: minBp ?? 0 }, fx?.rate != null ? String(fx.rate) : null, currency) : null;
  const sampleBand = preview && preview.ok ? parsed[preview.band - 1] : null;
  const marketName = market ? countryNames[market] ?? market : null;

  function save() {
    setNotice(null);
    start(async () => {
      const res = await pricingSaveAction({
        bands: parsed, rounding, compare_at_bp: compare ? (Number(compare) as 2500 | 5000) : null, min_profit_bp: minBp ?? 0,
        store_currency: currency, fx_threshold_bp: thrBp, main_market: market || null,
        when_landed_up: up, when_landed_down: down, when_out_of_stock: oos, check_every_hours: Number(every) as 1 | 3 | 6 | 24,
        alert_low_stock: lowAlert, email_alerts: email,
      });
      setNotice(res.ok ? { tone: 'ok', title: 'Rules saved', text: res.message } : { tone: 'bad', title: 'Not saved', text: res.message });
      if (res.ok) router.refresh();
    });
  }

  const setBand = (i: number, k: keyof BandRow, v: string) => setBands((s) => s.map((b, j) => {
    if (j === i) return { ...b, [k]: v };
    if (k === 'to' && j === i + 1) return { ...b, from: v }; // the next band starts where this one ends
    return b;
  }));

  return (
    <div className="flex flex-col gap-5" data-testid="ds6-pricing">
      <DsPageHeader
        title="Pricing and sync"
        icon="tag"
        subtitle="Set your margin once. Cost, stock and exchange-rate changes follow your rules."
        actions={
          <>
            <DsButton variant="secondary" icon="refresh" disabled disabledReason="Automatic sync starts with the sync engine; your products are priced with these rules when you push." testId="sync-now">Sync now</DsButton>
            <DsButton icon="check" loading={pending} disabled={pending || Boolean(bandErr || minErr || thrErr)} disabledReason={bandErr ?? minErr ?? thrErr ?? undefined} onClick={save} testId="save-rules">Save rules</DsButton>
          </>
        }
      />
      {!r.saved && <DsNotice tone="info" title="Your pricing rule is not saved yet" testId="rules-not-saved">The form starts from the suggested markup. Save it before you push; products can&apos;t be pushed without a saved rule or your own prices.</DsNotice>}
      {notice && <DsNotice tone={notice.tone} title={notice.title} testId="pricing-notice">{notice.text}</DsNotice>}

      <DsTableCard title="Pricing rule: cost bands" icon="layers" testId="bands" minWidth={620}
        actions={<DsButton variant="secondary" icon="plus" disabled={bands.length >= 10} disabledReason={bands.length >= 10 ? 'Up to 10 bands.' : undefined}
          onClick={() => setBands((s) => { const last = s[s.length - 1]; const begin = usdParse(last.from) ?? 0; const split = usdIn(begin + 1000); return [...s.slice(0, -1), { ...last, to: split }, { from: split, to: '', mult: last.mult, fixed: '0.00' }]; })} testId="add-band">Add band</DsButton>}
        headers={['Landed cost from', 'To', 'Multiplier', 'Fixed amount', '']}
        footer={
          <span className="flex flex-wrap items-center gap-2">
            <span>Landed cost = product + processing + shipping + duties (if DDP), to your main market:</span>
            <select aria-label="Main market" className="ds-input !w-auto !min-h-[36px]" value={market} onChange={(e) => setMarket(e.target.value)} data-testid="main-market">
              {data.markets.length === 0 && <option value="">No selling countries yet</option>}
              {data.markets.map((c) => <option key={c} value={c}>{countryNames[c] ?? c}</option>)}
            </select>
          </span>
        }>
        {bands.map((b, i) => (
          <tr key={i} data-testid={`band-${i + 1}`}>
            <td><input className="ds-input w-[120px]" aria-label={`Band ${i + 1} from (US$)`} value={b.from} disabled={i > 0} onChange={(e) => setBand(i, 'from', e.target.value)} /></td>
            <td>{i === bands.length - 1 ? 'and up' : <input className="ds-input w-[120px]" aria-label={`Band ${i + 1} to (US$)`} value={b.to} onChange={(e) => setBand(i, 'to', e.target.value)} />}</td>
            <td><input className="ds-input w-[90px]" aria-label={`Band ${i + 1} multiplier`} inputMode="decimal" value={b.mult} onChange={(e) => setBand(i, 'mult', e.target.value)} /></td>
            <td><input className="ds-input w-[110px]" aria-label={`Band ${i + 1} fixed amount (US$)`} inputMode="decimal" value={b.fixed} onChange={(e) => setBand(i, 'fixed', e.target.value)} /></td>
            <td>{bands.length > 1 && <DsButton variant="link" icon="x" aria-label={`Remove band ${i + 1}`}
              onClick={() => setBands((s) => { const n = s.filter((_, j) => j !== i); if (n.length) { n[0] = { ...n[0], from: '0.00' }; for (let k = 1; k < n.length; k++) n[k] = { ...n[k], from: n[k - 1].to }; n[n.length - 1] = { ...n[n.length - 1], to: '' }; } return n; })}>Remove</DsButton>}</td>
          </tr>
        ))}
      </DsTableCard>
      {bandErr && <DsNotice tone="warn" title="Check the bands" testId="band-error">{bandErr}</DsNotice>}

      <div className="grid gap-5 lg:grid-cols-2">
        <DsCard title="Rounding, compare-at and minimum" icon="percent" testId="rounding">
          <div className="flex flex-col gap-3">
            <DsSelect id="rr" label="Round prices" value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)}>
              <option value="end_99">End in .99</option><option value="end_95">End in .95</option><option value="whole">Whole number</option><option value="none">No rounding</option>
            </DsSelect>
            <DsSelect id="rc" label="Compare-at price" value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="2500">Price + 25%</option><option value="5000">Price + 50%</option><option value="">Don&apos;t set</option>
            </DsSelect>
            <DsInput id="rm" label="Minimum margin (%)" inputMode="decimal" value={minPct} onChange={(e) => setMinPct(e.target.value)} error={minErr ?? undefined}
              hint="Prices below it are never pushed without your confirmation." />
          </div>
        </DsCard>

        <DsCard title="Currency" icon="globe" testId="currency">
          <div className="flex flex-col gap-3">
            <DsSelect id="fc" label="Store currency" value={currency} disabled={data.currency_from_store} onChange={(e) => setCurrency(e.target.value)}
              hint={data.currency_from_store ? 'From your Shopify store.' : 'Once a store is connected, this follows the store\u2019s currency.'}>
              {data.supported_currencies.map((c) => <option key={c} value={c}>{c === data.currency && data.currency_from_store ? `${c} (from Shopify)` : c}</option>)}
            </DsSelect>
            <div>
              <span className="ds-label" id="fr-label">Exchange rate</span>
              <p className="m-0 text-[14px] text-[#1A174A]" aria-labelledby="fr-label" data-testid="fx-rate">
                {currency === 'USD' ? 'Not needed: prices are in US$.' : fxText ?? `No exchange rate for ${currency} yet. Products can't be priced in ${currency} until Octopus adds one.`}
              </p>
              {currency !== 'USD' && fx?.source_name && <p className="mt-1 mb-0 text-[12px] text-[#5B6478]" data-testid="fx-source">{`Source: ${fx.source_name} · updated ${fmtWhen(fx.effective_from)}`}</p>}
            </div>
            <DsInput id="ft" label="Reprice when the rate moves more than (%)" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)}
              error={thrErr ?? undefined} hint={currency === 'USD' ? 'Only needed for a store currency other than US$.' : undefined} />
          </div>
        </DsCard>
      </div>

      <DsCard title="Preview" icon="eye" testId="pricing-preview">
        {!data.sample ? (
          <p className="m-0 text-[14px] text-[#5B6478]">Add a product to your import list to see a preview with its real landed cost.</p>
        ) : !data.sample.landed || !data.sample.landed.ok ? (
          <p className="m-0 text-[14px] text-[#5B6478]">{`${data.sample.title}: ${data.sample.landed && !data.sample.landed.ok ? data.sample.landed.message : 'no landed cost yet.'}`}</p>
        ) : !preview || !preview.ok ? (
          <p className="m-0 text-[14px] text-[#5B6478]">{preview && !preview.ok ? preview.message : bandErr}</p>
        ) : (
          <div data-testid="preview-rows">
            <div className="ds-row"><span className="ds-mut">Landed cost</span><span>{money(landed, 'USD')}</span></div>
            {sampleBand && <div className="ds-row"><span className="ds-mut">Band</span><span>{`${money(sampleBand.from_cents, 'USD')}${sampleBand.to_cents != null ? `–${money(sampleBand.to_cents, 'USD')}` : ' and up'} → × ${multiplierText(sampleBand.multiplier_milli)}${sampleBand.fixed_cents ? ` + ${money(sampleBand.fixed_cents, 'USD')}` : ''}`}</span></div>}
            {currency !== 'USD' && <div className="ds-row"><span className="ds-mut">{`In ${currency}`}</span><span>{`× ${fx?.rate}`}</span></div>}
            <div className="ds-row"><span className="ds-mut">Rounded</span><span data-testid="preview-price">{storeMoney(preview.price_minor, currency)}</span></div>
            <div className="ds-row"><span className="ds-mut">Compare-at</span><span>{preview.compare_at_minor != null ? storeMoney(preview.compare_at_minor, currency) : 'Not set'}</span></div>
            <div className="ds-row"><span className="ds-mut">Margin</span><span>{preview.below_min ? <DsBadge tone="warn">{`${pct(preview.profit_bp)} · below your minimum`}</DsBadge> : pct(preview.profit_bp)}</span></div>
            <p className="mt-2 mb-0 text-[12px] text-[#5B6478]">{`${data.sample.title}, ${optionText(data.sample.options)}, to ${countryNames[data.sample.landed.country] ?? data.sample.landed.country} (${data.sample.landed.incoterm === 'DAP' ? 'buyer pays duties' : 'duties included'}).`}</p>
          </div>
        )}
      </DsCard>

      <DsCard title="When things change" icon="refresh" testId="when-change" subtitle="Saved now; the automatic sync that follows these choices starts with the sync engine.">
        <div className="grid gap-3 sm:grid-cols-2">
          <DsSelect id="s1" label="When Octopus cost goes up" value={up} onChange={(e) => setUp(e.target.value as typeof up)}>
            <option value="reprice">Update my price with the rule</option><option value="ask">Ask me first</option><option value="alert">Only alert me</option>
          </DsSelect>
          <DsSelect id="s2" label="When cost goes down" value={down} onChange={(e) => setDown(e.target.value as typeof down)}>
            <option value="keep">Keep my price</option><option value="reprice">Update my price with the rule</option>
          </DsSelect>
          <DsSelect id="s3" label="When out of stock" value={oos} onChange={(e) => setOos(e.target.value as typeof oos)}>
            <option value="draft">Set product to draft</option><option value="sold_out">Show as sold out</option><option value="nothing">Do nothing</option>
          </DsSelect>
          <DsSelect id="s4" label="Check stock and cost every" value={every} onChange={(e) => setEvery(e.target.value)}>
            <option value="1">1 hour</option><option value="3">3 hours</option><option value="6">6 hours</option><option value="24">24 hours</option>
          </DsSelect>
        </div>
        <DsCheckbox label="Alert me when a product goes to Low stock" checked={lowAlert} onChange={(e) => setLowAlert(e.target.checked)} />
        <DsCheckbox label="Alert me by email about price changes (when app email is live)" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        <p className="m-0 text-[12px] text-[#5B6478]">{`Rules never price below your minimum margin of ${pct(minBp)}${marketName ? ` (landed to ${marketName})` : ''}; a change that would needs your approval.`}</p>
      </DsCard>

      <DsTableCard title={`Waiting for your approval (${data.approvals.length})`} icon="clock" testId="approvals" headers={['Product', 'Change', 'New price', 'Margin', '']} minWidth={720}>
        {data.approvals.length === 0 ? (
          <tr><td colSpan={5}><DsEmptyState title="Nothing waiting" description="Price changes that need your OK appear here once your products are in a store." icon="check" /></td></tr>
        ) : data.approvals.map((a) => (
          <tr key={a.id} data-testid={`approval-${a.model_no}`}>
            <td>{`${a.title} · ${a.model_no}`}</td>
            <td>{`Landed cost ${money(a.old_landed_usd_cents, 'USD')} → ${money(a.new_landed_usd_cents, 'USD')}`}</td>
            <td>{`${storeMoney(a.old_price_minor, a.currency)} → ${storeMoney(a.new_price_minor, a.currency)}`}</td>
            <td><DsBadge tone={(a.new_profit_bp ?? 0) >= r.min_profit_bp ? 'ok' : 'warn'}>{`${pct(a.old_profit_bp)} → ${pct(a.new_profit_bp)}`}</DsBadge></td>
            <td className="whitespace-nowrap">
              <DsButton disabled={pending} onClick={() => start(async () => { const x = await priceApprovalAction(a.id, 'approve'); setNotice(x.ok ? { tone: 'ok', title: 'Approved' } : { tone: 'bad', title: 'Not approved', text: x.message }); router.refresh(); })}>Approve</DsButton>{' '}
              <DsButton variant="secondary" disabled={pending} onClick={() => start(async () => { const x = await priceApprovalAction(a.id, 'keep_old'); setNotice(x.ok ? { tone: 'ok', title: 'Old price kept' } : { tone: 'bad', title: 'Not saved', text: x.message }); router.refresh(); })}>Keep old price</DsButton>
            </td>
          </tr>
        ))}
      </DsTableCard>

      <DsTableCard title="Sync log" icon="activity" testId="sync-log" headers={['Time', 'Product', 'Change', 'Result']} minWidth={620}>
        {data.sync_log.length === 0 ? (
          <tr><td colSpan={4}><DsEmptyState title="No sync activity yet" description="Pushes, price and stock updates are listed here once a store is connected." icon="activity" /></td></tr>
        ) : data.sync_log.map((l, i) => (
          <tr key={i}><td>{fmtWhen(l.created_at)}</td><td>{l.product}</td><td>{l.change}</td><td>{l.result}</td></tr>
        ))}
      </DsTableCard>
    </div>
  );
}
