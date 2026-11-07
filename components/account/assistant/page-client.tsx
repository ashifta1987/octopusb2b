'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { talkToAccountManager } from '@/lib/assistant/actions';
import type { Bootstrap } from '@/lib/assistant/bootstrap';
import { Conversation } from './conversation';

const CAN_DO: [string, string, string][] = [
  ['Track shipments and give delivery ETA', 'Pulls live status from YunExpress', 'Where is my latest shipment and when will it arrive?'],
  ['Compare quotes and tier prices', 'Explains why one is better than another', 'Compare the quotes on my open RFQ'],
  ['Open an RFQ or sample request', 'Fills the form from your context, you confirm', 'Help me open an RFQ for '],
  ['Suggest products and pools', 'Based on your past orders and KYC', 'Which group-buy pools are open that fit my past orders?'],
  ['Answer policy and T&C questions', 'Points to the exact section', 'What do the terms say about '],
];

/** /account/assistant main column: header actions + conversation + "What Octo can do for you". */
export function AssistantPageClient({ boot }: { boot: Bootstrap }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(boot.session?.id ?? null);
  const [key, setKey] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = boot.team?.first_name;
  const fresh = key > 0 && !sessionId;

  const setUrl = (id: string | null) => {
    const u = new URL(window.location.href);
    u.searchParams.set('session', id ?? 'new'); // "new" keeps a blank conversation on reload
    u.searchParams.delete('all');
    window.history.replaceState(null, '', u.toString());
  };

  return (
    <section className="flex-[999_1_520px] min-w-0 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2.5 justify-between items-center">
        <div className="flex gap-3 items-center">
          <span aria-hidden className="w-12 h-12 rounded-[12px] bg-blue-fill text-white flex items-center justify-center font-display font-bold text-[18px]">O</span>
          <div className="flex flex-col gap-0.5">
            <h1 className="m-0 font-display font-extrabold text-[24px] leading-[1.2]">Octo · your account assistant</h1>
            <span className="text-[13px] text-muted">AI-powered · answers in seconds · hands off to a human when it matters</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSessionId(null); setKey((k) => k + 1); setUrl(null); setErr(null); }}>New conversation</button>
          <button type="button" className="btn btn-dark btn-sm" disabled={pending}
            onClick={() => start(async () => {
              setErr(null);
              const r = await talkToAccountManager(sessionId, 'page', window.location.pathname);
              if (!r.ok) { setErr(r.error); return; }
              // reload server state for that session (system handoff notice included); the page remounts on a new session id
              router.replace(`/account/assistant?session=${r.session_id}`);
              router.refresh();
            })}>
            {pending ? 'Connecting…' : `Talk to ${first ?? 'a human'} instead`}
          </button>
        </div>
      </div>
      {err && <div role="alert" className="text-sm text-bad">{err}</div>}

      <Conversation
        key={key}
        channel="page"
        sessionId={sessionId}
        sessionStatus={fresh ? 'bot' : boot.session?.status}
        startedAt={fresh ? null : boot.session?.started_at}
        initialMessages={fresh ? [] : boot.messages}
        onSessionChange={(id) => { setSessionId(id); setUrl(id); }}
        orgName={boot.orgName}
        team={boot.team}
        withinHours={boot.withinHours}
        hoursLabel={boot.hoursLabel}
        counts={boot.counts}
        prefill={prefill}
        className="h-[640px]"
      />

      <section className="card p-5 flex flex-col gap-3" aria-labelledby="help-h">
        <h2 id="help-h" className="m-0 font-display font-bold text-[16px] leading-[1.2]">What Octo can do for you</h2>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {CAN_DO.map(([t, s, prompt]) => (
            <button key={t} type="button" onClick={() => setPrefill({ text: prompt, n: Date.now() })}
              className="text-left px-3 py-2.5 rounded-[10px] bg-white border border-line flex flex-col gap-[3px] hover:border-blue">
              <b className="font-semibold text-[13px]">{t}</b><span className="text-[12px] text-muted">{s}</span>
            </button>
          ))}
          <div className="px-3 py-2.5 rounded-[10px] bg-white border border-line flex flex-col gap-[3px]">
            <b className="font-semibold text-[13px]">Hand off to {first ?? 'your account manager'} for anything delicate</b>
            <span className="text-[12px] text-muted">Refunds, discounts, complaints, legal</span>
          </div>
        </div>
        <p className="m-0 text-[12px] text-muted leading-normal">Octo cannot approve money, change prices, change T&amp;C, or make promises outside the agreed services. For those things a human account manager steps in.</p>
      </section>
    </section>
  );
}
