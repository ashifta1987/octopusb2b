'use client';
import { useState, useTransition } from 'react';
import { Switch } from '@/components/client';

/** Optimistic supplier switch; reverts and shows the error when the server action fails. */
export function SupplierSwitch({ initial, label, onToggle }: {
  initial: boolean; label: string; onToggle: (v: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className="inline-flex items-center gap-2">
        <Switch checked={v} label={label} disabled={pending} onChange={(next) => {
          setV(next); setErr(null);
          start(async () => {
            const r = await onToggle(next);
            if (!r.ok) { setV(!next); setErr(r.error ?? 'Failed'); }
          });
        }} />
        <span className="text-xs text-muted w-6" aria-hidden>{v ? 'On' : 'Off'}</span>
      </span>
      {err && <span className="text-xs text-bad max-w-[140px] text-center" role="alert">{err}</span>}
    </span>
  );
}
