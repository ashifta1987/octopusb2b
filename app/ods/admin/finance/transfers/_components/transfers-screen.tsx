'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileInput, Paperclip, XCircle } from 'lucide-react';
import { Button, Drawer, Field, Input, KpiStrip, Modal, NumberInput, OctopusDataGrid, Select, Tabs, Textarea, formatDate, type GridColumn } from '@octopus/ui';
import type { PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import { TRANSFER_REASONS, OTHER_TEXT_MAX, transferReasonLabel } from '@/lib/core/transfer-reason';
import { TRANSFER_TABS, fmtMinor, toMinor, topupPill, validateProformaTransfer, validateTransferConfirm } from '../../_accounts-b/core';
import { KV, Note, NoPermission, OutcomeNote, PageHead, PillView, RunMsg, useRun } from '../../_accounts-b/kit';
import type { TransferConfirmInput } from '../../_accounts-b/gated-actions';

export type PendingTransfer = { id: string; org_name: string; amount_cents: number; reference: string | null; bank_ref: string | null; slip_url: string | null; created_at: string };
export type DecidedTransfer = {
  id: string; org_name: string; amount_cents: number; amount_received_cents: number | null; reference: string | null; bank_ref: string | null; status: string;
  reject_reason: string | null; received_reason: string | null; received_reason_text: string | null; received_note: string | null; confirmed_at: string | null;
};
export type TransfersActions = {
  confirm: (input: TransferConfirmInput) => Promise<PaymentOutcome>;
  reject: (id: string, reason: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  proforma: (input: { number: string; amount: string; bankRef: string }) => Promise<PaymentOutcome>;
};
export type TransfersScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  pending: PendingTransfer[] | null;
  decided: DecidedTransfer[] | null;
  /** finance:approve — today's proforma transfer action refuses others */
  canRecordProforma: boolean;
  approvalLimitMinor: number | null;
  actions: TransfersActions;
  initialOpen?: string | null;
  initialTab?: 'pending' | 'decided';
  initialProforma?: boolean;
  initialOutcome?: PaymentOutcome | null;
  fixture?: boolean;
};

/**
 * ODS T9 · Accounts › Bank transfers (reconciliation). To confirm: grid → drawer with today's confirm form (amount that
 * arrived, statement reference, reason the customer sees, internal note) and Reject (reason). Proforma paid by transfer:
 * drawer. Confirm and proforma go through the T8 two-person gate, then TODAY's confirmTransfer / recordProformaTransfer.
 */
export function TransfersScreen({ state, pending, decided, canRecordProforma, approvalLimitMinor, actions, initialOpen, initialTab, initialProforma, initialOutcome, fixture }: TransfersScreenProps) {
  const router = useRouter();
  const done = () => !fixture && router.refresh();
  const [tab, setTab] = useState<'pending' | 'decided'>(initialTab ?? 'pending');
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [proforma, setProforma] = useState(!!initialProforma);
  const row = (pending ?? []).find((t) => t.id === open) ?? null;
  const credited = useMemo(() => (decided ?? []).filter((t) => t.status === 'credited'), [decided]);

  if (state === 'forbidden') return <NoPermission crumb="Bank transfers" title="Bank transfers" what="bank transfers (Wallet approve)" />;

  const pendingCols: GridColumn<PendingTransfer>[] = [
    { id: 'reference', header: 'Reference', width: 170, accessor: (t) => t.reference ?? '', cell: (t) => <button type="button" onClick={() => setOpen(t.id)} className="truncate font-mono font-semibold text-ods-navy hover:underline">{t.reference ?? 'No reference'}</button> },
    { id: 'customer', header: 'Customer', width: 200, accessor: (t) => t.org_name },
    { id: 'claimed', header: 'Claimed', currency: 'US$', numeric: true, width: 130, accessor: (t) => t.amount_cents, cell: (t) => fmtMinor(t.amount_cents).replace('US$ ', '') },
    { id: 'custref', header: 'Customer bank ref', width: 160, accessor: (t) => t.bank_ref ?? '', cell: (t) => <span className="font-mono">{t.bank_ref ?? '—'}</span> },
    { id: 'slip', header: 'Slip', width: 120, sortable: false, accessor: (t) => (t.slip_url ? 'yes' : 'no'), cell: (t) => (t.slip_url ? <a href={t.slip_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-ods-info underline"><Paperclip aria-hidden className="size-4" /> Open<span className="sr-only"> transfer slip (opens in a new tab)</span></a> : <span className="font-semibold text-ods-danger">Slip not found</span>) },
    { id: 'sent', header: 'Sent', width: 110, accessor: (t) => t.created_at, cell: (t) => formatDate(t.created_at, { short: true }) },
    { id: 'status', header: 'Status', width: 110, sortable: false, accessor: () => 'pending', cell: () => <PillView p={topupPill('pending')} /> },
  ];
  const decidedCols: GridColumn<DecidedTransfer>[] = [
    { id: 'reference', header: 'Reference', width: 170, accessor: (t) => t.reference ?? '', cell: (t) => <span className="font-mono font-semibold">{t.reference ?? '—'}</span> },
    { id: 'customer', header: 'Customer', width: 190, accessor: (t) => t.org_name },
    { id: 'claimed', header: 'Claimed', currency: 'US$', numeric: true, width: 120, accessor: (t) => t.amount_cents, cell: (t) => fmtMinor(t.amount_cents).replace('US$ ', '') },
    { id: 'received', header: 'Received', currency: 'US$', numeric: true, width: 120, accessor: (t) => t.amount_received_cents ?? 0, cell: (t) => (t.amount_received_cents != null ? fmtMinor(t.amount_received_cents).replace('US$ ', '') : '—') },
    {
      id: 'why',
      header: 'Difference / note',
      width: 240,
      sortable: false,
      accessor: (t) => transferReasonLabel(t.received_reason, t.received_reason_text) ?? '',
      cell: (t) => {
        const why = transferReasonLabel(t.received_reason, t.received_reason_text);
        return <span className="truncate text-ods-small" title={[why ? `Customer sees: ${why}` : null, t.received_note ? `Internal: ${t.received_note}` : null, t.reject_reason].filter(Boolean).join(' · ')}>{why ? `Customer sees: ${why}` : t.reject_reason ?? (t.received_note ? `Internal: ${t.received_note}` : '—')}</span>;
      },
    },
    { id: 'bankref', header: 'Bank reference', width: 150, accessor: (t) => t.bank_ref ?? '', cell: (t) => <span className="font-mono">{t.bank_ref ?? '—'}</span> },
    { id: 'result', header: 'Result', width: 100, accessor: (t) => t.status, cell: (t) => <PillView p={topupPill(t.status)} /> },
    { id: 'when', header: 'When', width: 110, accessor: (t) => t.confirmed_at ?? '', cell: (t) => (t.confirmed_at ? formatDate(t.confirmed_at, { short: true }) : '—') },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="transfers-page">
      <PageHead
        crumb="Bank transfers"
        title="Bank transfers"
        subtitle="Check each transfer on the bank statement. Enter the amount that actually arrived and the bank reference, then confirm; or reject it with a reason the customer sees. No automatic matching."
        actions={
          <Button variant="secondary" iconStart={FileInput} onClick={() => setProforma(true)} disabled={!canRecordProforma} disabledReason={!canRecordProforma ? 'Only Finance (approve) can record proforma payments.' : undefined} data-testid="open-proforma">
            Proforma paid by transfer
          </Button>
        }
      />
      <KpiStrip
        data-testid="transfers-kpis"
        label="Bank transfer figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'To confirm', value: pending ? String(pending.length) : '—', hint: pending ? `${pending.filter((t) => !t.reference).length} without reference` : 'Couldn’t load' },
          { label: 'Claimed, waiting', value: pending ? fmtMinor(pending.reduce((a, t) => a + t.amount_cents, 0)) : '—', hint: 'customers’ claims' },
          { label: 'Credited (recent)', value: decided ? String(credited.length) : '—', hint: decided ? fmtMinor(credited.reduce((a, t) => a + (t.amount_received_cents ?? 0), 0)) : 'Couldn’t load' },
          { label: 'Rejected (recent)', value: decided ? String(decided.filter((t) => t.status === 'failed').length) : '—', hint: 'last 25 decisions' },
        ]}
      />
      <Tabs
        data-testid="transfers-tabs"
        label="Bank transfers"
        value={tab}
        onChange={(t) => setTab(t as 'pending' | 'decided')}
        items={TRANSFER_TABS.map(([t, label]) => ({
          id: t,
          label,
          count: t === 'pending' ? pending?.length : decided?.length,
          panel: () =>
            t !== tab ? null : t === 'pending' ? (
              <div className="pt-3">
                <OctopusDataGrid<PendingTransfer>
                  label="Transfers to confirm"
                  data-testid="transfers-grid"
                  rows={pending ?? []}
                  columns={pendingCols}
                  getRowId={(r) => r.id}
                  rowNumber={(r) => r.reference ?? r.id.slice(0, 8)}
                  loading={state === 'loading'}
                  error={pending === null && state === 'ok' ? 'We couldn’t load the transfers. Try again.' : undefined}
                  onRetry={() => router.refresh()}
                  emptyTitle="Nothing to confirm"
                  emptyDescription="Transfers customers report appear here."
                  headingLevel={2}
                  onOpenRow={(r) => setOpen(r.id)}
                  onOpenInDrawer={(r) => setOpen(r.id)}
                  rowActions={(r) => [{ id: 'open', label: 'Confirm or reject', icon: CheckCircle2, onSelect: () => setOpen(r.id) }]}
                  searchPlaceholder="Search customer or reference"
                  pagination
                  densityToggle
                />
              </div>
            ) : (
              <div className="pt-3">
                <OctopusDataGrid<DecidedTransfer>
                  label="Recently decided transfers"
                  data-testid="transfers-decided-grid"
                  rows={decided ?? []}
                  columns={decidedCols}
                  getRowId={(r) => r.id}
                  loading={state === 'loading'}
                  error={decided === null && state === 'ok' ? 'We couldn’t load the decisions. Try again.' : undefined}
                  emptyTitle="No decisions yet"
                  emptyDescription="Confirmed and rejected transfers appear here."
                  headingLevel={2}
                  searchPlaceholder="Search customer or reference"
                  pagination
                  densityToggle
                />
              </div>
            ),
        }))}
      />
      <ConfirmDrawer key={row?.id ?? 'none'} row={row} approvalLimitMinor={approvalLimitMinor} onClose={() => setOpen(null)} actions={actions} onDone={done} initialOutcome={initialOutcome} />
      {proforma ? <ProformaDrawer onClose={() => setProforma(false)} actions={actions} onDone={done} approvalLimitMinor={approvalLimitMinor} /> : null}
    </div>
  );
}

function LimitNote({ limit, amountMinor }: { limit: number | null; amountMinor: number | null }) {
  if (limit === null) return null;
  const over = amountMinor !== null && amountMinor > limit;
  return <Note tone={over ? 'warning' : 'info'}>Payments over {fmtMinor(limit)} need a second approver.{over ? ' This one goes to Approvals when you confirm.' : ''}</Note>;
}

function ConfirmDrawer({ row, approvalLimitMinor, onClose, actions, onDone, initialOutcome }: { row: PendingTransfer | null; approvalLimitMinor: number | null; onClose: () => void; actions: TransfersActions; onDone: () => void; initialOutcome?: PaymentOutcome | null }) {
  const [received, setReceived] = useState(row ? (row.amount_cents / 100).toFixed(2) : '');
  const [bankRef, setBankRef] = useState('');
  const [reason, setReason] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(initialOutcome ?? null);
  const [pending, start] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectWhy, setRejectWhy] = useState('');
  const rj = useRun(onDone);
  if (!row) return null;
  const receivedMinor = toMinor(received);
  const differs = receivedMinor !== null && receivedMinor !== row.amount_cents;
  const savedOrDone = outcome?.kind === 'saved' || rj.msg?.ok;
  const confirm = () => {
    const bad = validateTransferConfirm({ received, bankRef, reason, reasonText }, row.amount_cents, TRANSFER_REASONS.map((r) => r.value), OTHER_TEXT_MAX);
    setErr(bad);
    if (bad) return;
    start(async () => {
      const r = await actions.confirm({ topupId: row.id, received, bankRef, reason, reasonText, note });
      setOutcome(r);
      if (r.kind === 'step-up') window.location.assign(r.redirect);
      if (r.kind === 'saved') onDone();
    });
  };
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width={460}
        data-testid="transfer-drawer"
        title={row.reference ?? 'Bank transfer'}
        description={`${row.org_name} · claimed ${fmtMinor(row.amount_cents)} · sent ${formatDate(row.created_at)}`}
        onSave={confirm}
        dirty={!savedOrDone && bankRef !== ''}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button iconStart={CheckCircle2} onClick={confirm} loading={pending} loadingText="Saving…" disabled={!!savedOrDone} disabledReason={savedOrDone ? 'Done — close the drawer.' : undefined} data-testid="confirm-transfer">Confirm and credit</Button>
            <Button variant="secondary" iconStart={XCircle} className="text-ods-danger" onClick={() => setRejectOpen(true)} disabled={!!savedOrDone}>Reject</Button>
            <Button variant="ghost" onClick={onClose}>{savedOrDone ? 'Close' : 'Cancel'}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <dl className="m-0">
            <KV k="Customer">{row.org_name}</KV>
            <KV k="Claimed">{fmtMinor(row.amount_cents)}</KV>
            <KV k="Customer reference">{row.bank_ref ?? '—'}</KV>
            <KV k="Slip">{row.slip_url ? <a href={row.slip_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ods-info underline">Open transfer slip<span className="sr-only"> (opens in a new tab)</span></a> : <span className="font-semibold text-ods-danger">Slip not found</span>}</KV>
          </dl>
          <Field label="Amount received (US$)" required hint="What actually arrived on the statement — never the amount claimed.">
            <NumberInput value={received} onValueChange={(v) => setReceived(v)} min={0.01} decimals={2} prefix="US$" className="text-end" data-testid="transfer-received" />
          </Field>
          <Field label="Bank statement reference" required>
            <Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} className="font-mono" autoComplete="off" data-testid="transfer-bankref" />
          </Field>
          {differs ? (
            <>
              <Field label="Reason shown to the customer" required hint="Required when the amount received differs.">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose…</option>
                  {TRANSFER_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
              </Field>
              {reason === 'other' ? (
                <Field label="Short text shown to the customer" required>
                  <Input value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={OTHER_TEXT_MAX} />
                </Field>
              ) : null}
            </>
          ) : null}
          <Field label="Internal note (staff only)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. SCB fee, ticket number" />
          </Field>
          <LimitNote limit={approvalLimitMinor} amountMinor={receivedMinor} />
          <p className="m-0 text-ods-small text-ods-slate">Confirming credits the customer’s wallet with the amount received and issues a receipt. It cannot be undone (a correction needs a separate adjustment).</p>
          {err ? <Note tone="danger" role="alert">{err}</Note> : null}
          <OutcomeNote outcome={outcome} what="open this transfer and confirm it" />
          <RunMsg msg={rj.msg} />
        </div>
      </Drawer>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${row.reference ?? 'transfer'}`}
        description="The customer sees this reason."
        destructive
        confirmLabel="Reject transfer"
        loading={rj.pending}
        onConfirm={() => {
          if (!rejectWhy.trim()) return;
          setRejectOpen(false);
          rj.run(() => actions.reject(row.id, rejectWhy.trim()), 'Rejected. The customer sees the reason.');
        }}
      >
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          Reason (required)
          <Textarea value={rejectWhy} onChange={(e) => setRejectWhy(e.target.value)} rows={3} placeholder="e.g. not on the statement" />
        </label>
      </Modal>
    </>
  );
}

function ProformaDrawer({ onClose, actions, onDone, approvalLimitMinor }: { onClose: () => void; actions: TransfersActions; onDone: () => void; approvalLimitMinor: number | null }) {
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [bankRef, setBankRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    const bad = validateProformaTransfer({ number, amount, bankRef });
    setErr(bad);
    if (bad) return;
    start(async () => {
      const r = await actions.proforma({ number, amount, bankRef });
      setOutcome(r);
      if (r.kind === 'step-up') window.location.assign(r.redirect);
      if (r.kind === 'saved') onDone();
    });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="proforma-drawer"
      title="Proforma paid by transfer"
      description="Make My Brand, 3PL and other service proformas. When the proforma is fully paid its tax invoice is issued automatically."
      onSave={save}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={pending} disabled={outcome?.kind === 'saved'} data-testid="proforma-save">Record payment</Button>
          <Button variant="secondary" onClick={onClose}>{outcome?.kind === 'saved' ? 'Close' : 'Cancel'}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Proforma number" required><Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="PF-2026-000012" className="font-mono" /></Field>
        <Field label="Amount received" required><NumberInput value={amount} onValueChange={(v) => setAmount(v)} min={0.01} decimals={2} className="text-end" /></Field>
        <Field label="Bank statement reference" required hint="Recording the same bank reference twice changes nothing."><Input value={bankRef} onChange={(e) => setBankRef(e.target.value)} className="font-mono" /></Field>
        <LimitNote limit={approvalLimitMinor} amountMinor={toMinor(amount)} />
        <p className="m-0 text-ods-small text-ods-slate">You may be asked for your 2-step code.</p>
        {err ? <Note tone="danger" role="alert">{err}</Note> : null}
        <OutcomeNote outcome={outcome} what="record this proforma payment" />
      </div>
    </Drawer>
  );
}
