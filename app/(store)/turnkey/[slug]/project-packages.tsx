'use client';
import Link from 'next/link';
import { useState } from 'react';
import { COUNTRY_OPTIONS } from '@/components/store/request-schema';
import { equipmentTotal, paybackLabel, rangeLabel, usd, type TurnkeyPackage, type TurnkeyProject } from '@/lib/turnkey/format';
import { COVERED } from '@/components/store/turnkey/ui';

const QUICK_COUNTRIES = ['AE', 'SA', 'NG', 'KE', 'PK'];

/** Package tabs (Starter · Standard · Pro / capacity options) + equipment + earnings + right rail / sticky mobile bar. */
export function ProjectPackages({ project: p, packages, live, threshold, whatsapp = null }: { project: TurnkeyProject; packages: TurnkeyPackage[]; live: boolean; threshold: number; whatsapp?: string | null }) {
  const initial = packages.find((k) => k.tier_rank === 2) ?? packages[0];
  const [sel, setSel] = useState<string | undefined>(initial?.package_id);
  const k = packages.find((x) => x.package_id === sel) ?? initial;
  const formHref = (extra = '') => `/turnkey/${p.project_id}/${live ? 'request' : 'interest'}?package=${k?.package_id ?? ''}${extra}`;
  const cta = live ? 'Request this package →' : 'Register interest →';
  const total = k ? equipmentTotal(k) : 0;
  const earnCards = k && (k.monthly_revenue_low != null || k.payback_months_low != null || k.capacity_label)
    ? [
      { label: 'Capacity', value: k.capacity_label ?? '—', note: 'At the usage levels this tier is designed for.' },
      { label: 'Monthly revenue', value: rangeLabel(k.monthly_revenue_low, k.monthly_revenue_high, (n) => usd(n)!) ?? 'Shared with your quote', note: 'Rough range from comparable installs in the Gulf, Africa and South Asia.' },
      { label: 'Payback', value: paybackLabel(k) ?? 'Shared with your quote', note: 'Excludes rent and civil works; depends on footfall and rent.' },
    ]
    : p.earn;
  const isAsset = p.earn[0]?.label === 'Revenue model';

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] pb-28 lg:pb-8">
      <div className="min-w-0">
        {packages.length > 0 && (
          <div role="tablist" aria-label={live ? 'Packages' : 'Capacity options'} className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            {packages.map((t) => {
              const active = t.package_id === k?.package_id;
              return (
                <button key={t.package_id} role="tab" type="button" aria-selected={active} aria-controls="tk-panel" id={`tab-${t.tier_rank}`} data-testid="tier-tab"
                  onClick={() => setSel(t.package_id)}
                  className={`flex-1 min-w-[180px] text-left px-4 sm:px-5 py-3.5 rounded-t-[12px] border border-b-0 ${active ? 'bg-white border-line' : 'bg-pearl border-line text-muted hover:text-ink'}`}>
                  <div className="mono text-[10.5px] uppercase tracking-[.06em] text-muted truncate">{t.tier_label ?? t.tier_name}</div>
                  <div className={`font-display font-extrabold text-[22px] mt-1 ${active ? 'text-coral-text' : 'text-ink'}`}>{usd(t.starting_budget_usd) ?? '—'}</div>
                  <div className="text-[12.5px] text-muted truncate">{[t.items_count ? `${t.items_count} items` : null, t.space_label, t.lead_time_days ? `${t.lead_time_days} days` : null].filter(Boolean).join(' · ')}</div>
                </button>
              );
            })}
          </div>
        )}
        {k && (
          <div id="tk-panel" role="tabpanel" aria-labelledby={`tab-${k.tier_rank}`} className="bg-white border border-line rounded-b-[14px] rounded-tr-[14px] p-4 sm:p-6" data-testid="tier-panel">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {[['Capacity', k.capacity_label], ['Space', k.space_label], ['Lead time', k.lead_time_days ? `${k.lead_time_days} days` : null], ['Container', k.container_label]].map(([l, v]) => (
                <div key={l} className="rounded-[10px] bg-pearl px-3 py-2.5"><dt className="mono text-[10px] uppercase text-muted">{l}</dt><dd className="font-semibold text-ink text-[14px]">{v ?? '—'}</dd></div>
              ))}
            </dl>
            {k.equipment.length > 0 ? (
              <>
                <div className="mono text-[11px] uppercase tracking-[.06em] text-coral-text font-semibold mt-6 mb-1">Equipment included · {k.equipment.length} items</div>
                <ul data-testid="equipment-list">
                  {k.equipment.map((e) => (
                    <li key={e.line_id} className="grid grid-cols-[44px_1fr_auto] sm:grid-cols-[48px_1fr_80px_100px] gap-3 py-3.5 border-b border-line last:border-0 items-center">
                      <span aria-hidden className="w-11 h-11 sm:w-12 sm:h-12 rounded-[10px] flex items-center justify-center mono text-[10px] text-muted text-center p-1" style={{ background: 'repeating-linear-gradient(135deg,var(--fill) 0 8px,var(--line) 8px 16px)' }}>{e.group_label}</span>
                      <div className="min-w-0"><div className="font-semibold text-ink text-[15px]">{e.name}</div>{e.spec_md && <div className="text-[13px] text-muted">{e.spec_md}</div>}</div>
                      <span className="hidden sm:block mono text-[12px] text-muted text-right">{e.unit ?? `× ${e.quantity}`}</span>
                      <span className="font-semibold text-ink text-right">{usd(e.budget_usd) ?? '—'}<span className="sm:hidden block mono text-[11px] text-muted font-normal">{e.unit ?? `× ${e.quantity}`}</span></span>
                    </li>
                  ))}
                </ul>
                <div className="border-t-2 border-ink mt-2 pt-3 flex flex-wrap justify-between gap-2 items-end">
                  <div><div className="mono text-[10.5px] uppercase text-muted">Package total · FOB Shenzhen / nearest port</div><div className="text-[13px] text-muted">+ consolidation, QC and door shipping quoted separately</div></div>
                  <div className="font-display font-extrabold text-[22px] text-ink">{usd(k.starting_budget_usd ?? total)}</div>
                </div>
              </>
            ) : (
              <p className="mt-6 rounded-[10px] bg-pearl p-4 text-[14px] text-muted" data-testid="equipment-on-request">
                {k.items_count ? `${k.items_count} items. ` : ''}The itemised equipment list for the {k.tier_name} tier is prepared with your quote — budget {usd(k.starting_budget_usd)} FOB, consolidation, QC and door shipping quoted separately.
              </p>
            )}
          </div>
        )}

        <section className="mt-8">
          <div className="mono text-[11px] uppercase tracking-[.08em] text-coral-text font-semibold">{isAsset ? 'How the budget works' : 'Rough revenue & payback'}</div>
          <h2 className="font-display font-bold text-[22px] text-ink mt-1 mb-4">{isAsset ? 'What you are buying' : 'What this tier typically earns'}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {earnCards.map((c, i) => (
              <div key={c.label} className={`rounded-[14px] border p-4 ${i === 2 && !isAsset ? 'bg-tint border-tint' : 'bg-white border-line'}`}>
                <div className="mono text-[10.5px] uppercase text-muted">{c.label}</div>
                <div className={`font-display font-bold text-[19px] mt-1 ${i === 2 && !isAsset ? 'text-coral-text' : 'text-ink'}`}>{c.value}</div>
                <p className="text-[13px] text-muted mt-1">{c.note}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* right rail (desktop) */}
      <aside className="lg:sticky lg:top-24 self-start bg-white border border-line rounded-[14px] p-5 space-y-4 order-first lg:order-none" aria-label="Request">
        <div>
          <div className="mono text-[11px] uppercase tracking-[.06em] text-coral-text font-semibold">{k ? `${k.tier_name} package` : p.title}</div>
          <div className="font-display font-extrabold text-[30px] text-ink">{usd(k?.starting_budget_usd ?? p.starting_budget_usd) ?? '—'}</div>
          <div className="text-[13px] text-muted">{live ? 'All-in estimate · consolidated shipping · QC included' : `Rough planning figure. Packages ship the moment ${threshold} interest signals are logged. No commitment.`}</div>
        </div>
        <Link href={formHref()} className="btn btn-primary w-full" data-testid="rail-cta">{cta}</Link>
        {/* ADDON-36 (M6): WhatsApp with the project and tier named; the form stays as the fallback */}
        {whatsapp ? (
          <a href={`https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello Octopus B2B, I'd like to talk to a sourcing lead about the ${p.title} turnkey project${k ? ` (${k.tier_name} package)` : ''}.`)}`}
            target="_blank" rel="noopener noreferrer" className="block text-center text-ok font-semibold text-[14px]" data-testid="talk-whatsapp">Talk to a sourcing lead on WhatsApp</a>
        ) : null}
        <Link href={`/turnkey/${p.project_id}/${live ? 'request' : 'interest'}?package=${k?.package_id ?? ''}&talk=1`} className={`block text-center font-semibold ${whatsapp ? 'text-muted text-[13px]' : 'text-coral-text text-[14px]'}`}>{whatsapp ? 'or send the request form' : 'Talk to a sourcing lead'}</Link>
        <form action={`/turnkey/${p.project_id}/${live ? 'request' : 'interest'}`} method="get" className="border-t border-line pt-4 space-y-2.5">
          <div className="mono text-[10.5px] uppercase tracking-[.06em] text-muted">Quick quote</div>
          <input type="hidden" name="package" value={k?.package_id ?? ''} />
          <label className="block text-[13px]"><span className="text-muted">Destination country</span>
            <select name="country" className="input mt-1" defaultValue="AE">
              {QUICK_COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_OPTIONS.find(([x]) => x === c)?.[1] ?? c}</option>)}
              <option value="">Other</option>
            </select>
          </label>
          <label className="block text-[13px]"><span className="text-muted">Target opening</span><input type="date" name="date" className="input mt-1" /></label>
          <label className="block text-[13px]"><span className="text-muted">Delivery term</span>
            <select name="term" className="input mt-1" defaultValue="DAP"><option value="DAP">DAP · door</option><option value="CIF">CIF · port</option><option value="FOB">FOB · Shenzhen</option></select>
          </label>
          <button type="submit" className="btn btn-dark w-full">Send to sourcing →</button>
        </form>
        <div className="border-t border-line pt-4">
          <div className="mono text-[10.5px] uppercase tracking-[.06em] text-muted mb-2">Covered on every order</div>
          <ul className="space-y-1 text-[13.5px]">{COVERED.map((c) => <li key={c}><span className="text-ok" aria-hidden>✓</span> {c}</li>)}</ul>
        </div>
      </aside>

      {/* sticky CTA (phones) */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-line px-4 py-3 flex items-center gap-3 shadow-[0_-4px_16px_rgba(17,19,60,.08)]">
        <div className="min-w-0"><div className="mono text-[10px] uppercase text-muted truncate">{k?.tier_name ?? p.title}</div><div className="font-display font-bold text-ink">{usd(k?.starting_budget_usd ?? p.starting_budget_usd)}</div></div>
        <Link href={formHref()} className="btn btn-primary flex-1">{cta}</Link>
      </div>
    </div>
  );
}

