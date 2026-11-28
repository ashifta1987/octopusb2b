'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button, Field, Icon, Textarea, cx } from '@octopus/ui';
import { rateTicket, replyTicket } from '@/app/account/support/actions';
import { ActionMessage, useRun } from '../../_services/action-kit';

/** Reply to the ticket — TODAY's replyTicket action (reply_ticket RPC, never internal). Replying to a resolved ticket reopens it. */
export function TicketReply({ ticketId, reopens }: { ticketId: string; reopens: boolean }) {
  const { pending, msg, setMsg, run } = useRun();
  const [body, setBody] = useState('');
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      if (!body.trim()) { setMsg({ ok: false, text: 'Write a message first.' }); return; }
      run(async () => { const r = await replyTicket(ticketId, body); return r.ok ? { ok: true, text: 'Sent.' } : { ok: false, text: r.error }; }, () => setBody(''));
    }} data-testid="ticket-reply">
      <Field label="Reply" hint={reopens ? 'This ticket is resolved — replying will reopen it.' : undefined}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={4} disabled={pending} />
      </Field>
      <ActionMessage msg={msg} />
      <div className="flex justify-end"><Button type="submit" loading={pending} loadingText="Sending…">Send reply</Button></div>
    </form>
  );
}

const LABELS = ['Very poor', 'Poor', 'OK', 'Good', 'Excellent'];

/** "How did we do?" on resolved / closed tickets — TODAY's rateTicket action. Rating in words, never colour alone. */
export function TicketRating({ ticketId, rating }: { ticketId: string; rating: number | null }) {
  const { pending, msg, run } = useRun();
  const [value, setValue] = useState<number | null>(null);
  if (rating != null) {
    return <p className="m-0 text-ods-body"><span className="font-semibold">Your rating:</span> {rating}/5 · {LABELS[rating - 1]}. Thank you for your feedback.</p>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (value) run(async () => { const r = await rateTicket(ticketId, value); return r.ok ? { ok: true, text: 'Thank you for your rating.' } : { ok: false, text: r.error }; }); }}>
      <fieldset disabled={pending} className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 font-semibold text-ods-navy">How did we do?</legend>
        <div className="flex flex-wrap gap-1">
          {LABELS.map((label, i) => {
            const n = i + 1;
            const on = value != null && n <= value;
            return (
              <label key={n} className={cx('inline-flex min-h-ods-control cursor-pointer items-center gap-1 rounded-ods-control border px-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ods-focus', value === n ? 'border-ods-blue bg-ods-blue-tint' : 'border-ods-line')}>
                <input type="radio" name="csat" value={n} checked={value === n} onChange={() => setValue(n)} className="sr-only" />
                <Icon icon={Star} size="sm" className={on ? 'fill-current text-ods-warning' : 'text-ods-slate'} />
                <span className="text-ods-small">{n}<span className="sr-only"> out of 5 – {label}</span></span>
              </label>
            );
          })}
        </div>
        <p className="m-0 text-ods-small text-ods-slate" aria-live="polite">{value ? `${value}/5 · ${LABELS[value - 1]}` : 'No rating yet'}</p>
        <ActionMessage msg={msg} />
        <div><Button type="submit" size="sm" disabled={!value} disabledReason={!value ? 'Choose a rating first.' : undefined}>Send rating</Button></div>
      </fieldset>
    </form>
  );
}
