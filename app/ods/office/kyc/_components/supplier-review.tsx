'use client';
// ODS T9
/**
 * ODS T9 · Supplier application review (same pattern as the KYC record). Product sheet through a 60-second signed
 * link (the server page signs it after requireStaff('suppliers','view'), as today; the view is logged).
 * Decisions call today's `reviewSupplierApplication` unchanged; the database enforces the two different approvers (DS16).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Modal, Panel, StatusPill, Textarea } from '@octopus/ui';
import { externalHref, SUPPLIER_RAW_LABEL, supplierStatusName, validateSupplierReject, type SupplierDecisionState } from '../_lib/kyc-core';
import { InlineNotice, KeyValueList, SalesPageHead } from '../../_components/sales-bits';
import type { ActionOutcome } from './kyc-review';

export type SupplierReviewProps = {
  reference: string;
  company: string;
  subtitle: string;
  status: string;
  rows: [string, string | null][];
  links: [string, string | null][];
  notes: string | null;
  sheet: { name: string; url: string | null } | null;
  checks: { key: string; ok: boolean; label: string }[];
  decision: SupplierDecisionState;
  lastNote: string | null;
  startReview?: () => Promise<ActionOutcome>;
  decide: (to: 'approved' | 'rejected', note: string) => Promise<ActionOutcome>;
  queueHref: string;
  sample?: boolean;
};

export function SupplierReview(p: SupplierReviewProps) {
  return (
    <div data-testid="kyc-review" className="grid min-w-0 gap-3">
      <SalesPageHead
        crumbs={[{ label: 'Sales' }, { label: 'Supplier applications', href: p.queueHref }, { label: p.reference }]}
        title={p.company}
        meta={<><StatusPill status={supplierStatusName(p.status)} /><span className="text-ods-small text-ods-slate">{SUPPLIER_RAW_LABEL[p.status] ?? p.status}</span></>}
        subtitle={p.subtitle}
      />
      <div className="grid min-w-0 items-start gap-3 ods-desktop:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-3">
          <Panel title="Company" headingLevel={2}>
            <div className="grid gap-3">
              <KeyValueList rows={[
                ...p.rows,
                ...p.links.map(([k, u]) => [k, u ? <a key={k} href={externalHref(u)} target="_blank" rel="noopener noreferrer" className="break-all text-ods-blue underline">{u}</a> : null] as [string, React.ReactNode]),
              ]} />
              {p.notes ? <div><div className="text-ods-small text-ods-slate">Notes</div><p className="m-0 whitespace-pre-wrap text-ods-body">{p.notes}</p></div> : null}
            </div>
          </Panel>
          <Panel title="Product sheet" headingLevel={2} actions={<span className="text-ods-small text-ods-slate">Link expires in 60 s · reload to refresh</span>}>
            {!p.sheet ? <InlineNotice tone="warning">No product sheet was attached.</InlineNotice>
              : p.sheet.url ? <Button variant="secondary" size="sm" href={p.sheet.url} target="_blank">Open {p.sheet.name}</Button>
                : <InlineNotice tone="danger" role="alert">The file could not be found in storage.</InlineNotice>}
          </Panel>
          {p.checks.length ? (
            <Panel title="Checks" headingLevel={2} description="Automatic checks never decide; staff do.">
              <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="application-checks">
                {p.checks.map((c) => (
                  <li key={c.key} className="flex items-center gap-2">
                    <StatusPill tone={c.ok ? 'success' : 'warning'}>{c.ok ? 'Passed' : 'Needs a look'}</StatusPill>
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <SupplierDecision {...p} />
      </div>
    </div>
  );
}

function SupplierDecision(p: SupplierReviewProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approved' | 'rejected' | null>(null);
  const [pending, start] = useTransition();
  const d = p.decision;
  const run = (fn: () => Promise<ActionOutcome>, success: string) => {
    setErr(null); setDone(null);
    start(async () => {
      const r = await fn();
      setConfirm(null);
      if (r && !r.ok) { setErr(r.error ?? 'Failed'); return; }
      setDone(r?.message ?? success); setNote('');
      if (!p.sample) router.refresh();
    });
  };
  return (
    <Panel title="Decision" headingLevel={2} data-testid="kyc-decision">
      <div className="grid gap-3">
        {p.lastNote ? <InlineNotice tone="info">Last note: {p.lastNote}</InlineNotice> : null}
        {d.kind === 'open' && d.firstNote ? <InlineNotice tone="warning" testId="supplier-first-approval">{d.firstNote}</InlineNotice> : null}
        {d.kind !== 'open' ? (
          <p className="m-0 text-ods-small text-ods-slate">{d.text}</p>
        ) : (
          <>
            {d.canStartReview ? <Button variant="secondary" size="sm" loading={pending} onClick={() => p.startReview && run(p.startReview, 'Review started')}>Start review</Button> : null}
            <Field label="Note" optional hint="Internal. Required to reject." error={err && confirm === null && !note.trim() && err.startsWith('Add a reason') ? err : undefined}>
              <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={() => { const v = validateSupplierReject(note); if (v) { setErr(v); return; } setErr(null); setConfirm('rejected'); }}>Reject</Button>
              {d.waitingForSecond ? (
                <span className="text-ods-small text-ods-slate" data-testid="supplier-second-needed">Waiting for a second approver.</span>
              ) : (
                <Button size="sm" onClick={() => { setErr(null); setConfirm('approved'); }}>{d.approveLabel}</Button>
              )}
            </div>
            {err && !err.startsWith('Add a reason') ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
          </>
        )}
        {done ? <InlineNotice tone="success" role="status">{done}</InlineNotice> : null}
        <p className="m-0 text-ods-small text-ods-slate">Two different people approve a new supplier. Approving does not create the supplier: add it in <a href="/admin/suppliers" className="text-ods-blue underline">Admin › Suppliers</a> after the factory audit. Every decision is written to the audit log.</p>
      </div>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'rejected' ? 'Reject this application?' : d.kind === 'open' ? d.approveTitle : 'Approve'}
        description={confirm === 'rejected' ? 'The application is closed as rejected.' : 'The database records your approval; a different colleague gives the other one.'}
        destructive={confirm === 'rejected'}
        confirmLabel={confirm === 'rejected' ? 'Reject application' : 'Approve'}
        loading={pending}
        onConfirm={() => confirm && run(() => p.decide(confirm, note), confirm === 'rejected' ? 'Application rejected' : 'Approval recorded')}
      />
    </Panel>
  );
}
