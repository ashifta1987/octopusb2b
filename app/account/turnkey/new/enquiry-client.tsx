'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_NAMES } from '@/lib/format';
import { usdToCents } from '@/lib/turnkey/format';
import { submitEnquiryAction } from '../actions';

const COUNTRIES = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
const NEW = '__new__';

/**
 * Turnkey T2 — enquiry form (NewProject / ClientIntake). onSubmit + preventDefault keeps what was typed when the server
 * refuses something; Send stays disabled until a project (or a name for a new one) and the plan are given.
 */
export function EnquiryClient({ projects, initialProject, defaultCountry }: {
  projects: { id: string; title: string; category: string }[]; initialProject: string; defaultCountry: string;
}) {
  const router = useRouter();
  const [f, setF] = useState({ project: initialProject, title: '', country: defaultCountry, city: '', targetOpenOn: '', floorArea: '', budgetUsd: '', plan: '', website: '' });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const isNew = f.project === NEW;
  const budgetBad = Number.isNaN(usdToCents(f.budgetUsd));
  const missing = [
    !f.project && 'a project', isNew && !f.title.trim() && 'what you want to open', f.plan.trim().length < 20 && 'your plan (20 characters or more)',
  ].filter(Boolean) as string[];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (missing.length || budgetBad) return;
    setErr(null);
    start(async () => {
      const r = await submitEnquiryAction({
        catalogueProject: isNew ? '' : f.project, title: isNew ? f.title : '', country: f.country, city: f.city, targetOpenOn: f.targetOpenOn,
        floorArea: f.floorArea, budgetUsd: f.budgetUsd, plan: f.plan, website: f.website,
      });
      if (!r.ok || !r.code) { setErr(r.error ?? 'Something went wrong. Please try again.'); return; }
      router.push(`/account/turnkey/${r.code}?created=1`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="card p-6 flex flex-col gap-5 max-w-[760px]" data-testid="tk-enquiry" noValidate>
      <div>
        <label className="label" htmlFor="tk-project">Project *</label>
        <select id="tk-project" className="input min-h-11" value={f.project} onChange={set('project')} required data-testid="tk-enquiry-project">
          <option value="">Choose a project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.category}</option>)}
          <option value={NEW}>Something else: a new project</option>
        </select>
      </div>
      {isNew && (
        <div>
          <label className="label" htmlFor="tk-title">What do you want to open? *</label>
          <input id="tk-title" className="input min-h-11" value={f.title} onChange={set('title')} maxLength={160} placeholder="For example: robotic coffee kiosk" required data-testid="tk-enquiry-title" />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="tk-country">Country where it opens</label>
          <select id="tk-country" className="input min-h-11" value={f.country} onChange={set('country')} autoComplete="country">
            <option value="">Choose a country</option>
            {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-city">City</label>
          <input id="tk-city" className="input min-h-11" value={f.city} onChange={set('city')} maxLength={120} autoComplete="address-level2" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label" htmlFor="tk-open">Planned opening</label>
          <input id="tk-open" type="date" className="input min-h-11" value={f.targetOpenOn} onChange={set('targetOpenOn')} />
        </div>
        <div>
          <label className="label" htmlFor="tk-area">Space (m²)</label>
          <input id="tk-area" inputMode="decimal" className="input min-h-11" value={f.floorArea} onChange={set('floorArea')} placeholder="120" />
        </div>
        <div>
          <label className="label" htmlFor="tk-budget">Budget (US$)</label>
          <input id="tk-budget" inputMode="decimal" className="input min-h-11" value={f.budgetUsd} onChange={set('budgetUsd')} placeholder="35000"
            aria-invalid={budgetBad} aria-describedby="tk-budget-hint" />
          <span id="tk-budget-hint" className="text-[12.5px] text-muted">{budgetBad ? 'Enter an amount in US dollars, for example 35000.' : 'Optional. Leave empty if you are not sure yet.'}</span>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="tk-plan">Your plan *</label>
        <textarea id="tk-plan" className="input py-2.5 min-h-[140px] resize-y" value={f.plan} onChange={set('plan')} maxLength={4000} required aria-describedby="tk-plan-hint" data-testid="tk-enquiry-plan"
          placeholder="What you want to open, who your customers are, the space you have and when you want to start." />
        <span id="tk-plan-hint" className="text-[12.5px] text-muted">{f.plan.trim().length}/4000 · at least 20 characters</span>
      </div>
      {/* honeypot: people never see or fill this */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="tk-website">Website</label>
        <input id="tk-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
      </div>
      <p className="m-0 text-[13.5px] text-muted">You deal only with Octopus. We reply with the consultation fee; no work starts before you pay.</p>
      {err && <p role="alert" className="m-0 rounded-[10px] border border-bad/40 bg-bad-bg px-4 py-3 text-sm text-bad" data-testid="tk-enquiry-error">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || missing.length > 0 || budgetBad} data-testid="tk-enquiry-send">
          {pending ? 'Sending…' : 'Send enquiry'}
        </button>
        {missing.length > 0 && <span className="text-[13px] text-muted">Still needed: {missing.join(', ')}.</span>}
      </div>
    </form>
  );
}
