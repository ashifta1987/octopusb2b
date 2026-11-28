'use client';
// ODS T9
/**
 * ODS T9 · Assistant queue list (SPEC §20.5, Part 7.6): three views of today's queue as status tabs over one grid —
 * Waiting for a human (open escalations, SLA order), My customers (account_managers), Octo unsure (2+ low-confidence
 * turns). Rows open the conversation (?session=). Out of office calls today's setOutOfOffice unchanged.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Checkbox, FilterPills, KpiStrip, OctopusDataGrid, StatusPill, type GridColumn } from '@octopus/ui';
import {
  ASSIGNMENT_LABEL, ASSISTANT_TABS, REASON_PILL_TONE, SESSION_STATUS_LABEL, SESSION_STATUS_TONE, ago, overdueCount, reasonLabel, slaInfo,
  type AssistantResult, type AssistantRow, type AssistantTab,
} from '../_lib/assistant-core';
import { InlineNotice } from '../../_components/sales-bits';

export type AssistantQueueProps = {
  tab: AssistantTab;
  lists: Record<AssistantTab, AssistantRow[]>;
  nowMs: number;
  base: string;
  outOfOffice: boolean;
  team: string | null;
  setOutOfOffice: (v: boolean) => Promise<AssistantResult>;
  loading?: boolean;
  error?: boolean;
  sample?: boolean;
};

export const sessionHref = (base: string, tab: AssistantTab, id: string) => `${base}?session=${encodeURIComponent(id)}${tab !== 'escalations' ? `&tab=${tab}` : ''}`;

/** Live SLA text (re-renders every 30 s); overdue says "Overdue" in words, never colour alone. */
export function SlaText({ due, resolvedAt, nowMs }: { due: string | null; resolvedAt?: string | null; nowMs: number }) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const s = slaInfo(due, now, resolvedAt);
  return <span suppressHydrationWarning className={`font-mono text-ods-small font-semibold ${s.overdue ? 'text-ods-danger' : s.soon ? 'text-ods-warning' : 'text-ods-slate'}`}>{s.text}</span>;
}

export function AssistantQueue({ tab, lists, nowMs, base, outOfOffice, team, setOutOfOffice, loading, error, sample }: AssistantQueueProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ooo, setOoo] = useState(outOfOffice);
  const [oooMsg, setOooMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = lists[tab];
  const go = (h: string) => { if (!sample) start(() => router.push(h)); };

  const customer: GridColumn<AssistantRow> = {
    id: 'customer', header: 'Customer', accessor: (r) => r.orgName, width: 210,
    cell: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-semibold">{r.orgName}</span><span className="truncate font-mono text-ods-small text-ods-slate">{[r.buyerCode, r.country].filter(Boolean).join(' · ')}</span></span>,
  };
  const title: GridColumn<AssistantRow> = { id: 'title', header: 'Conversation', accessor: (r) => r.title, width: 210, cell: (r) => <span className="truncate">{r.title}</span> };
  const last: GridColumn<AssistantRow> = { id: 'last', header: 'Last message', accessor: (r) => r.lastMessageAt ?? '', width: 110, cell: (r) => <span suppressHydrationWarning>{r.sessionId ? ago(r.lastMessageAt, nowMs) : 'No chats'}</span> };
  const cols: Record<AssistantTab, GridColumn<AssistantRow>[]> = {
    escalations: [
      customer, title,
      { id: 'reason', header: 'Reason', accessor: (r) => reasonLabel(r.reason), width: 180, cell: (r) => (r.reason ? <StatusPill tone={REASON_PILL_TONE[r.reason] ?? 'neutral'}>{reasonLabel(r.reason)}</StatusPill> : '—') },
      { id: 'assign', header: 'Owner', accessor: (r) => (r.assignment ? ASSIGNMENT_LABEL[r.assignment] : ''), width: 180, cell: (r) => <span className="flex flex-col leading-tight"><span>{r.assignment ? ASSIGNMENT_LABEL[r.assignment] : '—'}</span>{r.taken ? <span className="text-ods-small text-ods-slate">Taken</span> : null}</span> },
      { id: 'sla', header: 'SLA', accessor: (r) => r.slaDueAt ?? '', width: 130, cell: (r) => <SlaText due={r.slaDueAt} nowMs={nowMs} /> },
      last,
    ],
    mine: [
      customer,
      { id: 'status', header: 'Last conversation', accessor: (r) => r.status ?? '', width: 280, cell: (r) => (r.status ? <span className="flex min-w-0 items-center gap-1.5"><StatusPill tone={SESSION_STATUS_TONE[r.status] ?? 'neutral'}>{SESSION_STATUS_LABEL[r.status] ?? r.status}</StatusPill><span className="truncate text-ods-small text-ods-slate">{r.title}</span></span> : <span className="text-ods-slate">KYC {(r.kycStatus ?? '').replace(/_/g, ' ') || '—'}</span>) },
      last,
    ],
    low: [
      customer, title,
      { id: 'turns', header: 'Low-confidence turns', accessor: (r) => r.lowTurns, numeric: true, width: 170, cell: (r) => <StatusPill tone="warning">{`${r.lowTurns} low turns`}</StatusPill> },
      last,
    ],
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-col gap-1 rounded-ods-card border border-ods-line bg-ods-surface p-3 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
        <Checkbox
          label="Out of office"
          description={ooo ? `New handoffs go to the ${team ?? 'team'} queue until you return.` : `Handoffs for your customers come to you${team ? ` · ${team} team` : ''}.`}
          checked={ooo}
          disabled={pending}
          onCheckedChange={(v) => {
            setOoo(v); setOooMsg(null);
            start(async () => {
              const r = await setOutOfOffice(v);
              if (!r.ok) { setOoo(!v); setOooMsg({ ok: false, text: r.error }); return; }
              setOooMsg({ ok: true, text: r.message ?? 'Saved' });
              if (!sample) router.refresh();
            });
          }}
          data-testid="assistant-ooo"
        />
        {oooMsg ? <span role={oooMsg.ok ? 'status' : 'alert'} className={`text-ods-small ${oooMsg.ok ? 'text-ods-success' : 'text-ods-danger'}`}>{oooMsg.text}</span> : null}
      </div>
      {ooo ? <InlineNotice tone="warning">You are marked <b>out of office</b>. Your customers’ new handoffs are routed to the team queue.</InlineNotice> : null}
      <KpiStrip
        variant="strip"
        label="Assistant queue"
        loading={loading}
        items={[
          { label: 'Waiting for a human', value: lists.escalations.length },
          { label: 'Over SLA', value: overdueCount(lists.escalations, nowMs) },
          { label: 'My customers', value: lists.mine.length },
          { label: 'Octo unsure', value: lists.low.length },
        ]}
      />
      <FilterPills
        label="Queue"
        mode="single"
        allowEmpty={false}
        value={[tab]}
        onChange={(ids) => go(`${base}${ids[0] && ids[0] !== 'escalations' ? `?tab=${ids[0]}` : ''}`)}
        items={ASSISTANT_TABS.map((t) => ({ id: t.id, label: t.label, count: lists[t.id].length }))}
        data-testid="assistant-tabs"
      />
      <OctopusDataGrid
        label={ASSISTANT_TABS.find((t) => t.id === tab)?.label ?? 'Assistant queue'}
        rows={rows}
        columns={cols[tab]}
        getRowId={(r) => r.key}
        rowNumber={(r) => r.buyerCode ?? r.orgName}
        loading={loading || pending}
        error={error ? 'We couldn’t load the assistant queue.' : undefined}
        onRetry={sample ? undefined : () => router.refresh()}
        emptyTitle={tab === 'escalations' ? 'No open handoffs' : tab === 'mine' ? 'No assigned customers' : 'Nothing flagged'}
        emptyDescription={tab === 'escalations' ? 'When Octo hands a customer to a human, it appears here with its SLA.' : tab === 'mine' ? 'Customers are assigned on KYC verification or by an Admin.' : 'Conversations with 2+ low-confidence bot turns in a row show here before they escalate.'}
        onOpenRow={(r, o) => {
          if (!r.sessionId) return;
          const h = sessionHref(base, tab, r.sessionId);
          if (o.newTab) window.open(h, '_blank'); else go(h);
        }}
        defaultSort={tab === 'escalations' ? { id: 'sla', desc: false } : { id: 'last', desc: true }}
        pagination
        headingLevel={2}
        data-testid="assistant-grid"
      />
    </div>
  );
}
