'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createClient, subscribeAuthed } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import { confirmAssistantDraft, setAssistantFeedback } from '@/lib/assistant/actions';
import { contextLabel, initials, type AccountTeam, type AssistantDraft, type AssistantMessage, type ContextCounts, type ReplyResponse } from '@/lib/assistant/types';

/** Octo conversation (Assistant.png): bot blue-bordered, customer navy-blue right, staff green, system amber. Shared by /account/assistant and the drawer. */

export type ConversationProps = {
  channel: 'page' | 'drawer';
  sessionId: string | null;
  sessionStatus?: string | null;
  startedAt?: string | null;
  initialMessages: AssistantMessage[];
  onSessionChange?: (id: string) => void;
  orgName: string;
  team: AccountTeam | null;
  withinHours: boolean;
  hoursLabel: string | null;
  counts?: ContextCounts | null;
  hint?: { hint: string; prompt: string } | null;
  page?: string | null;
  prefill?: { text: string; n: number } | null;
  className?: string;
};

type UiMessage = AssistantMessage & { pending?: boolean; failed?: boolean };

const OctoAvatar = ({ size = 36 }: { size?: number }) => (
  <span aria-hidden className="flex-none rounded-[10px] bg-blue text-white flex items-center justify-center font-display font-bold text-[12px]" style={{ width: size, height: size }}>O</span>
);

function sortMsgs(list: UiMessage[]) {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function fmtDay(d: string | null | undefined) {
  return new Date(d ?? Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function Conversation(p: ConversationProps) {
  const [sessionId, setSessionId] = useState(p.sessionId);
  const [status, setStatus] = useState(p.sessionStatus ?? 'bot');
  const [messages, setMessages] = useState<UiMessage[]>(p.initialMessages);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferHuman, setPreferHuman] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const managerFirst = p.team?.first_name ?? 'your account manager';
  const me = initials(p.orgName, 'ME');
  const withHuman = status === 'escalated' || status === 'human';

  // prefill from "What Octo can do" tiles / page hints (never auto-sends)
  const [lastPrefill, setLastPrefill] = useState(p.prefill?.n ?? 0);
  if (p.prefill && p.prefill.n !== lastPrefill) {
    setLastPrefill(p.prefill.n);
    setText(p.prefill.text);
  }
  useEffect(() => { if (p.prefill?.n) inputRef.current?.focus(); }, [p.prefill?.n]);

  const merge = useCallback((incoming: AssistantMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.filter((m) => !m.pending || !incoming.some((x) => x.author === 'customer' && x.content === m.content)).map((m) => [m.id, m]));
      incoming.forEach((m) => byId.set(m.id, { ...m, tools_called: m.tools_called ?? [] }));
      return sortMsgs([...byId.values()]);
    });
  }, []);

  // Realtime: staff replies, system notices and status changes appear without reload (RLS hides staff-internal notes)
  useEffect(() => {
    if (!sessionId) return;
    const sb = createClient();
    const ch = sb.channel(`octo:${sessionId}:${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes' as never, { event: 'INSERT', schema: 'public', table: 'assistant_messages', filter: `session_id=eq.${sessionId}` } as never,
        (payload: { new: AssistantMessage & { hidden_from_customer?: boolean } }) => { if (!payload.new.hidden_from_customer) merge([payload.new]); })
      .on('postgres_changes' as never, { event: 'UPDATE', schema: 'public', table: 'assistant_sessions', filter: `id=eq.${sessionId}` } as never,
        (payload: { new: { status: string } }) => setStatus(payload.new.status));
    return subscribeAuthed(sb, ch);
  }, [sessionId, merge]);

  // existing thumbs for bot messages
  const botIds = useMemo(() => messages.filter((m) => m.author === 'bot' && !m.pending).map((m) => m.id), [messages]);
  const botKey = botIds.join(',');
  useEffect(() => {
    if (!botKey) return;
    let live = true;
    createClient().from('assistant_feedback').select('message_id, thumbs_up').in('message_id', botKey.split(',')).then(({ data }) => {
      if (!live || !data) return;
      setFeedback((f) => ({ ...Object.fromEntries(data.map((r) => [r.message_id as string, !!r.thumbs_up])), ...f }));
    });
    return () => { live = false; };
  }, [botKey]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || sending) return;
    setError(null);
    setSending(true);
    setText('');
    const tempId = `tmp-${++seq.current}`;
    setMessages((m) => [...m, { id: tempId, session_id: sessionId ?? '', author: 'customer', author_user_id: null, content, confidence: null, tools_called: [], created_at: new Date().toISOString(), pending: true }]);
    try {
      const page = p.page ?? (typeof window !== 'undefined' ? window.location.pathname : null);
      const r = await fetch('/api/assistant/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: content, page, channel: p.channel, prefer_human: !p.withinHours && preferHuman }),
      });
      const data = (await r.json().catch(() => ({}))) as Partial<ReplyResponse> & { error?: string };
      if (!r.ok) throw new Error(data.error ?? 'Octo could not reply. Please try again.');
      if (data.session_id && data.session_id !== sessionId) { setSessionId(data.session_id); p.onSessionChange?.(data.session_id); }
      setMessages((m) => m.filter((x) => x.id !== tempId));
      merge(data.messages ?? []);
      if (data.escalated) setStatus((s) => (s === 'human' ? s : 'escalated'));
    } catch (e) {
      setMessages((m) => m.map((x) => (x.id === tempId ? { ...x, pending: false, failed: true } : x)));
      setError((e as Error).message);
      setText(content);
    } finally {
      setSending(false);
    }
  }

  const chips = [
    ...(p.hint ? [{ label: p.hint.prompt, text: p.hint.prompt }] : []),
    { label: 'Track my shipment', text: 'Where is my latest shipment and when will it arrive?' },
    { label: 'Open an RFQ', text: 'I want to open a new RFQ' },
    { label: 'Top up wallet', text: 'What is my wallet balance and how do I top up?' },
  ];

  return (
    <section className={`card p-0 flex flex-col overflow-hidden ${p.className ?? ''}`} aria-label="Conversation with Octo">
      <div className="px-[18px] py-2.5 border-b border-line flex flex-wrap items-center justify-between gap-2.5 bg-[#FAFBFC]">
        <h2 className="m-0 font-display font-bold text-[14px]">Conversation · {fmtDay(p.startedAt ?? messages[0]?.created_at)}</h2>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {withHuman ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold bg-[#E7F6EC] text-[#166534]"><span aria-hidden className="w-[7px] h-[7px] rounded-full bg-[#166534]" />With {managerFirst}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold bg-[#E7F6EC] text-[#166534]"><span aria-hidden className="w-[7px] h-[7px] rounded-full bg-[#166534]" />Octo online</span>
          )}
          {p.counts && <span>{contextLabel(p.counts)}</span>}
        </div>
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Messages" className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-3.5 bg-surface">
        <div className="flex gap-2.5 max-w-[86%] self-start">
          <OctoAvatar />
          <div className="px-3.5 py-3 rounded-[14px] rounded-tl-[4px] bg-white border border-line text-[14.5px] leading-[1.55]">
            <strong>Hi {p.orgName}.</strong> I&apos;m Octo, your Octopus B2B AI assistant. I can see your orders, RFQs, wallet and pool pledges. What can I help with today?
            {p.hint && <div className="mt-2 text-[13px] text-muted">{p.hint.hint}</div>}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {chips.map((c) => (
                <button key={c.label} type="button" disabled={sending} onClick={() => send(c.text)}
                  className="inline-flex items-center rounded-full border border-[#B9D2F5] bg-[#F4F8FE] px-3 py-2 text-[13px] font-medium text-[#3B4556] hover:border-blue hover:text-blue disabled:opacity-50">{c.label}</button>
              ))}
            </div>
          </div>
        </div>

        {messages.map((m) => {
          if (m.author === 'system') {
            return (
              <div key={m.id} role="status" className="self-center max-w-[90%] bg-[#FFF4E5] text-[#6B4A07] border border-[#F3D9A6] rounded-[12px] px-3 py-2 text-[12.5px] leading-[1.45] flex gap-2 items-start">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden className="flex-none mt-px"><path d="M12 2a10 10 0 1 0 10 10" /><path d="m8 12 3 3 5-6" /></svg>
                <div><span className="sr-only">System notice: </span>{m.content}</div>
              </div>
            );
          }
          if (m.author === 'customer') {
            return (
              <div key={m.id} className="flex gap-2.5 max-w-[86%] self-end flex-row-reverse">
                <span aria-hidden className="flex-none w-9 h-9 rounded-[10px] bg-navy text-white flex items-center justify-center font-display font-bold text-[12px]">{me}</span>
                <div className="flex flex-col items-end gap-1">
                  <div className={`px-3.5 py-3 rounded-[14px] rounded-tr-[4px] bg-blue text-white text-[14.5px] leading-[1.55] whitespace-pre-wrap break-words ${m.pending ? 'opacity-70' : ''}`}>
                    <span className="sr-only">You: </span>{m.content}
                  </div>
                  {m.failed && <span className="text-[11px] text-bad">Not sent</span>}
                </div>
              </div>
            );
          }
          if (m.author === 'staff') {
            const isMgr = p.team && m.author_user_id === p.team.staff_user_id;
            const name = isMgr ? p.team!.name : 'Account team';
            return (
              <div key={m.id} className="flex gap-2.5 max-w-[86%] self-start">
                <span aria-hidden className="flex-none w-9 h-9 rounded-[10px] bg-[#166534] text-white flex items-center justify-center font-display font-bold text-[12px]">{isMgr ? p.team!.initials : 'AT'}</span>
                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold text-[#166534]">{name} · account manager</span>
                  <div className="px-3.5 py-3 rounded-[14px] rounded-tl-[4px] bg-[#F0FBF4] border border-[#BFE2CB] text-[14.5px] leading-[1.55] whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              </div>
            );
          }
          return <BotBubble key={m.id} m={m} feedback={feedback[m.id]} onFeedback={(up) => setFeedback((f) => ({ ...f, [m.id]: up }))} />;
        })}

        {sending && (
          <div className="flex gap-2.5 self-start" aria-live="polite">
            <OctoAvatar />
            <div className="px-3.5 py-3 rounded-[14px] rounded-tl-[4px] bg-white border border-line text-[14px] text-muted">{withHuman ? `Sent to ${managerFirst}…` : 'Octo is checking your account…'}</div>
          </div>
        )}
      </div>

      {!p.withinHours && !withHuman && (
        <fieldset className="px-4 py-2 border-t border-line bg-[#FFF4E5] text-[12.5px] text-[#6B4A07] flex flex-wrap items-center gap-x-4 gap-y-1">
          <legend className="sr-only">Outside office hours</legend>
          <span>{managerFirst === 'your account manager' ? 'Your account manager' : managerFirst} is outside office hours{p.hoursLabel ? ` (${p.hoursLabel})` : ''}.</span>
          <label className="inline-flex items-center gap-1.5"><input type="radio" name={`ph-${p.channel}`} checked={!preferHuman} onChange={() => setPreferHuman(false)} /> Let Octo try</label>
          <label className="inline-flex items-center gap-1.5"><input type="radio" name={`ph-${p.channel}`} checked={preferHuman} onChange={() => setPreferHuman(true)} /> Wait for {p.team?.first_name ?? 'a human'}</label>
        </fieldset>
      )}

      <form className="px-4 py-3.5 border-t border-line flex gap-2.5 items-end bg-white" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label htmlFor={`octo-msg-${p.channel}`} className="sr-only">Your message</label>
        <textarea
          id={`octo-msg-${p.channel}`} ref={inputRef} rows={2} value={text} maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }}
          placeholder={`Message Octo${p.team ? ` or ${p.team.first_name}` : ''}… (Enter to send, Shift + Enter for a new line)`}
          className="flex-1 min-w-0 min-h-[46px] max-h-[160px] border border-line-2 rounded-[10px] px-3.5 py-3 resize-y text-[15px]"
        />
        <div className="flex flex-col gap-1.5 items-end">
          <button type="submit" className="btn btn-primary min-h-[46px]" disabled={sending || !text.trim()}>{sending ? '…' : 'Send'}</button>
          <span className="text-[11px] text-muted">{p.team ? `Shared with ${p.team.first_name}` : 'Shared with your account team'}</span>
        </div>
      </form>
      {error && <div role="alert" className="px-4 pb-3 -mt-1 text-[13px] text-bad bg-white">{error}</div>}
    </section>
  );
}

function BotBubble({ m, feedback, onFeedback }: { m: UiMessage; feedback: boolean | undefined; onFeedback: (up: boolean) => void }) {
  const [pending, start] = useTransition();
  const links = (m.tools_called ?? []).filter((t) => t.ok && t.link).map((t) => t.link!);
  const uniqLinks = links.filter((l, i) => links.findIndex((x) => x.href === l.href) === i);
  const drafts = (m.tools_called ?? []).map((t, i) => ({ t, i })).filter(({ t }) => t.ok && t.draft);
  const low = m.confidence != null && Number(m.confidence) < 0.6;
  return (
    <div className="flex gap-2.5 max-w-[86%] self-start">
      <OctoAvatar />
      <div className="flex flex-col gap-1 min-w-0">
        <div className="px-3.5 py-3 rounded-[14px] rounded-tl-[4px] bg-white border border-[#B9D2F5] text-[14.5px] leading-[1.55] break-words">
          <span className="sr-only">Octo (AI): </span>
          <div className="whitespace-pre-wrap">{m.content}</div>
          {low && <div className="mt-1 text-[12px] text-muted">Confidence {Math.round(Number(m.confidence) * 100)}%</div>}
          {drafts.map(({ t, i }) => <DraftCard key={i} messageId={m.id} index={i} draft={t.draft!} />)}
          {uniqLinks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {uniqLinks.map((l) => (
                <Link key={l.href} href={l.href} className="inline-flex items-center rounded-full border border-line-2 bg-white px-3 py-2 text-[13px] font-medium text-[#3B4556] hover:border-blue hover:text-blue">{l.label}</Link>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11.5px] text-muted pl-1">
          <span>Octo · AI</span>
          <span aria-hidden>·</span>
          <span className="sr-only">Was this helpful?</span>
          {[true, false].map((up) => (
            <button key={String(up)} type="button" disabled={pending} aria-pressed={feedback === up} aria-label={up ? 'Helpful' : 'Not helpful'}
              onClick={() => start(async () => { const r = await setAssistantFeedback(m.id, up); if (r.ok) onFeedback(up); })}
              className={`rounded px-1.5 py-0.5 hover:bg-white ${feedback === up ? (up ? 'text-ok font-semibold' : 'text-bad font-semibold') : ''}`}>
              {up ? '👍' : '👎'}{feedback === up ? (up ? ' Helpful' : ' Not helpful') : ''}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftCard({ messageId, index, draft }: { messageId: string; index: number; draft: AssistantDraft }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [result, setResult] = useState<{ href: string; label: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fee = draft.fee_minor != null ? money(draft.fee_minor, draft.fee_currency ?? 'USD') : null;
  const rows: [string, string][] = draft.kind === 'rfq'
    ? ([
        ['Product', draft.title], ['Quantity', draft.quantity.toLocaleString('en-US')], ['Details', draft.details],
        ['Destination', [draft.destination_city, draft.destination_country].filter(Boolean).join(', ')], ['Incoterm', draft.incoterm ?? ''],
        ['Target price', draft.target_price ? `${draft.target_price} per unit` : ''],
      ] as [string, string][]).filter(([, v]) => v)
    : Object.entries(draft.details).filter(([k]) => k !== 'source').map(([k, v]) => [k.replace(/_/g, ' '), String(v)] as [string, string]);
  return (
    <div className="mt-3 rounded-[12px] border border-line bg-surface p-3 text-[13.5px]">
      <div className="flex items-center justify-between gap-2">
        <strong>{draft.kind === 'rfq' ? 'Draft RFQ' : `Draft ${draft.service_name ?? draft.service_code} request`}</strong>
        <span className="text-[11px] font-semibold rounded-full bg-white border border-line px-2 py-0.5">Not submitted</span>
      </div>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted capitalize">{k}</dt><dd className="m-0 break-words line-clamp-3">{v}</dd></Fragment>))}
        {fee && (<><dt className="text-muted">Service charge</dt><dd className="m-0 font-semibold">{fee}</dd></>)}
      </dl>
      {step === 'done' && result ? (
        <div className="mt-2.5 text-ok font-semibold" role="status">Submitted ✓ <Link href={result.href} className="text-blue underline ml-1">{result.label}</Link></div>
      ) : step === 'confirm' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px]">{fee ? `Submit now? ${fee} will be charged per your wallet/billing settings.` : 'Submit this request now?'}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending}
            onClick={() => start(async () => {
              setErr(null);
              const r = await confirmAssistantDraft(messageId, index);
              if (r.ok) { setResult({ href: r.href, label: r.label }); setStep('done'); } else setErr(r.error);
            })}>{pending ? 'Submitting…' : 'Yes, submit'}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setStep('idle')}>Cancel</button>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep('confirm')}>Confirm</button>
          <Link href={draft.kind === 'rfq' ? '/request/sourcing' : '/account/sourcing'} className="btn btn-ghost btn-sm">Edit in the form</Link>
        </div>
      )}
      {err && <div role="alert" className="mt-1.5 text-[12.5px] text-bad">{err}</div>}
    </div>
  );
}
