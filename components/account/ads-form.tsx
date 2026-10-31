'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { money, asCurrency } from '@/lib/format';
import { createCampaign } from '@/app/account/ads/actions';

/** `min_cpc_cents` must already be converted to the platform `currency`. */
type Placement = { code: string; name: string; min_cpc_cents: number };

/**
 * Budget and bid are entered in the platform `currency`; the campaign's currency is set by a DB trigger
 * (set_campaign_currency) at creation, and clicks are charged from the wallet in that currency (SPEC §15.1).
 */
export function AdsCampaignForm({ placements, countries, disabled, walletCents, currency: cur }: {
  placements: Placement[];
  countries: Record<string, string>;
  disabled?: boolean;
  walletCents: number;
  currency: string;
}) {
  const currency = asCurrency(cur);
  const fmt = (n: number) => money(n, currency);
  const budgetMax = currency === 'CNY' ? 5000 : 500;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('/products');
  const [placement, setPlacement] = useState(placements[0]?.code ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const minCpc = placements.find((p) => p.code === placement)?.min_cpc_cents ?? 10;
  const [bidCents, setBidCents] = useState(Math.max(minCpc, placements[0]?.min_cpc_cents ?? 10));
  const [budgetUsd, setBudgetUsd] = useState(currency === 'CNY' ? 200 : 25);
  const bid = Math.max(bidCents, minCpc);

  const est = useMemo(() => {
    const max = Math.floor((budgetUsd * 100) / bid);
    return { lo: Math.max(0, Math.floor(max * 0.8)), hi: max };
  }, [budgetUsd, bid]);

  const countryList = Object.entries(countries).sort((a, b) => a[1].localeCompare(b[1]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDone(false);
    start(async () => {
      const r = await createCampaign({
        name, placement, headline, body, link, countries: picked,
        daily_budget: budgetUsd, max_cpc: (bid / 100).toFixed(2),
      });
      if (!r.ok) { setErr(r.error); return; }
      setDone(true);
      setName(''); setHeadline(''); setBody(''); setPicked([]);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]" aria-describedby={disabled ? 'ads-off' : undefined}>
      <fieldset disabled={disabled || pending} className="space-y-6 min-w-0">
        {/* 1 · Your ad */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">1 · Your ad</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ad-name" className="label">Campaign name</label>
              <input id="ad-name" className="input" required minLength={2} maxLength={80} placeholder="M10 bolts – winter push" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ad-link" className="label">Link</label>
              <input id="ad-link" className="input" required maxLength={500} placeholder="/products/… or https://…" value={link} onChange={(e) => setLink(e.target.value)} aria-describedby="ad-link-hint" />
              <p id="ad-link-hint" className="text-xs text-muted mt-1">A path on Octopus B2B (starting with /) or an https:// URL.</p>
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="ad-headline" className="label">Headline <span className="font-normal text-muted">· {headline.length} / 45</span></label>
            <input id="ad-headline" className="input" required minLength={3} maxLength={45} placeholder="M10 stainless bolts — bulk tier pricing" value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </div>
          <div className="mt-4">
            <label htmlFor="ad-body" className="label">Short line <span className="font-normal text-muted">· {body.length} / 80</span></label>
            <input id="ad-body" className="input" maxLength={80} placeholder="A2-70, DIN 933 · 1,000 pcs MOQ · ships in 15 days" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </section>

        {/* 2 · Where it shows */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">2 · Where it shows</h2>
          <fieldset>
            <legend className="sr-only">Placement</legend>
            {placements.length === 0 ? (
              <p className="text-sm text-muted">No ad placements are available right now.</p>
            ) : (
              <div className="space-y-3">
                {placements.map((p) => (
                  <label key={p.code} htmlFor={`pl-${p.code}`} className={cn('flex items-center gap-3 min-h-12 border rounded-[10px] px-4 cursor-pointer', placement === p.code ? 'border-blue bg-blue-soft/40' : 'border-line')}>
                    <input id={`pl-${p.code}`} type="radio" name="placement" className="w-[18px] h-[18px] accent-blue" checked={placement === p.code}
                      onChange={() => { setPlacement(p.code); setBidCents((b) => Math.max(b, p.min_cpc_cents)); }} />
                    <span className="flex-1 text-[15px]">{p.name}</span>
                    <span className="mono text-xs text-muted">min {fmt(p.min_cpc_cents)} / click</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="mt-5">
            <legend className="label">Buyer countries <span className="font-normal text-muted">· {picked.length ? `${picked.length} selected` : 'All countries'}</span></legend>
            <details className="border border-line-2 rounded-[8px]">
              <summary className="cursor-pointer px-3 py-2.5 text-[15px]">{picked.length ? picked.join(', ') : 'All countries (choose to narrow)'}</summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-3 max-h-64 overflow-y-auto border-t border-line">
                {countryList.map(([code, label]) => (
                  <label key={code} htmlFor={`ct-${code}`} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input id={`ct-${code}`} type="checkbox" className="accent-blue" checked={picked.includes(code)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, code] : picked.filter((x) => x !== code))} />
                    <span className="mono text-xs text-muted w-6">{code}</span>{label}
                  </label>
                ))}
              </div>
            </details>
            {picked.length > 0 && <button type="button" className="mt-2 text-sm underline text-blue" onClick={() => setPicked([])}>Clear — show in all countries</button>}
          </fieldset>
        </section>

        {/* 3 · Budget */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">3 · Budget</h2>
          <div>
            <label htmlFor="ad-bid" className="label">Your bid per click: <span className="mono">{fmt(bid)}</span></label>
            <div className="flex items-center gap-3">
              <input id="ad-bid" type="range" className="flex-1 accent-blue" min={minCpc} max={Math.max(minCpc * 10, currency === 'CNY' ? 3500 : 500)} step={1} value={bid}
                onChange={(e) => setBidCents(Number(e.target.value))} aria-valuetext={fmt(bid)} />
              <label htmlFor="ad-bid-n" className="sr-only">Bid per click in {currency}</label>
              <input id="ad-bid-n" type="number" className="input w-28 mono" min={(minCpc / 100).toFixed(2)} step="0.01" value={(bid / 100).toFixed(2)}
                onChange={(e) => setBidCents(Math.round(Number(e.target.value) * 100) || minCpc)} />
            </div>
            <p className="text-xs text-muted mt-1">Minimum {fmt(minCpc)} for this placement. Higher bids show first when several ads compete for a spot.</p>
          </div>
          <div className="mt-5">
            <label htmlFor="ad-budget" className="label">Daily budget: <span className="mono">{fmt(budgetUsd * 100)}</span></label>
            <div className="flex items-center gap-3">
              <input id="ad-budget" type="range" className="flex-1 accent-blue" min={5} max={budgetMax} step={1} value={Math.min(budgetUsd, budgetMax)}
                onChange={(e) => setBudgetUsd(Number(e.target.value))} aria-valuetext={fmt(budgetUsd * 100)} />
              <label htmlFor="ad-budget-n" className="sr-only">Daily budget in {currency}</label>
              <input id="ad-budget-n" type="number" className="input w-28 mono" min={1} step="1" value={budgetUsd}
                onChange={(e) => setBudgetUsd(Math.max(1, Math.round(Number(e.target.value)) || 1))} />
            </div>
          </div>
        </section>
      </fieldset>

      {/* Right: preview + estimate */}
      <div className="space-y-6 lg:stick">
        <section className="card p-5" aria-label="Ad preview">
          <div className="text-sm font-semibold mb-3">Preview</div>
          <div className="border border-line rounded-[12px] p-4 flex gap-3 items-start">
            <span className="mono text-[9px] font-semibold tracking-wider uppercase bg-surface border border-line rounded px-1.5 py-0.5 text-muted shrink-0">Sponsored</span>
            <div className="ph w-12 h-12 rounded-[8px] shrink-0" aria-hidden>Img</div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] break-words">{headline || 'Your headline'}</div>
              <div className="text-xs text-muted mt-0.5 break-words">{body || 'Your short line'}</div>
              <div className="text-xs text-blue mt-1 truncate">{link || '/'}</div>
            </div>
          </div>
          <p className="text-xs text-muted mt-3">Ads are always labelled “Sponsored”. Every ad is reviewed before it goes live.</p>
        </section>

        <section className="card p-5" aria-label="Estimate">
          <div className="text-sm font-semibold mb-3">Estimate</div>
          <dl className="space-y-2 text-[15px]">
            <div className="flex justify-between"><dt className="text-muted">Clicks per day</dt><dd className="mono font-semibold">≈ {est.lo}–{est.hi}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Max spend per day</dt><dd className="mono font-semibold">{fmt(budgetUsd * 100)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Max spend per month</dt><dd className="mono font-semibold">{fmt(budgetUsd * 100 * 30)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Wallet balance</dt><dd className="mono">{fmt(walletCents)}</dd></div>
          </dl>
          <p className="text-xs text-muted mt-3">Paid from your wallet per valid click. Repeated, bot and own clicks are not charged. Monthly invoice in Ledger &amp; invoices.</p>
          {walletCents < bid && <p className="text-xs text-bad mt-2">Your wallet balance is below one click. <a href="/account/wallet" className="underline">Top up</a> so the ad can run once approved.</p>}
          {err && <p className="text-sm text-bad mt-3" role="alert">{err}</p>}
          {done && <p className="text-sm text-ok mt-3" role="status">Submitted for approval. We’ll notify you when it goes live.</p>}
          <button type="submit" className="btn btn-primary w-full mt-4" disabled={disabled || pending || !placements.length}>{pending ? 'Submitting…' : 'Submit for approval'}</button>
        </section>
      </div>
    </form>
  );
}
