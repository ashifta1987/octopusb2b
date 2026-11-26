'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAmThresholdAction, setExtraTravellerPriceAction, setPassportRetentionAction } from './actions';

type Msg = { ok: boolean; text: string } | null;
type Res = { ok: boolean; message?: string; error?: string };

/** Turnkey T7 — one admin setting: a labelled input, Save, and the result read out to screen readers. */
export function SettingForm({ id, label, help, initial, inputMode, suffix, allowEmpty = false }: {
  id: 'extra-traveller' | 'retention' | 'threshold'; label: string; help: string; initial: string; inputMode: 'numeric' | 'decimal'; suffix?: string; allowEmpty?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const call = (v: string): Promise<Res> => (id === 'extra-traveller' ? setExtraTravellerPriceAction(v) : id === 'retention' ? setPassportRetentionAction(v) : setAmThresholdAction(v));
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-setting-${id}`}
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await call(value); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' }); if (r.ok) router.refresh(); }); }}>
      <label className="label" htmlFor={`tk-set-${id}`}>{label}</label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex items-center gap-2">
          <input id={`tk-set-${id}`} className="input min-h-11 sm:w-40" inputMode={inputMode} value={value} onChange={(e) => setValue(e.target.value)}
            aria-describedby={`tk-set-${id}-help`} data-testid={`tk-set-${id}-input`} />
          {suffix && <span className="text-[14px] text-muted">{suffix}</span>}
        </div>
        <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || (!allowEmpty && !value.trim())} data-testid={`tk-set-${id}-save`}>Save</button>
      </div>
      <p id={`tk-set-${id}-help`} className="m-0 text-[12.5px] text-muted">{help}</p>
      {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={`tk-set-${id}-msg`}>{msg.text}</p>}
    </form>
  );
}
