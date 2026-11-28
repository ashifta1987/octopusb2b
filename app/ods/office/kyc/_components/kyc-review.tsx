'use client';
// ODS T9
/**
 * ODS T9 · KYC review record (Part 7.6 record pattern): header · company details · documents (fresh 2-step code,
 * 60-second signed links, every view logged — never public links) · decision panel · history.
 * Decisions call today's `reviewKyc` (bound to the submission by the server page) unchanged; the panel only checks the
 * same "message to the customer is required" rule first, so the action / review_kyc() never see an empty message.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActivityFeed, Button, Field, Modal, Panel, Segmented, StatusPill, Textarea, formatDate } from '@octopus/ui';
import {
  KYC_DECISION_CONFIRM, KYC_DECISION_LABEL, kycHistoryItems, kycMessageRequired, kycRawLabel, validateKycDecision,
  type CompanyStatusName, type KycDecision, type KycDecisionState, type KycDocVM, type KycDocsState, type KycHistoryRow,
} from '../_lib/kyc-core';
import { InlineNotice, KeyValueList, SalesPageHead } from '../../_components/sales-bits';

export type ActionOutcome = { ok: boolean; error?: string; message?: string } | void;
export type KycDecideFn = (to: KycDecision, input: { customerMessage: string; internalNote: string }) => Promise<ActionOutcome>;

export type KycReviewProps = {
  title: string;
  account: string | null;
  subtitle: string;
  status: string;
  companyStatus: CompanyStatusName;
  company: [string, string | null][];
  docs: KycDocVM[];
  docsState: KycDocsState;
  /** /staff/verify?next=… (today's StepUpCallout target) */
  stepUpHref: string;
  decision: KycDecisionState;
  lastCustomerMessage: string | null;
  lastInternalNote: string | null;
  history: KycHistoryRow[];
  historyError?: boolean;
  startReview?: () => Promise<ActionOutcome>;
  decide: KycDecideFn;
  queueHref: string;
  sample?: boolean;
};

const DOC_LABEL = (t: string) => {
  const s = t.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function KycReview(p: KycReviewProps) {
  return (
    <div data-testid="kyc-review" className="grid min-w-0 gap-3">
      <SalesPageHead
        crumbs={[{ label: 'Sales' }, { label: 'KYC review', href: p.queueHref }, { label: p.title }]}
        title={p.title}
        meta={<><StatusPill status={p.companyStatus} data-testid="kyc-status" /><span className="text-ods-small text-ods-slate">{kycRawLabel(p.status)}</span></>}
        subtitle={p.subtitle}
      />
      <div className="grid min-w-0 items-start gap-3 ods-desktop:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-3">
          <Panel title="Company details" headingLevel={2} data-testid="kyc-company">
            <KeyValueList rows={p.company} />
          </Panel>
          <DocumentsPanel docs={p.docs} state={p.docsState} stepUpHref={p.stepUpHref} />
        </div>
        <div className="grid min-w-0 gap-3">
          <DecisionPanel {...p} />
          <Panel title="History" headingLevel={2} data-testid="kyc-history">
            {p.historyError ? (
              <InlineNotice tone="danger" role="alert">We couldn’t load the history. Reload to try again.</InlineNotice>
            ) : (
              <ActivityFeed label="KYC history" items={kycHistoryItems(p.history)} emptyTitle="No status changes yet" showTime />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DocumentsPanel({ docs, state, stepUpHref }: { docs: KycDocVM[]; state: KycDocsState; stepUpHref: string }) {
  return (
    <Panel title={`Documents (${docs.length})`} headingLevel={2} actions={<span className="text-ods-small text-ods-slate">Links expire in 60 s · reload to refresh</span>} data-testid="kyc-documents">
      {docs.length === 0 ? (
        <InlineNotice tone="warning">No documents uploaded with this submission.</InlineNotice>
      ) : (
        <div className="grid gap-2">
          {state === 'locked' ? (
            <InlineNotice tone="warning" role="status" testId="kyc-docs-locked">
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">KYC documents need a fresh 2-step code (yours is older than 10 minutes).</span>
                <Button size="sm" href={stepUpHref}>Re-enter your code to view documents</Button>
              </span>
            </InlineNotice>
          ) : null}
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {docs.map((d) => (
              <li key={d.id} className="flex min-h-ods-row items-center gap-3 rounded-ods-control border border-ods-line px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ods-text">{DOC_LABEL(d.type)}</div>
                  <div className="truncate text-ods-small text-ods-slate">{d.fileName} · {formatDate(d.uploadedAt)}</div>
                </div>
                {d.url ? (
                  <Button variant="secondary" size="sm" href={d.url} target="_blank" aria-label={`Open ${DOC_LABEL(d.type)} (new tab, link valid 60 seconds)`}>Open</Button>
                ) : state === 'locked' ? (
                  <span className="text-ods-small text-ods-slate">Locked</span>
                ) : (
                  <span className="text-ods-small text-ods-danger">Unavailable</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function DecisionPanel(p: KycReviewProps) {
  const router = useRouter();
  const [choice, setChoice] = useState<KycDecision>('more_info');
  const [customerMessage, setCustomerMessage] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const d = p.decision;
  const required = kycMessageRequired(choice);

  const run = (fn: () => Promise<ActionOutcome>, success: string, after?: () => void) => {
    setErr(null); setDone(null);
    start(async () => {
      const r = await fn();
      if (r && !r.ok) { setErr(r.error ?? 'Failed'); setConfirming(false); return; }
      setConfirming(false); setDone(r?.message ?? success); after?.();
      if (!p.sample) router.refresh();
    });
  };
  const submit = () => {
    const v = validateKycDecision(choice, customerMessage);
    if (v) { setErr(v); return; }
    if (choice === 'more_info') return run(() => p.decide(choice, { customerMessage: customerMessage.trim(), internalNote: internalNote.trim() }), 'Information requested', reset);
    setErr(null);
    setConfirming(true);
  };
  const reset = () => { setCustomerMessage(''); setInternalNote(''); };

  return (
    <Panel title="Decision" headingLevel={2} data-testid="kyc-decision">
      <div className="grid gap-3">
        {p.lastCustomerMessage ? <InlineNotice tone="info"><b>Last message to customer:</b> {p.lastCustomerMessage}</InlineNotice> : null}
        {p.lastInternalNote ? <InlineNotice tone="warning"><b>Last internal note (staff only):</b> {p.lastInternalNote}</InlineNotice> : null}
        {d.kind !== 'open' ? (
          <p className="m-0 text-ods-small text-ods-slate" data-testid={`kyc-decision-${d.kind}`}>{d.text}</p>
        ) : (
          <>
            {d.canStartReview ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" loading={pending} onClick={() => p.startReview && run(p.startReview, 'Review started')} data-testid="kyc-start-review">Start review</Button>
                <span className="text-ods-small text-ods-slate">Marks it In review so colleagues know you have it.</span>
              </div>
            ) : null}
            <Segmented
              label="Decision"
              fullWidth
              value={choice}
              onChange={(v) => { setChoice(v as KycDecision); setErr(null); }}
              options={d.decisions.map((x) => ({ value: x, label: KYC_DECISION_LABEL[x], testId: `kyc-choice-${x}` }))}
            />
            <Field label="Message to customer" required={required} optional={!required} hint="The customer sees this on their verification page." error={err && required && !customerMessage.trim() ? err : undefined}>
              <Textarea rows={3} maxLength={2000} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)}
                placeholder={choice === 'more_info' ? 'What does the customer need to provide?' : choice === 'rejected' ? 'Why was the verification rejected? What can the customer do next?' : ''} />
            </Field>
            <Field label="Internal note" optional hint="Staff only. Never shown to the customer.">
              <Textarea rows={2} maxLength={2000} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
            </Field>
            {err && !(required && !customerMessage.trim()) ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
            <Button variant={choice === 'rejected' ? 'danger' : 'primary'} loading={pending} onClick={submit} fullWidth data-testid="kyc-submit">
              {KYC_DECISION_LABEL[choice]}
            </Button>
          </>
        )}
        {done ? <InlineNotice tone="success" role="status" testId="kyc-done">{done}</InlineNotice> : null}
        <p className="m-0 text-ods-small text-ods-slate">Approval unlocks live API keys and wallet withdrawals for this customer. Every decision is written to the audit log.</p>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={choice === 'verified' ? 'Approve this company?' : 'Reject this verification?'}
        description={choice === 'verified' ? `${p.title} becomes Verified: live API keys and wallet withdrawals unlock.` : 'The customer sees your message and can submit again.'}
        destructive={choice === 'rejected'}
        confirmLabel={KYC_DECISION_CONFIRM[choice]}
        loading={pending}
        onConfirm={() => run(() => p.decide(choice, { customerMessage: customerMessage.trim(), internalNote: internalNote.trim() }), choice === 'verified' ? 'Company verified' : 'Verification rejected', reset)}
      />
    </Panel>
  );
}
