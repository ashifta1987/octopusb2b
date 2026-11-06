'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { goStepUp } from '@/components/admin/client';
import { changeHsHeading } from './actions';

type Preview = { sku: string; title: string; current_code: string | null }[];

/** Change a type's heading: type 4 digits → preview of affected products → apply. */
export function ChangeHeading({ typeId, current, preview }: { typeId: string; current: string | null; preview: (h: string) => Promise<Preview> }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(current ?? '');
  const [rows, setRows] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Change</button>;
  const valid = /^[0-9]{4}$/.test(h);
  return (
    <div className="space-y-2 min-w-[260px]">
      <div className="flex gap-2 items-center">
        <input className="input mono w-24 min-h-9" value={h} maxLength={4} inputMode="numeric" aria-label="New 4-digit heading"
          onChange={(e) => { setH(e.target.value.replace(/\D/g, '')); setRows(null); }} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!valid || pending} onClick={() => start(async () => setRows(await preview(h)))}>Preview</button>
        <button type="button" className="text-sm text-muted" onClick={() => { setOpen(false); setRows(null); }}>Cancel</button>
      </div>
      {rows && (
        <div className="text-xs border border-line rounded-[8px] p-2 bg-surface" data-testid="hs-change-preview">
          <div className="font-semibold mb-1">{rows.length} product{rows.length === 1 ? '' : 's'} will get {h} (sheet / manual codes are not touched)</div>
          <ul className="max-h-40 overflow-auto space-y-0.5">{rows.map((r) => <li key={r.sku}><span className="mono">{r.sku}</span> {r.current_code ?? '—'} → <b>{h}</b></li>)}</ul>
          <button type="button" className="btn btn-primary btn-sm mt-2" disabled={pending} onClick={() => start(async () => {
            const r = await changeHsHeading(typeId, h);
            if (goStepUp(r)) return;
            setMsg(r.ok ? r.message ?? 'Saved' : r.error); if (r.ok) { setOpen(false); router.refresh(); }
          })}>Apply to {rows.length}</button>
        </div>
      )}
      {msg && <p className="text-xs" role="status">{msg}</p>}
    </div>
  );
}

