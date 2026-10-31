'use client';
import { useState, useTransition, useRef } from 'react';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';

/* ───────── ConfirmCharge — shows price + wallet balance before any deduction (SPEC §8.2) ───────── */
export function ConfirmCharge({
  label, title, priceCents, balanceCents, walletEnabled, onConfirm, className, buttonClass = 'btn btn-primary',
}: {
  label: string; title: string; priceCents: number; balanceCents: number | null; walletEnabled: boolean;
  onConfirm: () => Promise<{ ok: boolean; error?: string } | void>; className?: string; buttonClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const insufficient = walletEnabled && balanceCents != null && balanceCents < priceCents;
  return (
    <>
      <button type="button" className={cn(buttonClass, className)} onClick={() => { setErr(null); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cc-title">
          <div className="card w-full max-w-md p-6">
            <h2 id="cc-title" className="text-xl font-semibold">{title}</h2>
            <dl className="mt-4 space-y-2 text-[15px]">
              <div className="flex justify-between"><dt className="text-muted">Charge</dt><dd className="mono font-semibold">{usd(priceCents)}</dd></div>
              {walletEnabled ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Wallet balance</dt><dd className="mono">{usd(balanceCents)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Balance after</dt><dd className={cn('mono font-semibold', insufficient && 'text-bad')}>{usd((balanceCents ?? 0) - priceCents)}</dd></div>
                </>
              ) : (
                <p className="text-sm text-muted">The wallet is switched off — this charge will be added to your next invoice / card payment.</p>
              )}
            </dl>
            {insufficient && <p className="mt-3 text-sm text-bad">Insufficient wallet balance. <a href="/account/wallet" className="underline">Top up your wallet</a>.</p>}
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button className="btn btn-primary" disabled={pending || insufficient} onClick={() => start(async () => {
                const r = await onConfirm();
                if (r && !r.ok) setErr(r.error ?? 'Failed'); else setOpen(false);
              })}>{pending ? 'Processing…' : priceCents > 0 ? `Confirm ${usd(priceCents)}` : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ───────── FileDrop ───────── */
export function FileDrop({ name, accept, multiple, hint, onFiles }: { name?: string; accept?: string; multiple?: boolean; hint?: string; onFiles?: (f: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const set = (list: FileList | null) => {
    const arr = Array.from(list ?? []);
    setFiles(arr); onFiles?.(arr);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (ref.current) { ref.current.files = e.dataTransfer.files; } set(e.dataTransfer.files); }}
      className={cn('rounded-[10px] border-2 border-dashed px-4 py-6 text-center cursor-pointer', over ? 'border-blue bg-blue-soft' : 'border-line-2 bg-surface')}
      onClick={() => ref.current?.click()}
    >
      <input ref={ref} type="file" name={name} accept={accept} multiple={multiple} className="sr-only" onChange={(e) => set(e.target.files)} />
      <div className="font-semibold text-sm">{files.length ? files.map((f) => f.name).join(', ') : 'Drop files here or click to browse'}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

/* ───────── DocumentButton — Download PDF + Email me ───────── */
export function DocumentButton({ docId, compact }: { docId: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  return (
    <span className="inline-flex gap-2">
      <a className={cn('btn btn-ghost', compact && 'btn-sm')} href={`/api/documents/${docId}/pdf`} target="_blank" rel="noopener">PDF</a>
      <button type="button" className={cn('btn btn-ghost', compact && 'btn-sm')} disabled={state === 'sending'}
        onClick={async () => {
          setState('sending');
          const r = await fetch(`/api/documents/${docId}/email`, { method: 'POST' });
          setState(r.ok ? 'sent' : 'error');
        }}>
        {state === 'sent' ? 'Queued ✓' : state === 'error' ? 'Retry' : 'Email'}
      </button>
    </span>
  );
}

/* ───────── SubmitButton for server-action forms ───────── */
export function ActionButton({ action, children, className = 'btn btn-primary btn-sm', confirm }: {
  action: () => Promise<{ ok: boolean; error?: string } | void>; children: React.ReactNode; className?: string; confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        setErr(null);
        start(async () => { const r = await action(); if (r && !r.ok) setErr(r.error ?? 'Failed'); });
      }}>{pending ? '…' : children}</button>
      {err && <span className="text-xs text-bad mt-1" role="alert">{err}</span>}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-blue' : 'bg-line-2')}>
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}
