'use client';
import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

export type ActionResult = { ok: boolean; error?: string; message?: string; data?: unknown } | void;

/** Form that posts FormData to a server action, shows the error/success inline and refreshes the route. */
export function ActionForm({
  action, children, submitLabel, submitClass = 'btn btn-primary', className, confirm, resetOnSuccess, extra, onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>; children?: React.ReactNode; submitLabel: React.ReactNode; submitClass?: string;
  className?: string; confirm?: string; resetOnSuccess?: boolean; extra?: React.ReactNode; onDone?: (r: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        setErr(null); setMsg(null);
        start(async () => {
          const r = await action(fd);
          if (r && !r.ok) { setErr(r.error ?? 'Failed'); return; }
          if (r && r.message) setMsg(r.message);
          if (resetOnSuccess) ref.current?.reset();
          onDone?.(r);
          router.refresh();
        });
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button type="submit" className={submitClass} disabled={pending}>{pending ? 'Working…' : submitLabel}</button>
        {extra}
        {err && <span className="text-sm text-bad" role="alert">{err}</span>}
        {msg && <span className="text-sm text-ok" role="status">{msg}</span>}
      </div>
    </form>
  );
}

/** Button that opens a small dialog asking for a reason/note, then calls the action. */
export function ReasonButton({
  action, label, title, placeholder = 'Reason', required = true, className = 'btn btn-ghost btn-sm', confirmLabel = 'Confirm', danger,
}: {
  action: (reason: string) => Promise<ActionResult>; label: React.ReactNode; title: string; placeholder?: string; required?: boolean;
  className?: string; confirmLabel?: string; danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = `rb${useId().replace(/:/g, '')}`;
  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(null); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
          <div className="card w-full max-w-md p-6">
            <h2 id={`${id}-t`} className="text-xl font-semibold">{title}</h2>
            <label htmlFor={`${id}-r`} className="label mt-4">{placeholder}{required && ' *'}</label>
            <textarea id={`${id}-r`} className="input min-h-24 py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className={cn('btn', danger ? 'btn-danger' : 'btn-primary')} disabled={pending || (required && !reason.trim())}
                onClick={() => start(async () => {
                  const r = await action(reason.trim());
                  if (r && !r.ok) { setErr(r.error ?? 'Failed'); return; }
                  setOpen(false); setReason(''); router.refresh();
                })}>{pending ? 'Working…' : confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Simple confirmed action button that refreshes the route on success. */
export function RunButton({ action, children, className = 'btn btn-ghost btn-sm', confirm }: {
  action: () => Promise<ActionResult>; children: React.ReactNode; className?: string; confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        setErr(null);
        start(async () => { const r = await action(); if (r && !r.ok) setErr(r.error ?? 'Failed'); else router.refresh(); });
      }}>{pending ? '…' : children}</button>
      {err && <span className="text-xs text-bad mt-1" role="alert">{err}</span>}
    </span>
  );
}
