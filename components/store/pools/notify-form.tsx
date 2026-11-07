'use client';
import { useState, useTransition } from 'react';
import { subscribePoolAlerts } from '@/app/(store)/pools/actions';

/** ADDON-36 H3 — email capture shown while no pools are open. */
export function PoolNotifyForm() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      data-testid="pool-notify"
      className="flex flex-wrap gap-2 items-start"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await subscribePoolAlerts(email);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          if (r.ok) setEmail('');
        });
      }}
    >
      <label htmlFor="pool-notify-email" className="sr-only">Email address</label>
      <input id="pool-notify-email" type="email" required autoComplete="email" inputMode="email" placeholder="you@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} className="input flex-1 min-w-[220px] min-h-11" />
      <button type="submit" className="btn btn-dark min-h-11" disabled={pending}>{pending ? 'Saving…' : 'Notify me'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`basis-full text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </form>
  );
}
