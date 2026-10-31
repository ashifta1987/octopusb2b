'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { rateTicket } from '@/app/account/support/actions';

const LABELS = ['Very poor', 'Poor', 'OK', 'Good', 'Excellent'];

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden className={filled ? 'text-[#E0820B]' : 'text-line-2'}>
      <path fill="currentColor" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
    </svg>
  );
}

/** CSAT survey (SPEC §5 ticket: CSAT on resolved). Radio group with text labels — rating never conveyed by colour alone. */
export function SupportCsat({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [value, setValue] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = hover ?? value ?? 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) { setErr('Choose a rating from 1 to 5.'); return; }
        setErr(null);
        start(async () => {
          const r = await rateTicket(ticketId, value);
          if (!r.ok) { setErr(r.error); return; }
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pending}>
        <legend className="font-semibold">How did we do?</legend>
        <p className="text-sm text-muted">Rate the help you received on this ticket.</p>
        <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(null)}>
          {LABELS.map((label, i) => {
            const n = i + 1;
            return (
              <label key={n} className="cursor-pointer rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue" onMouseEnter={() => setHover(n)} title={`${n} – ${label}`}>
                <input type="radio" name="csat" value={n} checked={value === n} onChange={() => setValue(n)} className="sr-only" />
                <Star filled={n <= shown} />
                <span className="sr-only">{n} out of 5 – {label}</span>
              </label>
            );
          })}
          <span className={cn('ml-2 text-sm', shown ? 'font-semibold' : 'text-muted')} aria-live="polite">
            {shown ? `${shown}/5 · ${LABELS[shown - 1]}` : 'No rating yet'}
          </span>
        </div>
        {err && <p className="mt-2 text-sm text-bad" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary btn-sm mt-3">{pending ? 'Sending…' : 'Send rating'}</button>
      </fieldset>
    </form>
  );
}

export function SupportCsatResult({ rating }: { rating: number }) {
  return (
    <div>
      <div className="font-semibold">Your rating</div>
      <div className="mt-2 flex items-center gap-1">
        {LABELS.map((_, i) => <Star key={i} filled={i < rating} />)}
        <span className="ml-2 text-sm font-semibold">{rating}/5 · {LABELS[rating - 1]}</span>
      </div>
      <p className="mt-1 text-sm text-muted">Thank you for your feedback.</p>
    </div>
  );
}
