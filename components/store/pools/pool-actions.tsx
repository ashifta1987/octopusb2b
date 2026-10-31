'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { withdrawPledge } from '@/app/(store)/pool/actions';

/** Withdraw a pledge before the pool fills (confirm dialog; deposit back to the wallet). */
export function WithdrawButton({ pledgeId, code, className = 'btn btn-danger btn-sm' }: { pledgeId: string; code: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (!window.confirm(`Withdraw your pledge from ${code}? Any deposit you paid goes back to your wallet. You can join again while the pool is open.`)) return;
        start(async () => {
          const r = await withdrawPledge(pledgeId);
          setMsg(r.ok ? { ok: true, text: r.message ?? 'Withdrawn' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}>{pending ? 'Withdrawing…' : 'Withdraw pledge'}</button>
      {msg && <span role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</span>}
    </span>
  );
}

/** "Copy link to share" on the pool starter card. */
export function CopyLinkButton({ url, className = 'btn btn-ghost btn-sm w-full' }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Copy this link', url); }
    }}>
      <span aria-live="polite">{copied ? '✓ Link copied' : 'Copy link to share'}</span>
    </button>
  );
}
