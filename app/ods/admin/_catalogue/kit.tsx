'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Breadcrumbs, Button, Modal, StatusPill, Textarea, cx } from '@octopus/ui';
import { stepUpRedirect } from '@/lib/staff/step-up';
import type { Pill } from './core';

/** Shared bits for the Catalogue screens (compact ODS, one H1 per page). */

export function PageHead({ crumbs, title, subtitle, actions }: { crumbs: { label: string; href?: string }[]; title: string; subtitle: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={crumbs} />
        <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">{title}</h1>
        <p className="m-0 max-w-[900px] text-ods-small text-ods-slate">{subtitle}</p>
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

export const PillView = ({ p, testId }: { p: Pill; testId?: string }) => <StatusPill tone={p.tone} data-testid={testId}>{p.label}</StatusPill>;

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 border-b border-ods-line py-1.5 text-ods-small last:border-b-0">
      <dt className="text-ods-slate">{k}</dt>
      <dd className="m-0 min-w-0 break-words text-ods-text">{children}</dd>
    </div>
  );
}

type AnyRes = { ok: boolean; error?: string; message?: string };
/** Runs one of today's actions, keeps its message, refreshes on success (unless fixture). */
export function useRun(onDone?: () => void) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (p: () => Promise<AnyRes>, okText = 'Saved') =>
    start(async () => {
      try {
        const r = await p();
        // today's goStepUp: a stale 2-step code sends the user to /staff/verify and back here
        if (!r.ok && r.error === 'STEP_UP_REQUIRED') {
          window.location.assign((r as { redirect?: string }).redirect ?? stepUpRedirect(window.location.pathname + window.location.search));
          return;
        }
        setMsg(r.ok ? { ok: true, text: r.message || okText } : { ok: false, text: r.error ?? 'Not saved.' });
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

/** Confirm (or reason / note) modal — replaces today's window.confirm / prompt with the same words. */
export function useConfirm() {
  const [ask, setAsk] = useState<{ title: string; text?: string; confirmLabel: string; destructive?: boolean; input?: { label: string; required: boolean }; onYes: (value: string) => void } | null>(null);
  const [value, setValue] = useState('');
  const open = (a: NonNullable<typeof ask>) => {
    setValue('');
    setAsk(a);
  };
  const node = (
    <Modal
      open={!!ask}
      onClose={() => setAsk(null)}
      title={ask?.title ?? ''}
      description={ask?.text}
      destructive={ask?.destructive}
      confirmLabel={ask?.confirmLabel ?? 'Confirm'}
      onConfirm={() => {
        if (!ask) return;
        if (ask.input?.required && !value.trim()) return;
        const a = ask;
        setAsk(null);
        a.onYes(value.trim());
      }}
    >
      {ask?.input ? (
        <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          {ask.input.label}
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
        </label>
      ) : null}
    </Modal>
  );
  return { open, node };
}

export function NoPermission({ crumbs, title, what }: { crumbs: { label: string; href?: string }[]; title: string; what: string }) {
  return (
    <div className="flex flex-col gap-4" data-testid="no-permission">
      <PageHead crumbs={crumbs} title={title} subtitle={`You don’t have permission to see ${what}.`} />
      <Note tone="info">Ask an admin if you need access.</Note>
    </div>
  );
}

export const LinkButton = ({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) => (
  <a href={href} data-testid={testId} className="inline-flex h-ods-control items-center gap-1.5 rounded-ods-control border border-ods-line-strong bg-ods-surface px-3 text-ods-body font-semibold text-ods-navy no-underline hover:border-ods-navy">
    {children}
  </a>
);
export { Button };
