'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Breadcrumbs, StatusPill, cx } from '@octopus/ui';
import type { PaymentOutcome } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import type { Pill } from './core';

/** Shared bits for the Accounts part B screens (compact ODS, one H1 per page). */

export function PageHead({ crumb, title, subtitle, actions }: { crumb: string; title: string; subtitle: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={[{ label: 'Accounts', href: '/admin/finance' }, { label: crumb }]} />
        <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">{title}</h1>
        <p className="m-0 max-w-[880px] text-ods-small text-ods-slate">{subtitle}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Note({ tone, children, testId, role }: { tone: 'warning' | 'danger' | 'success' | 'info'; children: ReactNode; testId?: string; role?: 'alert' | 'status' }) {
  const t = { warning: 'border-ods-warning/30 bg-ods-warning-tint text-ods-warning', danger: 'border-ods-danger/30 bg-ods-danger-tint text-ods-danger', success: 'border-ods-success/30 bg-ods-success-tint text-ods-success', info: 'border-ods-blue/30 bg-ods-info-tint text-ods-info' }[tone];
  return (
    <div role={role} data-testid={testId} className={cx('rounded-ods-control border px-3 py-2 text-ods-small font-medium', t)}>
      {children}
    </div>
  );
}

export function PillView({ p, testId }: { p: Pill; testId?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {p.status ? <StatusPill status={p.status} data-testid={testId} /> : <StatusPill tone={p.tone ?? 'neutral'} data-testid={testId}>{p.label}</StatusPill>}
      {p.step ? <span className={cx('truncate text-ods-small', p.attention ? 'font-semibold text-ods-danger' : 'text-ods-slate')}>{p.step}</span> : null}
    </span>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-2 border-b border-ods-line py-2 text-ods-small last:border-b-0">
      <dt className="text-ods-slate">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-ods-text">{children}</dd>
    </div>
  );
}

export function NoPermission({ crumb, title, what }: { crumb: string; title: string; what: string }) {
  return (
    <div className="flex flex-col gap-4" data-testid="no-permission">
      <PageHead crumb={crumb} title={title} subtitle={`You don’t have permission to see ${what}.`} />
      <Note tone="info">Ask an admin if you need access. Nothing here can be changed without the permission today’s page uses.</Note>
    </div>
  );
}

/** Outcome line for the two-person-gated money actions (same words as Invoices / Orders). */
export function OutcomeNote({ outcome, what }: { outcome: PaymentOutcome | null; what: string }) {
  if (!outcome) return null;
  if (outcome.kind === 'second-approver')
    return (
      <Note tone="warning" testId="second-approver-needed" role="status">
        <b>Second approver needed ({outcome.code}).</b> A different Finance user must approve it in Approvals. Nothing is recorded yet; once it is approved, {what} again.
      </Note>
    );
  if (outcome.kind === 'saved')
    return (
      <Note tone="success" role="status" testId="money-saved">
        {outcome.message}
        {outcome.approvalCode ? ` · approval ${outcome.approvalCode} used` : ''}
        {outcome.warning ? <span className="mt-1 block text-ods-warning">{outcome.warning}</span> : null}
      </Note>
    );
  return <Note tone="danger" role="alert">{outcome.message}</Note>;
}

type AnyRes = { ok: boolean; error?: string; message?: string };
/** Runs one of today's actions and keeps its message (ok → success text, else the action's error). */
export function useRun(onDone?: () => void) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (p: () => Promise<AnyRes>, okText: string) =>
    start(async () => {
      try {
        const r = await p();
        setMsg(r.ok ? { ok: true, text: r.message ?? okText } : { ok: false, text: r.error ?? r.message ?? 'Not saved.' });
        if (r.ok) onDone?.();
      } catch {
        setMsg({ ok: false, text: 'Something went wrong. Try again.' });
      }
    });
  return { pending, msg, run, clear: () => setMsg(null) };
}
export function RunMsg({ msg, testId }: { msg: { ok: boolean; text: string } | null; testId?: string }) {
  return msg ? <Note tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'} testId={testId}>{msg.text}</Note> : null;
}

export function PanelError({ what }: { what: string }) {
  return <Note tone="danger" role="alert">We couldn’t load {what}. Refresh the page to try again.</Note>;
}
