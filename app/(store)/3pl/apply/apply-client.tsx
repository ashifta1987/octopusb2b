'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { submitApplicationAction } from './actions';

const CHANNELS = ['Shopify', 'WooCommerce', 'Wix', 'TikTok Shop', 'eBay', 'Amazon', 'Octopus Dropship', 'Wholesale', 'Other'];
const BANDS: [string, string][] = [['under_100', 'Under 100'], ['100_500', '100–500'], ['500_2000', '500–2,000'], ['over_2000', 'Over 2,000']];
const ROUTES: [string, string][] = [['octopus_b2b', 'Sourced through Octopus B2B'], ['make_my_brand', 'Made with Make My Brand'], ['own_supplier', 'From my own supplier'], ['mixed', 'A mix of these']];
const field = 'min-h-11 w-full rounded-[8px] border border-line-strong bg-white px-3 text-[15px] text-ink';

/** Warehouse OS board 27 — Apply / Sign in card. Send stays disabled until the required fields are filled. */
/** CH-1 single sign-in (gap G1): a signed-in customer gets the company and contact pre-filled and the application is linked to the company. */
export type ApplyDefaults = { company: string; contactName: string; email: string; phone: string; country: string };
export function ApplyClient({ warehouses, defaults }: { warehouses: { code: string; name: string; city: string }[]; defaults?: ApplyDefaults | null }) {
  const [tab, setTab] = useState<'apply' | 'signin'>('apply');
  const [f, setF] = useState({ company: defaults?.company ?? '', contactName: defaults?.contactName ?? '', email: defaults?.email ?? '', phone: defaults?.phone ?? '', country: defaults?.country ?? '', sells: '', ordersBand: '', stockRoute: '', preferredWarehouse: warehouses[0]?.code ?? '', website: '' });
  const [channels, setChannels] = useState<string[]>([]);
  const [bat, setBat] = useState(false);
  const [liq, setLiq] = useState(false);
  const [done, setDone] = useState<{ code: string; sds: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const missing = [
    !f.company.trim() && 'company', !f.contactName.trim() && 'your name', !emailOk && 'a valid work email',
    !f.sells.trim() && 'what you sell', !f.ordersBand && 'orders a month', !f.stockRoute && 'how stock reaches us',
  ].filter(Boolean) as string[];

  return (
    <div className="max-w-[640px] mx-auto rounded-[16px] bg-white border border-line-strong overflow-hidden" data-testid="wh-apply">
      <div role="tablist" aria-label="Apply or sign in" className="grid grid-cols-2">
        {(['apply', 'signin'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} aria-controls={`panel-${t}`} id={`tab-${t}`} onClick={() => setTab(t)}
            className={`min-h-12 font-semibold ${tab === t ? 'bg-white text-ink border-b-2 border-coral-text' : 'bg-tint text-muted'}`}>
            {t === 'apply' ? 'Apply for an account' : 'Sign in'}
          </button>
        ))}
      </div>

      {tab === 'apply' ? (
        <div role="tabpanel" id="panel-apply" aria-labelledby="tab-apply" className="p-6">
          {done ? (
            <div role="status" data-testid="wh-apply-done">
              <h1 className="text-[24px] font-bold m-0 text-ink">Application sent</h1>
              <p className="mt-2 text-[15px]">Your reference is <strong className="font-mono" data-testid="wh-apply-code">{done.code}</strong>. We reply within one working day.</p>
              {done.sds && <p className="mt-2 text-[15px]">Because you ship batteries or liquids, please have the safety data sheet (SDS) for each product ready. We ask for it when we review your application.</p>}
              <Link href="/3pl" className="inline-flex mt-3 min-h-11 items-center px-4 rounded-[8px] border border-line-strong font-semibold">Back to Octopus 3PL</Link>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await submitApplicationAction({ ...f, channels, hasBatteries: bat, hasLiquids: liq });
                if (!r.ok) { setErr(r.error ?? 'Could not send the application.'); return; }
                setErr(null); setDone({ code: r.code!, sds: Boolean(r.sds) });
              });
            }}>
              <h1 className="text-[24px] font-bold m-0 text-ink">Apply for an account</h1>
              <label className="flex flex-col gap-1 text-[14px]"><span>Company *</span><input className={field} value={f.company} onChange={set('company')} autoComplete="organization" required /></label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-[14px]"><span>Your name *</span><input className={field} value={f.contactName} onChange={set('contactName')} autoComplete="name" required /></label>
                <label className="flex flex-col gap-1 text-[14px]"><span>Work email *</span><input className={field} type="email" value={f.email} onChange={set('email')} autoComplete="email" required
                  aria-invalid={f.email !== '' && !emailOk} aria-describedby="email-hint" /><span id="email-hint" className="text-[12.5px] text-muted">Your company address, not Gmail or Yahoo.</span></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-[14px]"><span>Phone</span><input className={field} value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
                <label className="flex flex-col gap-1 text-[14px]"><span>Country (2 letters)</span><input className={field} value={f.country} onChange={set('country')} maxLength={2} autoComplete="country" /></label>
              </div>
              <label className="flex flex-col gap-1 text-[14px]"><span>What you sell *</span><textarea className={`${field} min-h-[80px] py-2`} value={f.sells} onChange={set('sells')} required /></label>
              <label className="flex flex-col gap-1 text-[14px]"><span>Orders a month *</span>
                <select className={field} value={f.ordersBand} onChange={set('ordersBand')} required><option value="">Choose</option>{BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <fieldset className="border-0 p-0 m-0">
                <legend className="text-[14px] mb-1">Sales channels</legend>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map((c) => (
                    <label key={c} className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-full border ${channels.includes(c) ? 'border-coral-text bg-tint' : 'border-line-strong'}`}>
                      <input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />{c}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex flex-col gap-1 text-[14px]"><span>How stock reaches us *</span>
                <select className={field} value={f.stockRoute} onChange={set('stockRoute')} required><option value="">Choose</option>{ROUTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              {warehouses.length > 1 && (
                <label className="flex flex-col gap-1 text-[14px]"><span>Preferred warehouse</span>
                  <select className={field} value={f.preferredWarehouse} onChange={set('preferredWarehouse')}>{warehouses.map((w) => <option key={w.code} value={w.code}>{w.name} ({w.city})</option>)}</select></label>
              )}
              <fieldset className="border-0 p-0 m-0 flex flex-wrap gap-4">
                <legend className="text-[14px] mb-1">Dangerous goods</legend>
                <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" checked={bat} onChange={(e) => setBat(e.target.checked)} />My products contain batteries</label>
                <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" checked={liq} onChange={(e) => setLiq(e.target.checked)} />My products contain liquids</label>
              </fieldset>
              {(bat || liq) && <p className="m-0 rounded-[8px] bg-warn-bg text-warn p-3 text-[14px]" data-testid="wh-apply-sds">We need the safety data sheet (SDS) for each product with batteries or liquids before we can store or ship it.</p>}
              <label className="sr-only" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="min-h-12 px-6 rounded-[10px] bg-coral text-white font-semibold disabled:opacity-60" disabled={pending || missing.length > 0}
                  aria-describedby={missing.length ? 'send-why' : undefined} data-testid="wh-apply-send">Send application</button>
                {missing.length > 0 && <span id="send-why" className="text-[13px] text-muted">Still needed: {missing.join(', ')}</span>}
              </div>
              {err && <p role="alert" className="m-0 text-[14px] text-bad" data-testid="wh-apply-error">{err}</p>}
            </form>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="panel-signin" aria-labelledby="tab-signin" className="p-6 flex flex-col gap-3">
          <h1 className="text-[24px] font-bold m-0 text-ink">Sign in</h1>
          <p className="m-0 text-[15px]">Clients sign in to the warehouse portal with their Octopus account.</p>
          <Link href="/login?next=%2Faccount%2Fwarehouse" className="inline-flex min-h-12 items-center justify-center px-5 rounded-[10px] bg-coral text-white font-semibold">Sign in to the client portal</Link>
          <Link href="/staff/login?next=%2Foffice%2Fwarehouse" className="text-[14px] underline text-ink">Staff sign in</Link>
        </div>
      )}
    </div>
  );
}
