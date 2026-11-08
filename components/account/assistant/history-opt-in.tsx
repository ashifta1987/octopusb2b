'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { setAssistantHistoryOptIn } from '@/lib/assistant/actions';

/** "Let Octo use my chat history to improve its answers" (SPEC §20.6). Unchecking anonymises old sessions. */
export function HistoryOptIn({ initialOptIn }: { initialOptIn: boolean }) {
  const [on, setOn] = useState(initialOptIn);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <label className="flex gap-2.5 items-start text-[12px] text-black leading-normal">
        <input type="checkbox" checked={on} disabled={pending} className="w-[18px] h-[18px] mt-px flex-none accent-coral-text"
          onChange={(e) => {
            const next = e.target.checked;
            if (!next && !window.confirm('Stop using your chat history? Titles and page context of your past conversations will be anonymised.')) return;
            setErr(null);
            setOn(next);
            start(async () => { const r = await setAssistantHistoryOptIn(next); if (!r.ok) { setOn(!next); setErr(r.error); } });
          }} />
        <span>Let Octo use my chat history to improve its answers. Managed in <Link href="/legal/privacy" className="underline">Privacy</Link>.</span>
      </label>
      {err && <div role="alert" className="text-[12px] text-bad mt-1">{err}</div>}
    </div>
  );
}
