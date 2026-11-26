'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsButton, DsTextarea } from '@/components/dropship-ui';
import { replySupportTicketAction } from '../../ds10-actions';

/** Reply box of a support ticket thread (reply_ticket: the company's own ticket; reopens a resolved one). */
export function ThreadReply({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); setSent(false); start(async () => {
      const r = await replySupportTicketAction(ticketId, body);
      if (!r.ok) { setError(r.message); return; }
      setBody(''); setSent(true); router.refresh();
    }); }} data-testid="thread-reply">
      <DsTextarea label="Your reply" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={10000} required error={error ?? undefined} />
      <div className="flex gap-2.5 mt-2 items-center flex-wrap">
        <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="thread-send">Send reply</DsButton>
        {sent && <span role="status" className="text-[13px] text-ok">Reply sent.</span>}
      </div>
    </form>
  );
}
