'use client';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { subscribeLaunch, type LaunchFeature } from '@/app/(store)/launch-actions';

const PURPOSE: Record<LaunchFeature, string> = { dropship: 'dropshipping' };

/**
 * "Notify me when it launches" — e-mail capture for features marked Coming soon (migration 203).
 * Has a hidden honeypot field ("website"): people never see or fill it; bots that fill every field are dropped server-side.
 */
export function LaunchNotifyForm({ feature, source, defaultEmail = '', buttonClass = 'btn btn-primary min-h-11' }: { feature: LaunchFeature; source: string; defaultEmail?: string; buttonClass?: string }) {
  const id = useId();
  const [email, setEmail] = useState(defaultEmail);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      data-testid={`launch-notify-${feature}`}
      className="flex flex-wrap gap-2 items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const trap = String(new FormData(e.currentTarget).get('website') ?? '');
        start(async () => {
          const r = await subscribeLaunch(feature, email, source, trap);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          if (r.ok) setEmail('');
        });
      }}
    >
      <label htmlFor={id} className="sr-only">Email address</label>
      <input id={id} type="email" required autoComplete="email" inputMode="email" placeholder="you@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} className="input flex-1 min-w-[220px] min-h-11" />
      {/* honeypot: off-screen, not focusable, hidden from screen readers */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" data-testid="launch-notify-trap" />
      </div>
      <button type="submit" className={buttonClass} disabled={pending}>{pending ? 'Saving…' : 'Notify me when it launches'}</button>
      <p className="basis-full text-[12.5px] text-muted" data-testid="launch-notify-privacy">
        We&rsquo;ll only use your email to tell you when {PURPOSE[feature]} launches. <Link href="/legal/privacy" className="underline hover:text-ink">Privacy policy</Link>
      </p>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`basis-full text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </form>
  );
}
