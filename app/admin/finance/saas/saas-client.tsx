'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsNotice, DsPageHeader, DsRadioCard, DsSelect, DsTextarea, DsTimeline,
} from '@/components/dropship-ui';
import type { SaasPageData } from '@/lib/dropship-ds12';
import { fmtDate, fmtDateTime, PLAN_FEATURE_LABELS, usd } from '@/lib/dropship-ds12-shared';
import {
  decidePlanAction, decideSwitchAction, proposePlanAction, proposeSwitchAction, removeOverrideAction, setOverrideAction, withdrawSwitchAction,
} from './actions';

/**
 * Finance › SaaS billing (staff/FinanceSaaS.html): the plan-fee switch (propose → a second Finance user or admin approves),
 * the free trial (30 days, one per company, 7 days' grace — owner decisions), what switching on does, counts, per-merchant
 * overrides, plans / prices / limits (two-person), merchant preview and history.
 */

type Note = { tone: 'ok' | 'bad'; text: string; where: string } | null;
const STATUS_LABEL: Record<string, string> = { free: 'Free (billing off)', none: 'Not started', trial: 'Free trial', active: 'Paying', grace: 'Grace', paused: 'Pushes paused', free_forever: 'Free forever', cancelled: 'Closed' };
const ACTION_LABEL: Record<string, string> = {
  'saas_billing.proposed': 'Proposed', 'saas_billing.approved': 'Approved', 'saas_billing.rejected': 'Rejected', 'saas_billing.withdrawn': 'Withdrawn',
  'saas_billing.override_set': 'Override set', 'saas_billing.override_removed': 'Override removed', 'saas_billing.started_on_date': 'Started on the date',
  'ds_plan.proposed': 'Plan proposed', 'ds_plan.approved': 'Plan approved', 'ds_plan.rejected': 'Plan rejected',
};
const dollarsToCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.trunc(Number(v)));

export function SaasClient({ data }: { data: SaasPageData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const s = data.settings;
  const can = data.can_decide;
  const iProposed = s.proposed_by === data.me;
  const [mode, setMode] = useState<'now' | 'date'>('now');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [ovOrg, setOvOrg] = useState('');
  const [ovKind, setOvKind] = useState<'free_forever' | 'extra_trial'>('extra_trial');
  const [ovDays, setOvDays] = useState('30');
  const [ovReason, setOvReason] = useState('');
  const [plan, setPlan] = useState({ code: '', name: '', description: '', price: '', live: '', stores: '', orders: '', sort: '10', active: false, features: [] as string[] });
  const [planReason, setPlanReason] = useState('');
  const [planDecision, setPlanDecision] = useState('');
  const run = (where: string, fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
    setNote(null);
    start(async () => { const r = await fn(); setNote(r.ok ? { tone: 'ok', text: okText, where } : { tone: 'bad', text: r.message ?? 'Not saved.', where }); router.refresh(); });
  };
  const noteAt = (where: string) => (note && note.where === where ? <DsNotice tone={note.tone} title={note.tone === 'ok' ? 'Done' : 'Not done'} testId={`saas-note-${where}`}>{note.text}</DsNotice> : null);
  const ovMerchant = data.merchants.find((m) => m.org_id === ovOrg);
  const enable = !s.enabled && !s.scheduled_start;
  const statusLine = s.enabled ? `On since ${fmtDate(s.enabled_at)}` : s.scheduled_start ? `Off · starts on ${fmtDate(s.scheduled_start)}` : s.approved_at ? `Off since ${fmtDate(s.approved_at)}` : 'Off since launch';
  const noFinance = can ? null : 'Only company-wide Finance approvers and admins can change plan fees.';

  return (
    <div className="flex flex-col gap-5" data-testid="finance-saas-page">
      <DsPageHeader title="SaaS billing" icon="card" subtitle="Finance · decide when Octopus Dropship plan fees start, and how long the free trial is. Changes need a second approver."
        actions={<a href="#history" className="ds-btn-link text-[14px] font-medium text-coral-text min-h-[44px] inline-flex items-center">Billing history</a>} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsCard title="Charge plan fees" icon="dollar" testId="saas-switch">
          <div className="flex items-center gap-3 mb-3">
            <DsBadge tone={s.enabled ? 'ok' : 'neutral'} testId="saas-state">{s.enabled ? 'On' : 'Off'}</DsBadge>
            <span className="text-[14px] text-black" data-testid="saas-state-line">{statusLine}</span>
          </div>
          <p className="m-0 mb-3 text-[13px] text-muted">
            {s.enabled ? 'On: merchants get their free trial first, then approve and pay their plan.' : 'Off: every merchant uses their plan free. Nothing is billed in Shopify or by Octopus. Merchants see "Plans are free for now".'}
          </p>
          {noteAt('switch')}
          {s.pending_enabled !== null ? (
            <div className="rounded-xl border border-warn-line bg-warn-bg p-4 flex flex-col gap-3" data-testid="saas-pending">
              <strong className="text-[15px] text-ink">Waiting for approval: switch {s.pending_enabled ? 'on' : 'off'}{s.pending_scheduled_start ? ` on ${fmtDate(s.pending_scheduled_start)}` : ''}</strong>
              <span className="text-[14px] text-black">Proposed by {s.proposed_by_name ?? 'a Finance user'} at {fmtDateTime(s.proposed_at)}. Reason: {s.proposal_reason}. Another Finance user or admin must approve.</span>
              <DsTextarea id="saas-decision" label="Note (needed to reject)" value={decision} onChange={(e) => setDecision(e.target.value)} rows={2} disabled={!can || iProposed} />
              <div className="flex flex-wrap gap-2">
                <DsButton loading={pending} disabled={!can || iProposed} disabledReason={iProposed ? 'You proposed this change; a second person must approve.' : noFinance ?? undefined}
                  onClick={() => run('switch', () => decideSwitchAction(true, decision), 'Change approved.')} testId="saas-approve">Approve</DsButton>
                <DsButton variant="secondary" loading={pending} disabled={!can || iProposed || decision.trim().length < 3}
                  disabledReason={iProposed ? 'You proposed this change.' : decision.trim().length < 3 ? 'Write a note first.' : noFinance ?? undefined}
                  onClick={() => run('switch', () => decideSwitchAction(false, decision), 'Change rejected.')} testId="saas-reject">Reject</DsButton>
                {iProposed && <DsButton variant="link" onClick={() => run('switch', () => withdrawSwitchAction(), 'Proposal withdrawn.')} testId="saas-withdraw">Withdraw</DsButton>}
              </div>
            </div>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run('switch', () => proposeSwitchAction(enable, enable && mode === 'date' ? date : null, reason), 'Proposed. A second Finance user or admin must approve.'); setReason(''); }}>
              {enable && (
                <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
                  <legend className="text-[14px] font-medium text-ink mb-1">Start charging</legend>
                  <DsRadioCard name="saas-start" value="now" checked={mode === 'now'} onChange={() => setMode('now')} title="Now, after approval" disabled={!can} />
                  <DsRadioCard name="saas-start" value="date" checked={mode === 'date'} onChange={() => setMode('date')} title="On a date" disabled={!can} />
                  {mode === 'date' && <DsInput id="saas-date" type="date" label="Date (if on a date)" value={date} onChange={(e) => setDate(e.target.value)} disabled={!can} />}
                </fieldset>
              )}
              <DsTextarea id="saas-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={!can} />
              <div className="flex flex-wrap items-center gap-2">
                <DsButton type="submit" loading={pending} disabled={!can || reason.trim().length < 3 || (enable && mode === 'date' && !date)}
                  disabledReason={noFinance ?? (reason.trim().length < 3 ? 'Enter the reason first.' : enable && mode === 'date' && !date ? 'Choose the date.' : undefined)} testId="saas-propose">
                  {enable ? 'Propose switching on' : 'Propose switching off'}
                </DsButton>
              </div>
            </form>
          )}
          <p className="m-0 mt-3 text-[13px] text-muted">Proposed by one Finance user, approved by another (company-wide Finance or admin). Every change is in the audit log.</p>
        </DsCard>

        <DsCard title="Free trial" icon="clock" testId="saas-trial">
          <dl className="m-0 flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between gap-2"><dt>Trial length</dt><dd className="m-0 font-semibold text-ink" data-testid="saas-trial-days">{s.trial_days} days</dd></div>
            <div className="flex justify-between gap-2"><dt>Trial starts</dt><dd className="m-0 text-right text-ink">When charging is switched on (existing merchants) or when a new merchant starts</dd></div>
            <div className="flex justify-between gap-2"><dt>After the trial, if the plan isn&rsquo;t approved</dt><dd className="m-0 text-right text-ink">{s.grace_days} days&rsquo; grace, then new pushes pause</dd></div>
            <div className="flex justify-between gap-2"><dt>Trials</dt><dd className="m-0 text-right text-ink">One per company, even if the store reinstalls the app</dd></div>
          </dl>
          <p className="m-0 mt-3 text-[13px] text-muted">Paid orders always keep shipping. Trial and grace length are the owner&rsquo;s decision (30 and 7 days).</p>
        </DsCard>
      </div>

      <DsCard title="What switching on does" icon="list" testId="saas-timeline">
        <DsTimeline events={[
          { title: 'Day 0: charging switched on', detail: `${data.counts.merchants} merchant${data.counts.merchants === 1 ? '' : 's'} start a ${s.trial_days}-day free trial; each chooses and approves a plan`, state: 'upcoming' },
          { title: `Day ${Math.max(0, s.trial_days - 7)} and day ${Math.max(0, s.trial_days - 2)}`, detail: 'Reminder in the app (and email when app email is live)', state: 'upcoming' },
          { title: `Day ${s.trial_days}: trial ends`, detail: 'Approved plans start; stores without Shopify pay from the Octopus wallet (OCT-DS invoice). Shopify stores: billed by Shopify once connected.', state: 'upcoming' },
          { title: `Day ${s.trial_days + s.grace_days}: grace ends`, detail: 'Not approved or not paid: new pushes paused, orders keep shipping', state: 'upcoming' },
          { title: 'Switching off again later', detail: 'Stops new charges after a second approval. Charges already made are not refunded automatically; running trials keep their days left.', state: 'upcoming' },
        ]} />
      </DsCard>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="saas-counts">
        {[['Free, billing off', data.counts.free_off], ['In free trial', data.counts.trial], ['Paying', data.counts.paying], ['In grace', data.counts.grace], ['Pushes paused', data.counts.paused], ['Free forever (internal)', data.counts.free_forever]].map(([k, v]) => (
          <div key={k as string} className="ds-card !py-3"><span className="block text-[13px] text-muted">{k}</span><strong className="text-[20px] text-ink">{v as number}</strong></div>
        ))}
      </div>

      <section aria-labelledby="ov-h" className="ds-card !p-0 overflow-hidden" data-testid="saas-overrides">
        <h2 id="ov-h" className="m-0 px-5 pt-4 pb-3 text-[17px] font-semibold text-ink">Per-merchant overrides</h2>
        {noteAt('override')}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Per-merchant overrides">
          <table className="w-full min-w-[720px] text-[14px] border-collapse">
            <thead className="bg-pearl text-left text-muted">
              <tr><th scope="col" className="px-5 py-2.5 font-medium">Merchant</th><th scope="col" className="px-3 py-2.5 font-medium">Plan</th><th scope="col" className="px-3 py-2.5 font-medium">State</th><th scope="col" className="px-3 py-2.5 font-medium">Override</th><th scope="col" className="px-3 py-2.5 font-medium">Reason</th><th scope="col" className="px-3 py-2.5 font-medium">Set by</th><th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {data.merchants.length === 0 && <tr><td colSpan={7} className="px-5 py-4 text-muted">No Dropship merchants yet.</td></tr>}
              {data.merchants.map((m) => (
                <tr key={m.org_id} className="border-t border-divider" data-testid={`saas-merchant-${m.org_id}`}>
                  <td className="px-5 py-2.5 text-ink">{m.name}{m.credit_eligible ? <span className="ml-2"><DsBadge tone="info">Internal</DsBadge></span> : null}</td>
                  <td className="px-3 py-2.5">{m.plan_name ?? '—'}</td>
                  <td className="px-3 py-2.5">{STATUS_LABEL[m.status] ?? m.status}</td>
                  <td className="px-3 py-2.5">{m.override === 'free_forever' ? 'Free forever' : m.override === 'extra_trial' ? `Trial +${m.extra_trial_days} days` : 'Default'}</td>
                  <td className="px-3 py-2.5">{m.reason ?? '—'}</td>
                  <td className="px-3 py-2.5">{m.set_by_name ? `${m.set_by_name} · ${fmtDate(m.set_at)}` : '—'}</td>
                  <td className="px-5 py-2.5 text-right">
                    {m.override
                      ? <DsButton variant="link" disabled={!can || ovReason.trim().length < 3} disabledReason={!can ? noFinance ?? undefined : 'Enter the reason below first.'}
                          onClick={() => run('override', () => removeOverrideAction(m.org_id, ovReason), 'Override removed.')}>Remove<span className="sr-only"> override for {m.name}</span></DsButton>
                      : <DsButton variant="link" disabled={!can} onClick={() => setOvOrg(m.org_id)}>Add override<span className="sr-only"> for {m.name}</span></DsButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="px-5 py-4 border-t border-divider grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          onSubmit={(e) => { e.preventDefault(); run('override', () => setOverrideAction(ovOrg, ovKind, ovKind === 'extra_trial' ? Number(ovDays) : null, ovReason), 'Override saved.'); }}>
          <DsSelect id="ov-merchant" label="Merchant" value={ovOrg} onChange={(e) => setOvOrg(e.target.value)} disabled={!can}>
            <option value="">Choose a merchant</option>
            {data.merchants.map((m) => <option key={m.org_id} value={m.org_id}>{m.name}</option>)}
          </DsSelect>
          <DsSelect id="ov-kind" label="Override" value={ovKind} onChange={(e) => setOvKind(e.target.value as 'free_forever' | 'extra_trial')} disabled={!can}
            hint={ovKind === 'free_forever' && ovMerchant && !ovMerchant.credit_eligible ? 'Only for Octopus group companies and test accounts.' : undefined}>
            <option value="extra_trial">Longer trial</option>
            {(!ovMerchant || ovMerchant.credit_eligible) && <option value="free_forever">Free forever</option>}
          </DsSelect>
          {ovKind === 'extra_trial' ? <DsInput id="ov-days" type="number" min={1} max={365} label="Extra trial days" value={ovDays} onChange={(e) => setOvDays(e.target.value)} disabled={!can} /> : <span />}
          <DsInput id="ov-reason" label="Reason" value={ovReason} onChange={(e) => setOvReason(e.target.value)} disabled={!can} />
          <div className="md:col-span-4">
            <DsButton type="submit" variant="secondary" loading={pending} disabled={!can || !ovOrg || ovReason.trim().length < 3}
              disabledReason={noFinance ?? (!ovOrg ? 'Choose a merchant.' : ovReason.trim().length < 3 ? 'Enter the reason.' : undefined)} testId="ov-save">Save override</DsButton>
          </div>
        </form>
        <p className="m-0 px-5 pb-4 text-[13px] text-muted">Free forever is only for Octopus group companies and test accounts, the same rule as Pay later (the database refuses others).</p>
      </section>

      <section aria-labelledby="plans-h" className="ds-card flex flex-col gap-4" data-testid="saas-plans">
        <h2 id="plans-h" className="m-0 text-[17px] font-semibold text-ink">Plans, prices and limits</h2>
        {noteAt('plans')}
        {data.plans.length === 0 ? (
          <p className="m-0 text-[14px] text-muted" data-testid="saas-plans-empty">No plans yet. Plan prices and limits stay unset until the owner confirms them; until then merchants see &ldquo;Free while plan fees are off&rdquo;.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Plans">
            <table className="w-full min-w-[640px] text-[14px] border-collapse">
              <thead className="bg-pearl text-left text-muted"><tr><th scope="col" className="px-3 py-2 font-medium">Plan</th><th scope="col" className="px-3 py-2 font-medium">Price / month</th><th scope="col" className="px-3 py-2 font-medium">Stores</th><th scope="col" className="px-3 py-2 font-medium">Live products</th><th scope="col" className="px-3 py-2 font-medium">Orders / month</th><th scope="col" className="px-3 py-2 font-medium">Offered</th></tr></thead>
              <tbody>{data.plans.map((p) => (
                <tr key={p.code} className="border-t border-divider"><td className="px-3 py-2">{p.name} <span className="text-muted">({p.code})</span></td><td className="px-3 py-2">{p.price_cents == null ? 'Not set' : usd(p.price_cents)}</td><td className="px-3 py-2">{p.stores_limit ?? 'No limit'}</td><td className="px-3 py-2">{p.live_products_limit ?? 'No limit'}</td><td className="px-3 py-2">{p.orders_month_limit ?? 'No limit'}</td><td className="px-3 py-2">{p.active ? 'Yes' : 'No'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {data.plan_changes.map((c) => (
          <div key={c.id} className="rounded-xl border border-warn-line bg-warn-bg p-4 flex flex-col gap-2" data-testid={`plan-change-${c.plan_code}`}>
            <strong className="text-[14px] text-ink">Waiting for approval: {String(c.proposal.name)} ({c.plan_code}) · {c.proposal.price_cents == null ? 'price not set' : usd(Number(c.proposal.price_cents))}</strong>
            <span className="text-[13px] text-black">Proposed by {c.proposed_by_name ?? 'a Finance user'} at {fmtDateTime(c.proposed_at)}. Reason: {c.reason}</span>
            <DsInput id={`plan-note-${c.id}`} label="Note (needed to reject)" value={planDecision} onChange={(e) => setPlanDecision(e.target.value)} disabled={!can || c.proposed_by === data.me} />
            <div className="flex flex-wrap gap-2">
              <DsButton loading={pending} disabled={!can || c.proposed_by === data.me} disabledReason={c.proposed_by === data.me ? 'You proposed this change; a second person must approve.' : noFinance ?? undefined}
                onClick={() => run('plans', () => decidePlanAction(c.id, true, planDecision), 'Plan approved.')} testId={`plan-approve-${c.plan_code}`}>Approve</DsButton>
              <DsButton variant="secondary" loading={pending} disabled={!can || (c.proposed_by !== data.me && planDecision.trim().length < 3)}
                disabledReason={c.proposed_by !== data.me && planDecision.trim().length < 3 ? 'Write a note first.' : undefined}
                onClick={() => run('plans', () => decidePlanAction(c.id, false, planDecision), c.proposed_by === data.me ? 'Proposal withdrawn.' : 'Plan change rejected.')}>{c.proposed_by === data.me ? 'Withdraw' : 'Reject'}</DsButton>
            </div>
          </div>
        ))}
        <form className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end border-t border-divider pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            run('plans', () => proposePlanAction({
              code: plan.code.trim(), name: plan.name, description: plan.description || undefined, price_cents: dollarsToCents(plan.price),
              live_products_limit: intOrNull(plan.live), stores_limit: intOrNull(plan.stores), orders_month_limit: intOrNull(plan.orders),
              features: plan.features as ('import_push' | 'order_sync' | 'auto_sync' | 'priority_handling' | 'branded_packaging')[], sort_order: Number(plan.sort) || 10, active: plan.active,
            }, planReason), 'Plan change proposed. A second Finance user or admin must approve.');
          }}>
          <DsInput id="plan-code" label="Plan code" value={plan.code} onChange={(e) => setPlan({ ...plan, code: e.target.value })} hint="e.g. growth" disabled={!can} />
          <DsInput id="plan-name" label="Plan name" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} disabled={!can} />
          <DsInput id="plan-price" type="number" min={0} step="0.01" label="Price per month (US$)" value={plan.price} onChange={(e) => setPlan({ ...plan, price: e.target.value })} hint="Empty = not set" disabled={!can} />
          <DsInput id="plan-sort" type="number" label="Order on the page" value={plan.sort} onChange={(e) => setPlan({ ...plan, sort: e.target.value })} disabled={!can} />
          <DsInput id="plan-stores" type="number" min={1} label="Connected stores" value={plan.stores} onChange={(e) => setPlan({ ...plan, stores: e.target.value })} hint="Empty = no limit" disabled={!can} />
          <DsInput id="plan-live" type="number" min={1} label="Live products" value={plan.live} onChange={(e) => setPlan({ ...plan, live: e.target.value })} hint="Empty = no limit" disabled={!can} />
          <DsInput id="plan-orders" type="number" min={1} label="Orders per month" value={plan.orders} onChange={(e) => setPlan({ ...plan, orders: e.target.value })} hint="Notice only; orders never stop" disabled={!can} />
          <DsInput id="plan-desc" label="Description (optional)" value={plan.description} onChange={(e) => setPlan({ ...plan, description: e.target.value })} disabled={!can} />
          <fieldset className="md:col-span-4 m-0 p-0 border-0 flex flex-wrap gap-4">
            <legend className="text-[14px] font-medium text-ink mb-1">Features shown on the plan</legend>
            {Object.entries(PLAN_FEATURE_LABELS).map(([k, label]) => (
              <DsCheckbox key={k} label={label} checked={plan.features.includes(k)} disabled={!can}
                onChange={(e) => setPlan({ ...plan, features: e.target.checked ? [...plan.features, k] : plan.features.filter((x) => x !== k) })} />
            ))}
          </fieldset>
          <div className="md:col-span-4"><DsCheckbox label="Offer this plan to merchants" checked={plan.active} disabled={!can || !plan.price} hint={!plan.price ? 'Set a price first.' : undefined} onChange={(e) => setPlan({ ...plan, active: e.target.checked })} /></div>
          <DsInput id="plan-reason" label="Reason" value={planReason} onChange={(e) => setPlanReason(e.target.value)} containerClassName="md:col-span-3" disabled={!can} />
          <DsButton type="submit" variant="secondary" loading={pending} disabled={!can || !plan.code || !plan.name || planReason.trim().length < 3}
            disabledReason={noFinance ?? (!plan.code || !plan.name ? 'Enter the plan code and name.' : planReason.trim().length < 3 ? 'Enter the reason.' : undefined)} testId="plan-propose">Propose plan</DsButton>
        </form>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="saas-preview">
        <DsCard title="Merchants see now" icon="eye">
          {s.enabled
            ? <DsNotice tone="info" title={`Free trial: ${s.trial_days} days`}>Choose and approve your plan to keep using it after the trial. Nothing is charged before then.</DsNotice>
            : <DsNotice tone="info" title="Plans are free for now">You won&rsquo;t be charged for your plan yet. Before charging starts you get {s.trial_days} days free, and you approve your plan first.</DsNotice>}
        </DsCard>
        <DsCard title={s.enabled ? 'After the trial' : 'Merchants see after switch-on'} icon="eye">
          {s.enabled
            ? <DsNotice tone="warn" title="Approve your plan to keep pushing">New pushes pause {s.grace_days} days after the trial ends. Paid orders keep shipping.</DsNotice>
            : <DsNotice tone="info" title={`Free trial: ${s.trial_days} days left`}>Approve your plan to keep using it after the trial. Nothing is charged before then.</DsNotice>}
        </DsCard>
      </div>

      <section id="history" aria-labelledby="hist-h" className="ds-card" data-testid="saas-history">
        <h2 id="hist-h" className="m-0 mb-3 text-[17px] font-semibold text-ink">Billing history</h2>
        {data.history.length === 0 ? <p className="m-0 text-[14px] text-muted">No changes yet.</p> : (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-divider text-[14px]">
            {data.history.map((h, i) => (
              <li key={i} className="py-2 flex flex-wrap gap-x-3"><span className="text-muted">{fmtDateTime(h.created_at)}</span><strong className="text-ink">{ACTION_LABEL[h.action] ?? h.action}</strong>
                <span>{h.actor_name ?? 'System'}</span>{h.details && (h.details as Record<string, unknown>).reason ? <span className="text-black">· {String((h.details as Record<string, unknown>).reason)}</span> : null}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
