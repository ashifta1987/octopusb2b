'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, Plus, XCircle } from 'lucide-react';
import { Button, Card, Drawer, Field, Input, KpiStrip, NumberInput, OctopusDataGrid, Select, Tabs, Textarea, formatDate, type GridColumn } from '@octopus/ui';
import { CREDIT_TABS, NET_DAYS, creditAvailable, creditPill, fmtMinor, human, matchesCreditTab, totalsByCurrency, totalsText, type CreditTab } from '../../_accounts-b/core';
import { KV, Note, NoPermission, PageHead, PillView, RunMsg, useRun } from '../../_accounts-b/kit';

export type CreditRow = {
  id: string; org_id: string; org_name: string; kyc_status: string; division_id: string | null; division_code: string; credit_limit_cents: number; currency: string;
  net_days: number; status: string; overdue_blocked: boolean; proposed_by: string; approved_by: string | null; note: string | null; unpaid_invoices_cents: number; reserved_cents: number; updated_at: string;
};
export type StatementRow = { id: string; number: string; org_name: string; legal_entity_code: string; legal_entity_name: string; invoice_count: number; sample_count: number; amount_cents: number; paid_cents: number; currency: string; status: string; created_at: string };
export type OrgOption = { id: string; name: string; kyc_status: string; credit_eligible?: boolean };
type R = { ok: boolean; error?: string };
export type CreditActions = {
  propose: (fd: FormData) => Promise<R>;
  decide: (fd: FormData) => Promise<R>;
  statement: (fd: FormData) => Promise<R & { statementNumber?: string; invoiceCount?: number; sampleCount?: number }>;
};

export type CreditScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  rows: CreditRow[] | null;
  statements: StatementRow[];
  orgs: OrgOption[];
  divisions: { id: string; code: string; name: string }[];
  meId: string;
  actions: CreditActions;
  initialOpen?: string | null;
  initialPropose?: boolean;
  fixture?: boolean;
};

/**
 * ODS T9 · Accounts › Credit terms (Pay later). Credit lines grid + record drawer (Approve / Reject = today's
 * decideCreditTermsAction; credit limits ALWAYS need a second Finance approver, enforced in the database), Propose drawer
 * (today's proposeCreditTermsAction), Dropshipping weekly statements (today's generateDropshipStatementAction).
 */
export function CreditScreen({ state, rows, statements, orgs, divisions, meId, actions, initialOpen, initialPropose, fixture }: CreditScreenProps) {
  const router = useRouter();
  const done = () => !fixture && router.refresh();
  const [tab, setTab] = useState<CreditTab>('all');
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [propose, setPropose] = useState(!!initialPropose);
  const st = useRun(done);
  const [stOrg, setStOrg] = useState(orgs[0]?.id ?? '');

  const list = useMemo(() => (rows ?? []).filter((t) => matchesCreditTab(t.status, tab)), [rows, tab]);
  const counts = Object.fromEntries(CREDIT_TABS.map(([t]) => [t, (rows ?? []).filter((r) => matchesCreditTab(r.status, t)).length]));
  const active = (rows ?? []).filter((t) => t.status === 'active');
  const row = (rows ?? []).find((t) => t.id === open) ?? null;

  if (state === 'forbidden') return <NoPermission crumb="Credit terms" title="Credit terms" what="credit terms (Finance view)" />;

  const columns: GridColumn<CreditRow>[] = [
    { id: 'customer', header: 'Customer', width: 200, accessor: (t) => t.org_name, cell: (t) => <button type="button" onClick={() => setOpen(t.id)} className="truncate font-semibold text-ods-navy hover:underline">{t.org_name}</button> },
    { id: 'kyc', header: 'KYC', width: 110, accessor: (t) => t.kyc_status, cell: (t) => human(t.kyc_status) },
    { id: 'division', header: 'Division', width: 90, accessor: (t) => t.division_code, cell: (t) => <span className="font-mono">{t.division_code}</span> },
    { id: 'terms', header: 'Terms', width: 84, accessor: (t) => t.net_days, cell: (t) => `Net ${t.net_days}` },
    { id: 'limit', header: 'Limit', numeric: true, width: 124, accessor: (t) => t.credit_limit_cents, cell: (t) => fmtMinor(t.credit_limit_cents, t.currency) },
    { id: 'unpaid', header: 'Unpaid invoices', numeric: true, width: 136, accessor: (t) => t.unpaid_invoices_cents, cell: (t) => fmtMinor(t.unpaid_invoices_cents, t.currency) },
    { id: 'reserved', header: 'Reserved orders', numeric: true, width: 136, accessor: (t) => t.reserved_cents, cell: (t) => fmtMinor(t.reserved_cents, t.currency) },
    { id: 'available', header: 'Available', numeric: true, width: 124, accessor: (t) => creditAvailable(t), cell: (t) => <b className="font-semibold text-ods-success">{fmtMinor(creditAvailable(t), t.currency)}</b> },
    { id: 'status', header: 'Status', width: 230, accessor: (t) => t.status, cell: (t) => <span className="inline-flex items-center gap-1.5"><PillView p={creditPill(t.status)} />{t.overdue_blocked ? <span className="text-ods-small font-semibold text-ods-danger">Overdue blocked</span> : null}</span> },
    { id: 'updated', header: 'Updated', width: 100, accessor: (t) => t.updated_at, cell: (t) => formatDate(t.updated_at, { short: true }) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="credit-page">
      <PageHead
        crumb="Credit terms"
        title="Credit terms"
        subtitle="Customer credit limits per division and Net payment terms (7, 15, 30, 45, 60 days). Credit limits always need two-person Finance approval. Wallet balance is separate from Pay-later credit."
        actions={<Button iconStart={Plus} onClick={() => setPropose(true)} data-testid="propose-credit">Propose credit terms</Button>}
      />
      <KpiStrip
        data-testid="credit-kpis"
        label="Credit figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Active credit lines', value: String(active.length), hint: 'approved by two people' },
          { label: 'Waiting for approval', value: String((rows ?? []).filter((t) => t.status === 'pending_approval').length), hint: 'second Finance approver' },
          { label: 'Total limits', value: totalsText(totalsByCurrency(active, (t) => t.credit_limit_cents, (t) => t.currency)), hint: 'active lines' },
          { label: 'Available', value: totalsText(totalsByCurrency(active, creditAvailable, (t) => t.currency)), hint: 'limit − unpaid − reserved' },
          { label: 'Overdue blocked', value: String((rows ?? []).filter((t) => t.overdue_blocked).length), hint: 'Pay later paused' },
        ]}
      />
      <Tabs
        data-testid="credit-tabs"
        label="Credit line status"
        value={tab}
        onChange={(t) => setTab(t as CreditTab)}
        items={CREDIT_TABS.map(([t, label]) => ({
          id: t,
          label,
          count: rows ? counts[t] : undefined,
          panel: () =>
            t === tab ? (
              <div className="pt-3">
                <OctopusDataGrid<CreditRow>
                  label="Customer credit lines"
                  data-testid="credit-grid"
                  rows={list}
                  columns={columns}
                  getRowId={(r) => r.id}
                  rowNumber={(r) => r.org_name}
                  loading={state === 'loading'}
                  error={rows === null && state === 'ok' ? 'We couldn’t load the credit lines. Try again.' : undefined}
                  onRetry={() => router.refresh()}
                  emptyTitle="No customer credit lines here"
                  emptyDescription="Propose credit terms to give a verified customer Pay later."
                  headingLevel={2}
                  onOpenRow={(r) => setOpen(r.id)}
                  onOpenInDrawer={(r) => setOpen(r.id)}
                  rowActions={(r) => [{ id: 'open', label: r.status === 'pending_approval' ? 'Approve or reject' : 'Open', onSelect: () => setOpen(r.id) }]}
                  searchPlaceholder="Search customer"
                  pagination
                  densityToggle
                />
              </div>
            ) : null,
        }))}
      />

      <Card title="Dropshipping weekly statements (STMT-DS)" headingLevel={2} data-testid="ds-statements">
        <p className="m-0 mb-3 text-ods-small text-ods-slate">Dropshipping Pay-later orders issue one OCT-DS- tax invoice per order at shipment; the weekly STMT-DS- statement consolidates the shipment invoices plus paid sample orders under the active legal entity.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Customer company">
            <Select value={stOrg} onChange={(e) => setStOrg(e.target.value)} className="min-w-[240px]">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Button
            variant="secondary"
            loading={st.pending}
            disabled={!stOrg}
            disabledReason={!stOrg ? 'Choose a customer company.' : undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set('org_id', stOrg);
              st.run(async () => {
                const r = await actions.statement(fd);
                return { ok: r.ok, error: r.error, message: r.ok ? `Dropshipping weekly statement ${r.statementNumber ?? ''} generated (${r.invoiceCount ?? 0} shipment invoices, ${r.sampleCount ?? 0} sample orders).` : undefined };
              }, 'Statement generated.');
            }}
            data-testid="generate-statement"
          >
            Generate weekly statement
          </Button>
        </div>
        <div className="mt-3"><RunMsg msg={st.msg} /></div>
        {statements.length ? (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Dropshipping statements">
            <table className="w-full min-w-[720px] border-collapse text-ods-body">
              <thead>
                <tr className="border-b border-ods-line text-ods-small text-ods-slate">
                  {['Date', 'Statement', 'Merchant', 'Legal entity', 'Lines', 'Total', 'Status', 'PDF'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-start font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id} className="border-b border-ods-line">
                    <td className="px-2 py-1.5">{formatDate(s.created_at, { short: true })}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{s.number}</td>
                    <td className="px-2 py-1.5">{s.org_name}</td>
                    <td className="px-2 py-1.5"><span className="font-mono">{s.legal_entity_code}</span> <span className="text-ods-slate">· {s.legal_entity_name}</span></td>
                    <td className="px-2 py-1.5 tabular-nums">{s.invoice_count} inv · {s.sample_count} sample</td>
                    <td className="px-2 py-1.5 tabular-nums font-semibold">{fmtMinor(s.amount_cents, s.currency)}</td>
                    <td className="px-2 py-1.5">{human(s.status)}</td>
                    <td className="px-2 py-1.5"><a href={`/api/documents/${s.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-ods-info underline"><FileText aria-hidden className="size-4" /> PDF<span className="sr-only"> {s.number} (opens in a new tab)</span></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="m-0 mt-3 text-ods-small text-ods-slate">No statements yet.</p>}
      </Card>

      <CreditDrawer key={row?.id ?? 'none'} row={row} meId={meId} onClose={() => setOpen(null)} actions={actions} onDone={done} />
      {propose ? <ProposeDrawer orgs={orgs} divisions={divisions} onClose={() => setPropose(false)} actions={actions} onDone={done} /> : null}
    </div>
  );
}

function CreditDrawer({ row, meId, onClose, actions, onDone }: { row: CreditRow | null; meId: string; onClose: () => void; actions: CreditActions; onDone: () => void }) {
  const q = useRun(onDone);
  const [note, setNote] = useState('');
  if (!row) return null;
  const self = row.proposed_by === meId;
  const decide = (approve: boolean) => {
    const fd = new FormData();
    fd.set('terms_id', row.id);
    fd.set('approve', approve ? 'true' : 'false');
    fd.set('note', note);
    q.run(() => actions.decide(fd), 'Two-person credit limit decision recorded.');
  };
  const pending = row.status === 'pending_approval';
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="credit-drawer"
      title={row.org_name}
      description={<span className="inline-flex items-center gap-2">{row.division_code === 'ALL' ? 'Company-wide' : row.division_code} · Net {row.net_days} <PillView p={creditPill(row.status)} /></span>}
      footer={
        pending ? (
          <div className="flex flex-wrap gap-2">
            <Button iconStart={CheckCircle2} onClick={() => decide(true)} loading={q.pending} disabled={self || q.msg?.ok} disabledReason={self ? 'You proposed this — credit limits always need a second Finance approver.' : undefined} data-testid="approve-credit">Approve</Button>
            <Button variant="secondary" iconStart={XCircle} onClick={() => decide(false)} disabled={self || q.pending || q.msg?.ok} disabledReason={self ? 'The proposer cannot decide their own proposal.' : undefined}>Reject</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="m-0">
          <KV k="Credit limit">{fmtMinor(row.credit_limit_cents, row.currency)}</KV>
          <KV k="Unpaid invoices">{fmtMinor(row.unpaid_invoices_cents, row.currency)}</KV>
          <KV k="Reserved orders">{fmtMinor(row.reserved_cents, row.currency)}</KV>
          <KV k="Available"><b>{fmtMinor(creditAvailable(row), row.currency)}</b></KV>
          <KV k="KYC">{human(row.kyc_status)}</KV>
          <KV k="Overdue">{row.overdue_blocked ? 'Blocked (overdue invoices)' : 'Not blocked'}</KV>
          <KV k="Note">{row.note ?? '—'}</KV>
          <KV k="Updated">{formatDate(row.updated_at)}</KV>
        </dl>
        {pending ? (
          <>
            <Note tone="warning" testId={self ? 'second-approver-needed' : undefined}>
              {self ? <><b>Second approver needed.</b> You proposed this limit; a different Finance user must approve it (enforced in the database).</> : 'Credit limits always need two people: the proposer cannot approve. Approving activates Pay later for this customer.'}
            </Note>
            <Field label="Decision note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} disabled={self} />
            </Field>
          </>
        ) : null}
        <RunMsg msg={q.msg} />
      </div>
    </Drawer>
  );
}

function ProposeDrawer({ orgs, divisions, onClose, actions, onDone }: { orgs: OrgOption[]; divisions: { id: string; code: string; name: string }[]; onClose: () => void; actions: CreditActions; onDone: () => void }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '');
  const [division, setDivision] = useState('all');
  const [limit, setLimit] = useState('5000');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const q = useRun(onDone);
  const save = () => {
    const fd = new FormData();
    fd.set('org_id', org);
    fd.set('division_id', division);
    fd.set('credit_limit_usd', limit.replace(/,/g, ''));
    fd.set('net_days', days);
    fd.set('note', note);
    q.run(() => actions.propose(fd), 'Credit limit proposal saved — awaiting a second Finance approver.');
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="propose-drawer"
      title="Propose credit terms"
      description="Always two-person approved; the customer must be KYC-verified to check out with Pay later."
      dirty={!q.msg?.ok && note !== ''}
      onSave={save}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={q.pending} disabled={!org || q.msg?.ok} disabledReason={!org ? 'Choose a customer company.' : undefined} data-testid="propose-submit">Propose credit limit</Button>
          <Button variant="secondary" onClick={onClose}>{q.msg?.ok ? 'Close' : 'Cancel'}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Customer company" required>
          <Select value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} (KYC: {o.kyc_status}{o.credit_eligible ? ' · Credit eligible' : ''})</option>)}
          </Select>
        </Field>
        <Field label="Division scope">
          <Select value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="all">Company-wide (all divisions)</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </Select>
        </Field>
        <Field label="Credit limit (US$)" required>
          <NumberInput value={limit} onValueChange={(v) => setLimit(v)} min={0} decimals={2} prefix="US$" className="text-end" />
        </Field>
        <Field label="Net payment terms">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            {NET_DAYS.map((d) => <option key={d} value={d}>Net {d} days</option>)}
          </Select>
        </Field>
        <Field label="Underwriting note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Trade credit rationale" />
        </Field>
        <Note tone="info">Saved as “Waiting”: a different Finance user approves it before it applies.</Note>
        <RunMsg msg={q.msg} testId="propose-msg" />
      </div>
    </Drawer>
  );
}
