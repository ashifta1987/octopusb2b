'use client';

import { useState, useTransition } from 'react';
import { DROPSHIP_FEATURES, type DropshipFeatures } from '@/lib/dropship-features-shared';
import { saveDropshipFeaturesAction } from './actions';

export function DropshipFeaturesClient({ initial, canEdit }: { initial: DropshipFeatures; canEdit: boolean }) {
  const [f, setF] = useState<DropshipFeatures>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = DROPSHIP_FEATURES.some((x) => f[x.key] !== initial[x.key]);
  return (
    <form className="flex flex-col gap-4" data-testid="dropship-features-form" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveDropshipFeaturesAction(f);
        setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Could not save.' });
      });
    }}>
      <fieldset className="card p-0 overflow-hidden" disabled={!canEdit || pending}>
        <legend className="sr-only">Merchant features</legend>
        <ul className="list-none m-0 p-0">
          {DROPSHIP_FEATURES.map((x) => (
            <li key={x.key} className="flex items-center justify-between gap-4 px-4 min-h-[52px] border-b border-line last:border-0">
              <label htmlFor={`feat-${x.key}`} className="text-[15px] text-ink">
                {x.label}
                {x.locked && <span className="block text-[12.5px] text-black/70">Always on in early access</span>}
              </label>
              <input
                id={`feat-${x.key}`}
                type="checkbox"
                role="switch"
                aria-checked={f[x.key]}
                className="w-5 h-5 accent-coral"
                checked={f[x.key]}
                disabled={x.locked}
                data-testid={`feature-${x.key}`}
                onChange={(e) => setF({ ...f, [x.key]: e.target.checked })}
              />
            </li>
          ))}
        </ul>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary min-h-11" disabled={pending || !changed}>Save features</button>
          {!changed && <span className="text-[13px] text-black/70">No changes to save</span>}
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </form>
  );
}
