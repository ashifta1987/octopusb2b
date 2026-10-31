'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { replyTicket } from '@/app/account/support/actions';

export function SupportReply({ ticketId, reopens }: { ticketId: string; reopens: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (!body.trim()) { setErr('Write a message first.'); return; }
        start(async () => {
          const r = await replyTicket(ticketId, body);
          if (!r.ok) { setErr(r.error); return; }
          setBody('');
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <label className="label" htmlFor="tk-reply">Reply</label>
      <textarea id="tk-reply" className="input py-2.5 min-h-[100px] resize-y" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000}
        placeholder="Write a message to our support team" disabled={pending} />
      {reopens && <p className="text-xs text-muted">This ticket is resolved — replying will reopen it.</p>}
      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</button>
      </div>
    </form>
  );
}
