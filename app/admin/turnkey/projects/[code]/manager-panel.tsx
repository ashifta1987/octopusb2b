'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCoverAction, setManagerAction } from '../actions';

type Res = { ok: boolean; message?: string; error?: string };

/**
 * Turnkey T3 — account manager panel on the staff project page (design: "One named contact per project, with cover when
 * away"). The primary account manager, and an optional cover with the first and last day; during those days the client
 * sees the cover and the cover can open the project. Turnkey editors change it; everything is audited.
 */
export function ManagerPanel({ projectId, code, managerId, coverId, coverFrom, coverTo, candidates }: {
  projectId: string; code: string; managerId: string | null; coverId: string | null; coverFrom: string | null; coverTo: string | null;
  candidates: { user_id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manager, setManager] = useState(managerId ?? '');
  const [cover, setCover] = useState(coverId ?? '');
  const [from, setFrom] = useState(coverFrom ?? '');
  const [to, setTo] = useState(coverTo ?? '');
  const run = (p: () => Promise<Res>) => start(async () => {
    const r = await p();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) router.refresh();
  });
  const coverChoices = candidates.filter((c) => c.user_id !== (managerId ?? ''));
  return (
    <div className="flex flex-col gap-5" data-testid="tk-manager-panel">
      {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid="tk-manager-msg">{msg.text}</p>}
      <section aria-labelledby="tk-am-h" className="flex flex-col gap-2">
        <h3 id="tk-am-h" className="m-0 text-[15px] font-semibold">Account manager</h3>
        <form onSubmit={(e) => { e.preventDefault(); run(() => setManagerAction(projectId, code, manager)); }} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="label" htmlFor="tk-am">One named contact for the client</label>
            <select id="tk-am" className="input min-h-11" value={manager} onChange={(e) => setManager(e.target.value)} data-testid="tk-am-select">
              <option value="">Not set</option>
              {candidates.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
            </select>
          </div>
          <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || manager === (managerId ?? '')} data-testid="tk-am-save">Save</button></div>
        </form>
      </section>
      <section aria-labelledby="tk-cover-h" className="flex flex-col gap-2">
        <h3 id="tk-cover-h" className="m-0 text-[15px] font-semibold">Cover when away</h3>
        {!managerId && <p className="m-0 text-sm text-muted">Choose the account manager first.</p>}
        {managerId && (
          <form onSubmit={(e) => { e.preventDefault(); run(() => setCoverAction(projectId, code, cover, from, to)); }} className="flex flex-col gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="label" htmlFor="tk-cover">Cover</label>
                <select id="tk-cover" className="input min-h-11" value={cover} onChange={(e) => setCover(e.target.value)} data-testid="tk-cover-select">
                  <option value="">No cover</option>
                  {coverChoices.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="tk-cover-from">First day</label>
                <input id="tk-cover-from" type="date" className="input min-h-11" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!cover} data-testid="tk-cover-from" />
              </div>
              <div>
                <label className="label" htmlFor="tk-cover-to">Last day</label>
                <input id="tk-cover-to" type="date" className="input min-h-11" value={to} onChange={(e) => setTo(e.target.value)} disabled={!cover} data-testid="tk-cover-to" />
              </div>
            </div>
            <p className="m-0 text-[12.5px] text-muted">During these days the client sees the cover as their contact, and the cover can open this project.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-ghost btn-sm min-h-11" data-testid="tk-cover-save"
                disabled={pending || !cover || !from || !to || (cover === (coverId ?? '') && from === (coverFrom ?? '') && to === (coverTo ?? ''))}>Save cover</button>
              {coverId && <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} data-testid="tk-cover-remove"
                onClick={() => run(() => setCoverAction(projectId, code, '', '', ''))}>Remove cover</button>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
