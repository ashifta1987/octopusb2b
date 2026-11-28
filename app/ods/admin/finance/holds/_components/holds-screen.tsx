'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, Wallet, XCircle } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, NumberInput, OctopusDataGrid, Select, Tabs, formatDate, type ContextMenuItem, type GridColumn } from '@octopus/ui';
import {
  HOLD_ACTIONS, HOLD_SERVICES, HOLD_TABS, defaultHoldReason, fmtMinor, holdIsOpen, holdNeedsSecond, holdPill, holdRemaining, holdServiceLabel, matchesHoldTab, totalsByCurrency, totalsText,
  type HoldTab,
} from '../../_accounts-b/core';
import { KV, Note, NoPermission, PageHead, PillView, RunMsg, useRun } from '../../_accounts-b/kit';

export type HoldRow = {
  id: string; org_id: string; org_name: string; division_code: string; service: string; target_type: string; target_id: string; order_code: string | null;
  funding_method: string; amount_cents: number; released_cents: number; refunded_cents: number; currency: string; release_rule: string; milestone_label: string;
  status: string; dispute_reason: string | null; invoice_number: string | null; created_at: string;
};
export type HoldApproval = { id: string; hold_id: string; action: string; amount_cents: number; refund_destination: string | null; reason: string; status: string; proposed_by: string; created_at: string };
type ActRes = { ok: boolean; requiresSecondApprover?: boolean; error?: string };
export type HoldsActions = { act: (fd: FormData) => Promise<ActRes>; decide: (fd: FormData) => Promise<{ ok: boolean; error?: string }> };

export type HoldsScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  /** null = failed to load */
  rows: HoldRow[] | null;
  approvals: HoldApproval[];
  meId: string;
  thresholdCents: number;
  actions: HoldsActions;
  initialOpen?: string | null;
  initialMsg?: { ok: boolean; text: string } | null;
  fixture?: boolean;
};

/**
 * ODS T9 · Accounts › Held payments (Payment protection). Grid + record drawer. Execute = today's financeActOnHoldAction
 * (RPC finance_act_on_escrow_hold, which itself queues releases / refunds above the threshold for a second Finance
 * approver); the queue's Approve & execute / Reject = today's decideHoldApprovalAction (proposer ≠ approver, in the DB).
 */
export function HoldsScreen({ state, rows, approvals, meId, thresholdCents, actions, initialOpen, initialMsg, fixture }: HoldsScreenProps) {
  const router = useRouter();
  const [tab, setTab] = useState<HoldTab>('open');
  const [service, setService] = useState('all');
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const done = () => !fixture && router.refresh();
  const q = useRun(done);
  const msg = q.msg ?? initialMsg ?? null;

  const list = useMemo(() => (rows ?? []).filter((h) => matchesHoldTab(h.status, tab) && (service === 'all' || h.service === service)), [rows, tab, service]);
  const openRows = (rows ?? []).filter(holdIsOpen);
  const counts = Object.fromEntries(HOLD_TABS.map(([t]) => [t, (rows ?? []).filter((h) => matchesHoldTab(h.status, t)).length]));
  const row = (rows ?? []).find((h) => h.id === open) ?? null;

  if (state === 'forbidden') return <NoPermission crumb="Held payments" title="Held payments" what="held payments (Finance view)" />;

  const decide = (a: HoldApproval, approve: boolean) => {
    const fd = new FormData();
    fd.set('approval_id', a.id);
    fd.set('approve', approve ? 'true' : 'false');
    q.run(() => actions.decide(fd), 'Two-person decision recorded.');
  };

  const columns: GridColumn<HoldRow>[] = [
    { id: 'ref', header: 'Hold', width: 170, accessor: (h) => h.order_code ?? h.id.slice(0, 8), cell: (h) => <button type="button" onClick={() => setOpen(h.id)} className="truncate font-mono font-semibold text-ods-navy hover:underline">{h.order_code ?? `HLD ${h.id.slice(0, 8)}`}</button> },
    { id: 'customer', header: 'Customer', width: 180, accessor: (h) => h.org_name },
    { id: 'service', header: 'Service', width: 140, accessor: (h) => holdServiceLabel(h.service), cell: (h) => <span><span className="font-mono text-ods-slate">{h.division_code}</span> · {holdServiceLabel(h.service)}</span> },
    { id: 'milestone', header: 'Milestone', width: 180, accessor: (h) => h.milestone_label },
    { id: 'amount', header: 'Held', numeric: true, width: 126, accessor: (h) => h.amount_cents, cell: (h) => fmtMinor(h.amount_cents, h.currency) },
    { id: 'released', header: 'Released', numeric: true, width: 120, accessor: (h) => h.released_cents, cell: (h) => fmtMinor(h.released_cents, h.currency) },
    { id: 'refunded', header: 'Refunded', numeric: true, width: 120, accessor: (h) => h.refunded_cents, cell: (h) => fmtMinor(h.refunded_cents, h.currency) },
    { id: 'remaining', header: 'Remaining', numeric: true, width: 130, accessor: (h) => holdRemaining(h), cell: (h) => <b className="font-semibold">{fmtMinor(holdRemaining(h), h.currency)}</b> },
    { id: 'status', header: 'Status', width: 190, accessor: (h) => h.status, cell: (h) => <PillView p={holdPill(h.status)} /> },
    { id: 'created', header: 'Funded', width: 104, accessor: (h) => h.created_at, cell: (h) => formatDate(h.created_at, { short: true }) },
  ];
  const rowActions = (h: HoldRow): ContextMenuItem[] => [
    { id: 'open', label: holdIsOpen(h) ? 'Release or refund' : 'Open', icon: Wallet, onSelect: () => setOpen(h.id) },
    ...(h.order_code && h.target_type === 'order' ? [{ id: 'order', label: `Open order ${h.order_code}`, icon: ExternalLink, onSelect: () => window.open(`/office/orders/${h.target_id}`, '_blank', 'noopener') }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="holds-page">
      <PageHead
        crumb="Held payments"
        title="Held payments"
        subtitle={`Customer funds held under Payment protection until milestone completion. Releasing funds issues the OCT- tax invoice once and recognises revenue. Releases or refunds above ${fmtMinor(thresholdCents)} need two-person Finance approval.`}
      />
      <KpiStrip
        data-testid="holds-kpis"
        label="Held payment figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Held now', value: totalsText(totalsByCurrency(openRows, holdRemaining, (h) => h.currency)), hint: `${openRows.length} open holds` },
          { label: 'Disputed', value: String((rows ?? []).filter((h) => h.status === 'disputed').length), hint: 'need a decision' },
          { label: 'Waiting for 2nd approver', value: String(approvals.length), hint: `above ${fmtMinor(thresholdCents)}` },
          { label: 'Released', value: totalsText(totalsByCurrency(rows ?? [], (h) => h.released_cents, (h) => h.currency)), hint: 'in this list' },
        ]}
      />
      <RunMsg msg={msg} testId="holds-msg" />

      {approvals.length ? (
        <Card title={`Second approver needed (${approvals.length})`} headingLevel={2} data-testid="hold-approvals-queue">
          <p className="m-0 mb-2 text-ods-small text-ods-slate">Releases and refunds above {fmtMinor(thresholdCents)}. Enforced in the database: the proposer cannot approve their own request.</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {approvals.map((a) => {
              const self = a.proposed_by === meId;
              const h = (rows ?? []).find((x) => x.id === a.hold_id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-ods-body" data-testid="hold-approval">
                  <span className="font-semibold text-ods-navy">{a.action.replace(/_/g, ' ')}</span>
                  <b className="tabular-nums">{fmtMinor(a.amount_cents, 'USD')}</b>
                  {a.refund_destination ? <span className="text-ods-slate">→ {a.refund_destination.replace(/_/g, ' ')}</span> : null}
                  <span className="min-w-0 flex-1 truncate text-ods-slate">{h ? `${h.org_name} · ` : ''}{a.reason}</span>
                  {self ? <span className="text-ods-small text-ods-warning">You proposed this — a second Finance officer must decide.</span> : null}
                  <span className="flex gap-2">
                    <Button size="sm" iconStart={CheckCircle2} disabled={self || q.pending} disabledReason={self ? 'The proposer cannot approve their own request.' : undefined} onClick={() => decide(a, true)}>
                      Approve &amp; execute
                    </Button>
                    <Button size="sm" variant="secondary" iconStart={XCircle} disabled={self || q.pending} disabledReason={self ? 'The proposer cannot decide their own request.' : undefined} onClick={() => decide(a, false)}>
                      Reject
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          Service
          <select value={service} onChange={(e) => setService(e.target.value)} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text">
            <option value="all">All services</option>
            {HOLD_SERVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <Tabs
        data-testid="holds-tabs"
        label="Held payment status"
        value={tab}
        onChange={(t) => setTab(t as HoldTab)}
        items={HOLD_TABS.map(([t, label]) => ({
          id: t,
          label,
          count: rows ? counts[t] : undefined,
          panel: () =>
            t === tab ? (
              <div className="pt-3">
                <OctopusDataGrid<HoldRow>
                  label="Held payments"
                  data-testid="holds-grid"
                  rows={list}
                  columns={columns}
                  getRowId={(h) => h.id}
                  rowNumber={(h) => h.order_code ?? h.id.slice(0, 8)}
                  loading={state === 'loading'}
                  error={rows === null && state === 'ok' ? 'We couldn’t load the held payments. Try again.' : undefined}
                  onRetry={() => router.refresh()}
                  emptyTitle="No held payments match these filters"
                  emptyDescription="Funds paid under Payment protection appear here."
                  headingLevel={2}
                  onOpenRow={(h) => setOpen(h.id)}
                  onOpenInDrawer={(h) => setOpen(h.id)}
                  rowActions={rowActions}
                  searchPlaceholder="Search customer, order or milestone"
                  pagination
                  densityToggle
                />
              </div>
            ) : null,
        }))}
      />

      <HoldDrawer key={row?.id ?? 'none'} row={row} thresholdCents={thresholdCents} onClose={() => setOpen(null)} actions={actions} onDone={done} />
    </div>
  );
}

function HoldDrawer({ row, thresholdCents, onClose, actions, onDone }: { row: HoldRow | null; thresholdCents: number; onClose: () => void; actions: HoldsActions; onDone: () => void }) {
  const rem = row ? holdRemaining(row) : 0;
  const [action, setAction] = useState('release');
  const [amount, setAmount] = useState(row ? (rem / 100).toFixed(2) : '');
  const [dest, setDest] = useState('wallet');
  const [reason, setReason] = useState(row ? defaultHoldReason(row.status) : '');
  const [notice, setNotice] = useState<{ ok: boolean; text: string; second?: boolean } | null>(null);
  const q = useRun();
  if (!row) return null;
  const isOpen = holdIsOpen(row);
  const cents = action === 'release' ? rem : Math.round(Number(amount.replace(/,/g, '')) * 100);
  const amountBad = action !== 'release' && (!(cents > 0) || cents > rem) ? `Enter an amount between ${fmtMinor(1, row.currency)} and ${fmtMinor(rem, row.currency)}.` : null;
  const execute = () => {
    if (amountBad) return;
    const fd = new FormData();
    fd.set('hold_id', row.id);
    fd.set('action', action);
    fd.set('amount_cents', String(cents));
    fd.set('refund_destination', dest);
    fd.set('reason', reason);
    q.run(async () => {
      const r = await actions.act(fd);
      if (r.ok) {
        setNotice(r.requiresSecondApprover ? { ok: true, second: true, text: `Above the ${fmtMinor(thresholdCents)} threshold — queued for a second Finance approver.` } : { ok: true, text: 'Held payment action executed and ledger updated.' });
        onDone();
      }
      return { ok: r.ok, error: r.error, message: r.requiresSecondApprover ? 'Queued for a second Finance approver.' : 'Held payment action executed and ledger updated.' };
    }, 'Done');
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="hold-drawer"
      title={row.order_code ?? `Hold ${row.id.slice(0, 8)}`}
      description={<span className="inline-flex flex-wrap items-center gap-2">{row.org_name} · {holdServiceLabel(row.service)} <PillView p={holdPill(row.status)} /></span>}
      footer={
        isOpen ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={execute} loading={q.pending} loadingText="Saving…" disabled={!!amountBad || !!notice?.ok} disabledReason={amountBad ?? (notice?.ok ? 'Done — close the drawer.' : undefined)} data-testid="hold-execute">
              Execute
            </Button>
            <Button variant="secondary" onClick={onClose}>{notice?.ok ? 'Close' : 'Cancel'}</Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="m-0">
          <KV k="Held">{fmtMinor(row.amount_cents, row.currency)}</KV>
          <KV k="Released">{fmtMinor(row.released_cents, row.currency)}</KV>
          <KV k="Refunded">{fmtMinor(row.refunded_cents, row.currency)}</KV>
          <KV k="Remaining"><b>{fmtMinor(rem, row.currency)}</b></KV>
          <KV k="Milestone rule">{row.milestone_label}</KV>
          <KV k="Funded">{row.funding_method.replace(/_/g, ' ')} · {formatDate(row.created_at)}</KV>
          <KV k="Division">{row.division_code}</KV>
          {row.dispute_reason ? <KV k="Dispute reason"><span className="font-semibold text-ods-warning">{row.dispute_reason}</span></KV> : null}
          {row.invoice_number ? <KV k="Tax invoice">{row.invoice_number}</KV> : null}
        </dl>
        {isOpen ? (
          <>
            <Field label="Action" required>
              <Select value={action} onChange={(e) => setAction(e.target.value)} data-testid="hold-action">
                {HOLD_ACTIONS.map(([v, l]) => <option key={v} value={v}>{v === 'release' ? `${l} (${fmtMinor(rem, row.currency)})` : l}</option>)}
              </Select>
            </Field>
            {action !== 'release' ? (
              <Field label={`Amount (${row.currency})`} required error={amountBad ?? undefined}>
                <NumberInput value={amount} onValueChange={(v) => setAmount(v)} min={0.01} max={rem / 100} decimals={2} className="text-end" data-testid="hold-amount" />
              </Field>
            ) : null}
            {action === 'refund' ? (
              <Field label="Refund destination" required>
                <Select value={dest} onChange={(e) => setDest(e.target.value)}>
                  <option value="wallet">Wallet</option>
                  <option value="original_method">Original method</option>
                </Select>
              </Field>
            ) : null}
            <Field label="Reason / milestone note">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </Field>
            {holdNeedsSecond(cents, thresholdCents) ? <Note tone="warning">Above {fmtMinor(thresholdCents)}: this goes to a second Finance approver when you execute (the database decides).</Note> : null}
            {notice ? <Note tone={notice.second ? 'warning' : 'success'} role="status" testId={notice.second ? 'second-approver-needed' : undefined}>{notice.text}</Note> : <RunMsg msg={q.msg && !q.msg.ok ? q.msg : null} />}
          </>
        ) : (
          <Note tone="info">This hold is {row.status.replace(/_/g, ' ')} — nothing left to release or refund.</Note>
        )}
      </div>
    </Drawer>
  );
}
