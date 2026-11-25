'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsButton } from '@/components/dropship-ui';
import { respondToDropshipRequestQuoteAction } from './actions';

/** EA_Dashboard › Your product requests: Accept / Decline a quoted request (same action as the Requests page). */
export function EaRequestActions({ rfqId, rfqCode }: { rfqId: string; rfqCode: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const respond = (action: 'accept' | 'decline') => start(async () => {
    const res = await respondToDropshipRequestQuoteAction({ rfqId, action });
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    setMsg({ ok: true, text: res.action === 'accepted' ? `Accepted${res.dropshipModelNo ? `: ${res.dropshipModelNo} is only for you` : ''}.` : 'Declined.' });
    router.refresh();
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <DsButton disabled={pending} onClick={() => respond('accept')} testId={`ea-accept-${rfqCode}`} aria-label={`Accept quote ${rfqCode}`}>Accept</DsButton>
      <DsButton variant="secondary" disabled={pending} onClick={() => respond('decline')} testId={`ea-decline-${rfqCode}`} aria-label={`Decline quote ${rfqCode}`}>Decline</DsButton>
      {msg && <span role={msg.ok ? 'status' : 'alert'} className={`text-[12.5px] ${msg.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>{msg.text}</span>}
    </span>
  );
}
