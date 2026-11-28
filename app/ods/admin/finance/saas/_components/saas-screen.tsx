'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, NumberInput, OctopusDataGrid, Select, StatusPill, Tabs, Textarea, Timeline, formatDate, type GridColumn } from '@octopus/ui';
import type { SaasPageData } from '@/lib/dropship-ds12';
import { PLAN_FEATURE_LABELS } from '@/lib/dropship-ds12-shared';
import { PLAN_STATUS_LABEL, SAAS_ACTION_LABEL, SAAS_TABS, fmtMinor, overrideText, saasDecision, saasStatusLine } from '../../_accounts-b/core';
import { Note, NoPermission, PageHead, RunMsg, useRun } from '../../_accounts-b/kit';

type R = { ok: true; message?: string } | { ok: false; message: string };
type PlanInput = { code: string; name: string; description?: string; price_cents: number | null; live_products_limit: number | null; stores_limit: number | null; orders_month_limit: number | null; features: ('import_push' | 'order_sync' | 'auto_sync' | 'priority_handling' | 'branded_packaging')[]; sort_order: number; active: boolean };
export type SaasActions = {
  proposeSwitch: (enable: boolean, startAt: string | null, reason: string) => Promise<R>;
  decideSwitch: (approve: boolean, note: string) => Promise<R>;
  withdrawSwitch: () => Promise<R>;
  setOverride: (orgId: string, kind: 'free_forever' | 'extra_trial', extraDays: number | null, reason: string) => Promise<R>;
  removeOverride: (orgId: string, reason: string) => Promise<R>;
  proposePlan: (input: PlanInput, reason: string) => Promise<R>;
  decidePlan: (changeId: string, approve: boolean, note: string) => Promise<R>;
};
type Merchant = SaasPageData['merchants'][number];
type Plan = SaasPageData['plans'][number];
type Tab = (typeof SAAS_TABS)[number][0];

export type SaasScreenProps = { state: 'ok' | 'loading' | 'error' | 'forbidden'; data: SaasPageData | null; error?: string | null; actions: SaasActions; initialTab?: Tab; initialOverride?: string | null; fixture?: boolean };

/** Adapts today's {ok:false,message} results to the shared runner. */
const adapt = (p: Promise<R>) => p.then((r) => (r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message }));
const fmt = (d: string | null) => (d ? formatDate(d) : '—');

/**
 * ODS T9 · Accounts › SaaS billing. The plan-fee switch, free trial, per-merchant overrides, plans (all two-person in the
 * database: a second company-wide Finance user or admin approves) and the history. Every button calls today's action.
 */
export function SaasScreen({ state, data, error, actions, initialTab, initialOverride, fixture }: SaasScreenProps) {
  const router = useRouter();
  const done = () => !fixture && router.refresh();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const [ov, setOv] = useState<string | null>(initialOverride ?? null);
  const [planOpen, setPlanOpen] = useState(false);
  const sw = useRun(done);
  const pl = useRun(done);
  const [mode, setMode] = useState<'now' | 'date'>('now');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [planNotes, setPlanNotes] = useState<Record<string, string>>({});

  if (state === 'forbidden') return <NoPermission crumb="SaaS billing" title="SaaS billing" what="SaaS billing (Finance view)" />;
  const head = <PageHead crumb="SaaS billing" title="SaaS billing" subtitle="Decide when Octopus Dropship plan fees start and how long the free trial is. Changes need a second approver (company-wide Finance or admin)." />;
  if (state === 'error' || (state === 'ok' && !data)) {
    return (
      <div className="flex flex-col gap-4" data-testid="saas-page">
        {head}
        <Note tone="danger" role="alert" testId="saas-error">SaaS billing could not be loaded{error ? `: ${error}` : '.'} <a href="/admin/finance/saas" className="font-semibold underline">Try again</a></Note>
      </div>
    );
  }
  const d = data;
  const s = d?.settings;
  const can = !!d?.can_decide;
  const iProposed = !!s && s.proposed_by === d?.me;
  const enable = !!s && !s.enabled && !s.scheduled_start;
  const dec = saasDecision(can, iProposed, decision);
  const noFinance = can ? null : 'Only company-wide Finance approvers and admins can change plan fees.';
  const merchant = d?.merchants.find((m) => m.org_id === ov) ?? null;

  const merchantCols: GridColumn<Merchant>[] = [
    { id: 'name', header: 'Merchant', width: 220, accessor: (m) => m.name, cell: (m) => <span className="truncate font-semibold text-ods-navy">{m.name}{m.credit_eligible ? <span className="ms-2"><StatusPill tone="info">Internal</StatusPill></span> : null}</span> },
    { id: 'plan', header: 'Plan', width: 130, accessor: (m) => m.plan_name ?? '' },
    { id: 'state', header: 'State', width: 140, accessor: (m) => PLAN_STATUS_LABEL[m.status] ?? m.status },
    { id: 'override', header: 'Override', width: 140, accessor: (m) => overrideText(m) },
    { id: 'reason', header: 'Reason', width: 220, accessor: (m) => m.reason ?? '' },
    { id: 'set', header: 'Set by', width: 170, accessor: (m) => m.set_by_name ?? '', cell: (m) => (m.set_by_name ? `${m.set_by_name} · ${fmt(m.set_at)}` : '—') },
  ];
  const planCols: GridColumn<Plan>[] = [
    { id: 'name', header: 'Plan', width: 200, accessor: (p) => p.name, cell: (p) => <span>{p.name} <span className="text-ods-slate">({p.code})</span></span> },
    { id: 'price', header: 'Price / month', width: 130, numeric: true, accessor: (p) => p.price_cents ?? -1, cell: (p) => (p.price_cents == null ? 'Not set' : fmtMinor(p.price_cents)) },
    { id: 'stores', header: 'Stores', width: 100, accessor: (p) => p.stores_limit ?? 0, cell: (p) => p.stores_limit ?? 'No limit' },
    { id: 'live', header: 'Live products', width: 120, accessor: (p) => p.live_products_limit ?? 0, cell: (p) => p.live_products_limit ?? 'No limit' },
    { id: 'orders', header: 'Orders / month', width: 130, accessor: (p) => p.orders_month_limit ?? 0, cell: (p) => p.orders_month_limit ?? 'No limit' },
    { id: 'active', header: 'Offered', width: 90, accessor: (p) => (p.active ? 'Yes' : 'No') },
  ];

  const overview = s ? (
    <div className="grid gap-4 ods-desktop:grid-cols-2">
      <Card title="Charge plan fees" headingLevel={2} data-testid="saas-switch">
        <div className="mb-2 flex items-center gap-2">
          <StatusPill tone={s.enabled ? 'success' : 'neutral'} data-testid="saas-state">{s.enabled ? 'On' : 'Off'}</StatusPill>
          <span className="text-ods-body">{saasStatusLine(s, fmt)}</span>
        </div>
        <p className="m-0 mb-3 text-ods-small text-ods-slate">{s.enabled ? 'On: merchants get their free trial first, then approve and pay their plan.' : 'Off: every merchant uses their plan free. Nothing is billed in Shopify or by Octopus.'}</p>
        {s.pending_enabled !== null ? (
          <div className="flex flex-col gap-3 rounded-ods-control border border-ods-warning/30 bg-ods-warning-tint p-3" data-testid="saas-pending">
            <b className="text-ods-body text-ods-navy">Waiting for approval: switch {s.pending_enabled ? 'on' : 'off'}{s.pending_scheduled_start ? ` on ${fmt(s.pending_scheduled_start)}` : ''}</b>
            <span className="text-ods-small text-ods-text">Proposed by {s.proposed_by_name ?? 'a Finance user'} on {fmt(s.proposed_at)}. Reason: {s.proposal_reason}. Another Finance user or admin must approve.</span>
            {iProposed ? <Note tone="warning" testId="second-approver-needed"><b>Second approver needed.</b> You proposed this change; a different company-wide Finance user or admin must approve it.</Note> : null}
            <Field label="Note (needed to reject)"><Textarea value={decision} onChange={(e) => setDecision(e.target.value)} rows={2} disabled={!can || iProposed} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button loading={sw.pending} disabled={!!dec.approve} disabledReason={dec.approve ?? undefined} onClick={() => sw.run(() => adapt(actions.decideSwitch(true, decision)), 'Change approved.')} data-testid="saas-approve">Approve</Button>
              <Button variant="secondary" loading={sw.pending} disabled={!!dec.reject} disabledReason={dec.reject ?? undefined} onClick={() => sw.run(() => adapt(actions.decideSwitch(false, decision)), 'Change rejected.')}>Reject</Button>
              {iProposed ? <Button variant="link" onClick={() => sw.run(() => adapt(actions.withdrawSwitch()), 'Proposal withdrawn.')}>Withdraw</Button> : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {enable ? (
              <Field label="Start charging">
                <Select value={mode} onChange={(e) => setMode(e.target.value as 'now' | 'date')} disabled={!can}>
                  <option value="now">Now, after approval</option>
                  <option value="date">On a date</option>
                </Select>
              </Field>
            ) : null}
            {enable && mode === 'date' ? <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!can} /></Field> : null}
            <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={!can} /></Field>
            <Button
              loading={sw.pending}
              disabled={!can || reason.trim().length < 3 || (enable && mode === 'date' && !date)}
              disabledReason={noFinance ?? (reason.trim().length < 3 ? 'Enter the reason first.' : enable && mode === 'date' && !date ? 'Choose the date.' : undefined)}
              onClick={() => {
                sw.run(() => adapt(actions.proposeSwitch(enable, enable && mode === 'date' ? date : null, reason)), 'Proposed. A second Finance user or admin must approve.');
                setReason('');
              }}
              data-testid="saas-propose"
            >
              {enable ? 'Propose switching on' : 'Propose switching off'}
            </Button>
          </div>
        )}
        <div className="mt-3"><RunMsg msg={sw.msg} testId="saas-switch-msg" /></div>
        <p className="m-0 mt-2 text-ods-small text-ods-slate">Proposed by one Finance user, approved by another. Every change is in the audit log.</p>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Free trial" headingLevel={2}>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-ods-small">
            <dt className="text-ods-slate">Trial length</dt><dd className="m-0 font-semibold">{s.trial_days} days</dd>
            <dt className="text-ods-slate">After the trial, if the plan isn’t approved</dt><dd className="m-0">{s.grace_days} days’ grace, then new pushes pause</dd>
            <dt className="text-ods-slate">Trials</dt><dd className="m-0">One per company</dd>
          </dl>
          <p className="m-0 mt-2 text-ods-small text-ods-slate">Paid orders always keep shipping. Trial and grace length are the owner’s decision.</p>
        </Card>
        <Card title="What switching on does" headingLevel={2}>
          <Timeline
            label="What switching on does"
            items={[
              { id: 'd0', title: 'Day 0: charging switched on', description: `${d?.counts.merchants ?? 0} merchants start a ${s.trial_days}-day free trial; each chooses and approves a plan`, state: 'next' },
              { id: 'd1', title: `Day ${Math.max(0, s.trial_days - 7)} and day ${Math.max(0, s.trial_days - 2)}`, description: 'Reminder in the app', state: 'next' },
              { id: 'd2', title: `Day ${s.trial_days}: trial ends`, description: 'Approved plans start; stores without Shopify pay from the Octopus wallet (OCT-DS invoice).', state: 'next' },
              { id: 'd3', title: `Day ${s.trial_days + s.grace_days}: grace ends`, description: 'Not approved or not paid: new pushes paused, orders keep shipping', state: 'next' },
            ]}
          />
        </Card>
      </div>
    </div>
  ) : null;

  const plans = d ? (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end"><Button variant="secondary" iconStart={Plus} onClick={() => setPlanOpen(true)} disabled={!can} disabledReason={noFinance ?? undefined}>Propose plan</Button></div>
      <OctopusDataGrid<Plan> label="Plans" data-testid="saas-plans-grid" rows={d.plans} columns={planCols} getRowId={(p) => p.code} emptyTitle="No plans yet" emptyDescription="Plan prices and limits stay unset until the owner confirms them; until then merchants see “Free while plan fees are off”." headingLevel={2} />
      {d.plan_changes.map((c) => {
        const mine = c.proposed_by === d.me;
        const n = planNotes[c.id] ?? '';
        return (
          <div key={c.id} className="flex flex-col gap-2 rounded-ods-control border border-ods-warning/30 bg-ods-warning-tint p-3" data-testid="plan-change">
            <b className="text-ods-body text-ods-navy">Waiting for approval: {String(c.proposal.name)} ({c.plan_code}) · {c.proposal.price_cents == null ? 'price not set' : fmtMinor(Number(c.proposal.price_cents))}</b>
            <span className="text-ods-small">Proposed by {c.proposed_by_name ?? 'a Finance user'} on {fmt(c.proposed_at)}. Reason: {c.reason}</span>
            <Field label="Note (needed to reject)"><Input value={n} onChange={(e) => setPlanNotes({ ...planNotes, [c.id]: e.target.value })} disabled={!can || mine} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={pl.pending} disabled={!can || mine} disabledReason={mine ? 'You proposed this change; a second person must approve.' : noFinance ?? undefined} onClick={() => pl.run(() => adapt(actions.decidePlan(c.id, true, n)), 'Plan approved.')}>Approve</Button>
              <Button size="sm" variant="secondary" loading={pl.pending} disabled={!can || (!mine && n.trim().length < 3)} disabledReason={!mine && n.trim().length < 3 ? 'Write a note first.' : undefined} onClick={() => pl.run(() => adapt(actions.decidePlan(c.id, false, n)), mine ? 'Proposal withdrawn.' : 'Plan change rejected.')}>{mine ? 'Withdraw' : 'Reject'}</Button>
            </div>
          </div>
        );
      })}
      <RunMsg msg={pl.msg} />
    </div>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="saas-page">
      {head}
      <KpiStrip
        data-testid="saas-kpis"
        label="Merchant billing states"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Free, billing off', value: String(d?.counts.free_off ?? '—') },
          { label: 'In free trial', value: String(d?.counts.trial ?? '—') },
          { label: 'Paying', value: String(d?.counts.paying ?? '—') },
          { label: 'In grace', value: String(d?.counts.grace ?? '—') },
          { label: 'Pushes paused', value: String(d?.counts.paused ?? '—') },
          { label: 'Free forever (internal)', value: String(d?.counts.free_forever ?? '—') },
        ]}
      />
      {state === 'loading' ? null : (
        <Tabs
          data-testid="saas-tabs"
          label="SaaS billing sections"
          value={tab}
          onChange={(t) => setTab(t as Tab)}
          items={SAAS_TABS.map(([t, label]) => ({
            id: t,
            label,
            count: t === 'merchants' ? d?.merchants.length : t === 'plans' ? d?.plans.length : t === 'history' ? d?.history.length : undefined,
            panel:
              t === 'overview' ? overview : t === 'plans' ? plans : t === 'merchants' ? (
                <OctopusDataGrid<Merchant>
                  label="Per-merchant overrides"
                  data-testid="saas-merchants-grid"
                  rows={d?.merchants ?? []}
                  columns={merchantCols}
                  getRowId={(m) => m.org_id}
                  emptyTitle="No Dropship merchants yet"
                  headingLevel={2}
                  onOpenRow={(m) => setOv(m.org_id)}
                  onOpenInDrawer={(m) => setOv(m.org_id)}
                  rowActions={(m) => [{ id: 'ov', label: m.override ? 'Change or remove override' : 'Add override', onSelect: () => setOv(m.org_id), disabled: !can, disabledReason: noFinance ?? undefined }]}
                  searchPlaceholder="Search merchant"
                  pagination
                />
              ) : (
                <Card headingLevel={2} title="Billing history" data-testid="saas-history">
                  {!d?.history.length ? <p className="m-0 text-ods-small text-ods-slate">No changes yet.</p> : (
                    <Timeline label="Billing history" items={d.history.map((h, i) => ({ id: String(i), title: SAAS_ACTION_LABEL[h.action] ?? h.action, actor: h.actor_name ?? 'System', date: h.created_at, description: h.details && (h.details as Record<string, unknown>).reason ? String((h.details as Record<string, unknown>).reason) : undefined, state: 'done' as const }))} />
                  )}
                </Card>
              ),
          }))}
        />
      )}
      {merchant ? <OverrideDrawer key={merchant.org_id} m={merchant} can={can} onClose={() => setOv(null)} actions={actions} onDone={done} /> : null}
      {planOpen ? <PlanDrawer onClose={() => setPlanOpen(false)} actions={actions} onDone={done} /> : null}
    </div>
  );
}

function OverrideDrawer({ m, can, onClose, actions, onDone }: { m: Merchant; can: boolean; onClose: () => void; actions: SaasActions; onDone: () => void }) {
  const [kind, setKind] = useState<'free_forever' | 'extra_trial'>('extra_trial');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const q = useRun(onDone);
  const short = reason.trim().length < 3;
  return (
    <Drawer open onClose={onClose} width={460} data-testid="override-drawer" title={m.name} description={`${PLAN_STATUS_LABEL[m.status] ?? m.status} · ${overrideText(m)}`}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button loading={q.pending} disabled={!can || short} disabledReason={!can ? 'Only company-wide Finance approvers and admins can change plan fees.' : short ? 'Enter the reason.' : undefined} onClick={() => q.run(() => adapt(actions.setOverride(m.org_id, kind, kind === 'extra_trial' ? Number(days) : null, reason)), 'Override saved.')}>Save override</Button>
          {m.override ? <Button variant="secondary" disabled={!can || short} disabledReason={short ? 'Enter the reason.' : undefined} onClick={() => q.run(() => adapt(actions.removeOverride(m.org_id, reason)), 'Override removed.')}>Remove override</Button> : null}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Override" hint={kind === 'free_forever' && !m.credit_eligible ? 'Only for Octopus group companies and test accounts.' : undefined}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'free_forever' | 'extra_trial')} disabled={!can}>
            <option value="extra_trial">Longer trial</option>
            {m.credit_eligible ? <option value="free_forever">Free forever</option> : null}
          </Select>
        </Field>
        {kind === 'extra_trial' ? <Field label="Extra trial days" hint="1 to 365"><Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} disabled={!can} /></Field> : null}
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!can} /></Field>
        <p className="m-0 text-ods-small text-ods-slate">Free forever is only for Octopus group companies and test accounts, the same rule as Pay later (the database refuses others).</p>
        <RunMsg msg={q.msg} />
      </div>
    </Drawer>
  );
}

function PlanDrawer({ onClose, actions, onDone }: { onClose: () => void; actions: SaasActions; onDone: () => void }) {
  const [p, setP] = useState({ code: '', name: '', description: '', price: '', live: '', stores: '', orders: '', sort: '10', active: false, features: [] as string[] });
  const [reason, setReason] = useState('');
  const q = useRun(onDone);
  const cents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
  const int = (v: string) => (v.trim() === '' ? null : Math.trunc(Number(v)));
  const blocked = !p.code || !p.name ? 'Enter the plan code and name.' : reason.trim().length < 3 ? 'Enter the reason.' : null;
  const save = () =>
    q.run(
      () =>
        adapt(
          actions.proposePlan(
            { code: p.code.trim(), name: p.name, description: p.description || undefined, price_cents: cents(p.price), live_products_limit: int(p.live), stores_limit: int(p.stores), orders_month_limit: int(p.orders), features: p.features as PlanInput['features'], sort_order: Number(p.sort) || 10, active: p.active },
            reason,
          ),
        ),
      'Plan change proposed. A second Finance user or admin must approve.',
    );
  return (
    <Drawer open onClose={onClose} width={460} data-testid="plan-drawer" title="Propose plan" description="Plans, prices and limits need a second approver." onSave={blocked ? undefined : save}
      footer={<div className="flex gap-2"><Button onClick={save} loading={q.pending} disabled={!!blocked || q.msg?.ok} disabledReason={blocked ?? undefined}>Propose plan</Button><Button variant="secondary" onClick={onClose}>Close</Button></div>}>
      <div className="flex flex-col gap-3">
        <Field label="Plan code" hint="e.g. growth"><Input value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} /></Field>
        <Field label="Plan name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Price per month (US$)" hint="Empty = not set"><NumberInput value={p.price} onValueChange={(v) => setP({ ...p, price: v })} min={0} decimals={2} prefix="US$" className="text-end" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Connected stores" hint="Empty = no limit"><Input type="number" min={1} value={p.stores} onChange={(e) => setP({ ...p, stores: e.target.value })} /></Field>
          <Field label="Live products" hint="Empty = no limit"><Input type="number" min={1} value={p.live} onChange={(e) => setP({ ...p, live: e.target.value })} /></Field>
          <Field label="Orders per month" hint="Notice only"><Input type="number" min={1} value={p.orders} onChange={(e) => setP({ ...p, orders: e.target.value })} /></Field>
          <Field label="Order on the page"><Input type="number" value={p.sort} onChange={(e) => setP({ ...p, sort: e.target.value })} /></Field>
        </div>
        <Field label="Description (optional)"><Input value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
          <legend className="mb-1 text-ods-label font-semibold text-ods-navy">Features shown on the plan</legend>
          {Object.entries(PLAN_FEATURE_LABELS).map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={p.features.includes(k)} onChange={(e) => setP({ ...p, features: e.target.checked ? [...p.features, k] : p.features.filter((x) => x !== k) })} /> {label}</label>
          ))}
        </fieldset>
        <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={p.active} disabled={!p.price} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Offer this plan to merchants{!p.price ? ' (set a price first)' : ''}</label>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <RunMsg msg={q.msg} />
      </div>
    </Drawer>
  );
}
