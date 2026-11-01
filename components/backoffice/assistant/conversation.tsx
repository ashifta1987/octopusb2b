'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, subscribeAuthed } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { stepUpRedirect } from '@/lib/staff/step-up';
import {
  logAssistantOpen, lookupShipmentFact, refreshFact, resolveEscalation, staffAssistantReply, takeOverSession,
} from '@/app/office/assistant/actions';
import { authorLabel, initials, slaInfo, type QueueAuthor } from './sla';

export type QueueMessage = {
  id: string;
  author: QueueAuthor;
  author_user_id: string | null;
  content: string;
  hidden_from_customer: boolean;
  confidence: number | null;
  tools: number;
  created_at: string;
};

export type RailFact = { key: string; title: string; text: string; kind?: 'quotes' | 'wallet' | 'shipment'; ref?: string };

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

function handleStepUp(r: R): boolean {
  if (r.ok || r.error !== 'STEP_UP_REQUIRED') return false;
  window.location.assign(r.redirect ?? stepUpRedirect(window.location.pathname + window.location.search));
  return true;
}

const timeFmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Live SLA counter (re-renders every 30 s). Overdue → red text + "Overdue" label (never colour alone). */
export function SlaCounter({ due, resolvedAt, className }: { due: string | null; resolvedAt?: string | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const s = slaInfo(due, now, resolvedAt);
  return (
    <span suppressHydrationWarning className={cn('font-semibold mono text-xs', s.overdue ? 'text-bad' : s.soon ? 'text-[#8A5A00]' : 'text-muted', className)}>
      {s.overdue && <span aria-hidden>⚠ </span>}{s.text}
    </span>
  );
}

/**
 * Staff conversation workspace (SPEC §20.5): full history incl. internal notes, Realtime updates, inline reply with
 * "Internal note" toggle, take over / resolve, and the Octo side rail whose facts insert into the reply with one click.
 */
export function ConversationWorkspace({
  sessionId, status, hasOpenEscalation, initialMessages, people, facts, identity, canReply, canTakeOver, canClose,
}: {
  sessionId: string;
  status: string;
  hasOpenEscalation: boolean;
  initialMessages: QueueMessage[];
  people: Record<string, string>;
  facts: RailFact[];
  identity: React.ReactNode;
  canReply: boolean;
  canTakeOver: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [live, setLive] = useState<QueueMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [railFacts, setRailFacts] = useState<RailFact[]>(facts);
  const [lookup, setLookup] = useState('');
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [closeSession, setCloseSession] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // audit every open (log_assistant_open)
  useEffect(() => {
    void logAssistantOpen(sessionId);
  }, [sessionId]);

  // Realtime: new messages in this thread; session status changes refresh the server view
  useEffect(() => {
    const ch = sb
      .channel(`assistant-staff:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assistant_messages', filter: `session_id=eq.${sessionId}` }, (p) => {
        const m = p.new as Record<string, unknown>;
        const msg: QueueMessage = {
          id: String(m.id), author: m.author as QueueAuthor, author_user_id: (m.author_user_id as string | null) ?? null, content: String(m.content ?? ''),
          hidden_from_customer: Boolean(m.hidden_from_customer), confidence: m.confidence == null ? null : Number(m.confidence),
          tools: Array.isArray(m.tools_called) ? m.tools_called.length : 0, created_at: String(m.created_at),
        };
        setLive((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'assistant_sessions', filter: `id=eq.${sessionId}` }, () => router.refresh());
    return subscribeAuthed(sb, ch);
  }, [sb, sessionId, router]);

  const messages = useMemo(() => {
    const ids = new Set(initialMessages.map((m) => m.id));
    return [...initialMessages, ...live.filter((m) => !ids.has(m.id))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [initialMessages, live]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const insert = (text: string) => {
    setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${text}` : text));
    boxRef.current?.focus();
  };

  const send = () => {
    if (!draft.trim() || pending) return;
    setErr(null); setNote(null);
    start(async () => {
      const r = await staffAssistantReply(sessionId, draft, internal);
      if (handleStepUp(r)) return;
      if (!r.ok) { setErr(r.error); return; }
      setDraft(''); setNote(r.message ?? null);
      router.refresh();
    });
  };

  const run = (fn: () => Promise<R>, after?: () => void) => {
    setErr(null); setNote(null);
    start(async () => {
      const r = await fn();
      if (handleStepUp(r)) return;
      if (!r.ok) { setErr(r.error); return; }
      setNote(r.message ?? null); after?.();
      router.refresh();
    });
  };

  const closed = status === 'closed';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] min-w-0">
      <section className="card flex flex-col min-w-0" aria-label="Conversation">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-line">
          <div className="text-sm text-muted">
            Status: <strong className="text-navy">{status === 'bot' ? 'Octo answering' : status === 'human' ? 'Human (you or team)' : status === 'escalated' ? 'Waiting for a human' : 'Closed'}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {canTakeOver && !closed && status !== 'human' && (
              <button type="button" className="btn btn-dark btn-sm" disabled={pending}
                onClick={() => { if (window.confirm('Take over this conversation? Octo stops answering until you hand it back.')) run(() => takeOverSession(sessionId)); }}>
                Take over
              </button>
            )}
            {canClose && !closed && (hasOpenEscalation || status !== 'bot') && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { setOutcome(''); setResolveOpen(true); }}>
                Resolve / hand back to Octo
              </button>
            )}
          </div>
        </div>

        <ol ref={listRef} className="flex-1 overflow-y-auto max-h-[60vh] min-h-[320px] px-5 py-4 space-y-3" aria-live="polite" aria-label="Messages">
          {messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
          {messages.map((m) => {
            const name = m.author_user_id ? people[m.author_user_id] : null;
            const right = m.author === 'bot' || m.author === 'staff';
            return (
              <li key={m.id} className={cn('flex gap-2 items-start', right ? 'flex-row-reverse' : '', m.author === 'system' && 'justify-center')}>
                {m.author !== 'system' && (
                  <span aria-hidden className={cn('shrink-0 w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold',
                    m.author === 'bot' ? 'bg-blue text-white' : m.author === 'customer' ? 'bg-navy text-white' : 'bg-ok text-white')}>
                    {m.author === 'bot' ? 'O' : m.author === 'customer' ? 'C' : initials(name)}
                  </span>
                )}
                <div className={cn('rounded-[12px] px-4 py-2.5 max-w-[80%] text-[15px]',
                  m.author === 'bot' && 'bg-blue-soft text-navy',
                  m.author === 'customer' && 'bg-navy text-white',
                  m.author === 'staff' && !m.hidden_from_customer && 'bg-[#E3F5EA] text-[#14532D]',
                  m.author === 'staff' && m.hidden_from_customer && 'bg-[#FFF8E1] text-[#5C3D00] border border-dashed border-warn/60',
                  m.author === 'system' && 'bg-[#FFF3D6] text-[#8A5A00] text-sm max-w-[90%]')}>
                  <div className={cn('text-[11px] font-semibold mb-0.5 flex flex-wrap gap-x-2', m.author === 'customer' ? 'text-white/80' : 'opacity-80')}>
                    <span>{authorLabel(m.author, m.hidden_from_customer, name)}</span>
                    {m.author === 'staff' && m.hidden_from_customer && <span className="uppercase tracking-wide rounded bg-warn/20 px-1">Internal</span>}
                    <span className="font-normal">{timeFmt(m.created_at)}</span>
                    {m.author === 'bot' && m.confidence != null && <span className="font-normal">confidence {Math.round(Number(m.confidence) * 100)}%</span>}
                    {m.author === 'bot' && m.tools > 0 && <span className="font-normal">{m.tools} tool call{m.tools === 1 ? '' : 's'}</span>}
                  </div>
                  <p className="whitespace-pre-line break-words">{m.content}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="border-t border-line px-5 py-4">
          {canReply && !closed ? (
            <>
              <label htmlFor="asst-reply" className="label">{internal ? 'Internal note (never shown to the customer)' : 'Reply to the customer'}</label>
              <textarea
                id="asst-reply" ref={boxRef} className={cn('input min-h-24 py-2', internal && 'bg-[#FFF8E1]')} value={draft} maxLength={4000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={internal ? 'Note for colleagues…' : 'Type your reply — it appears in the customer’s thread instantly.'}
              />
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <label className="inline-flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                </label>
                <button type="button" className={cn('btn btn-sm', internal ? 'btn-dark' : 'btn-primary')} disabled={pending || !draft.trim()} onClick={send}>
                  {pending ? 'Sending…' : internal ? 'Save note' : 'Send reply'}
                </button>
                <span className="text-xs text-muted">Ctrl/⌘ + Enter to send</span>
                {err && <span role="alert" className="text-sm text-bad">{err}</span>}
                {note && <span role="status" className="text-sm text-ok">{note}</span>}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{closed ? 'This conversation is closed.' : 'View only — your role cannot reply.'}{err && <span role="alert" className="text-bad ml-2">{err}</span>}</p>
          )}
        </div>
      </section>

      <aside className="space-y-6 min-w-0" aria-label="Customer and Octo facts">
        {identity}
        <section className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span aria-hidden className="w-7 h-7 rounded-full bg-blue text-white grid place-items-center text-xs font-bold">O</span>
            <h3 className="font-semibold">Octo side rail</h3>
          </div>
          <p className="text-xs text-muted mb-3">Facts from this customer&apos;s own data. Click one to insert it into your reply.</p>
          {railFacts.length === 0 ? (
            <p className="text-sm text-muted">No orders, open RFQs or wallet activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {railFacts.map((f) => (
                <li key={f.key} className="rounded-[10px] border border-line">
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-surface rounded-[10px] disabled:opacity-60" disabled={!canReply || closed}
                    onClick={() => insert(f.text)} aria-label={`Insert fact: ${f.title}`}>
                    <span className="block text-xs font-semibold text-blue">{f.title} <span className="text-muted font-normal">· insert</span></span>
                    <span className="block text-[13px] whitespace-pre-line line-clamp-4">{f.text}</span>
                  </button>
                  {(f.kind === 'quotes' || f.kind === 'wallet') && f.ref && (
                    <button type="button" className="text-[11px] text-muted underline px-3 pb-2" disabled={pending}
                      onClick={() => start(async () => {
                        const r = await refreshFact(f.kind as 'quotes' | 'wallet', f.ref!);
                        if (r.ok && r.fact) setRailFacts((prev) => prev.map((x) => (x.key === f.key ? { ...x, title: r.fact!.title, text: r.fact!.text } : x)));
                      })}>
                      Refresh
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="mt-4" onSubmit={(e) => {
            e.preventDefault();
            setLookupErr(null);
            start(async () => {
              const r = await lookupShipmentFact(lookup);
              if (!r.ok) { setLookupErr(r.error); return; }
              if (!r.fact) { setLookupErr('Nothing found for that reference (or not one of your customers).'); return; }
              setRailFacts((prev) => [{ key: `lookup:${lookup}:${Date.now()}`, title: r.fact!.title, text: r.fact!.text, kind: 'shipment', ref: lookup }, ...prev]);
              setLookup('');
            });
          }}>
            <label htmlFor="asst-lookup" className="label">Look up shipment</label>
            <div className="flex gap-2">
              <input id="asst-lookup" className="input" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Tracking no. or ORD-…" />
              <button type="submit" className="btn btn-ghost btn-sm" disabled={pending || !lookup.trim()}>Find</button>
            </div>
            {lookupErr && <p role="alert" className="text-xs text-bad mt-1">{lookupErr}</p>}
          </form>
        </section>
      </aside>

      {resolveOpen && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="resolve-title">
          <div className="card w-full max-w-md p-6">
            <h2 id="resolve-title" className="text-xl font-semibold">Resolve this handoff</h2>
            <label htmlFor="resolve-outcome" className="label mt-4">Outcome *</label>
            <textarea id="resolve-outcome" className="input min-h-20 py-2" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Refund request passed to Finance (FA-…); customer informed." />
            <fieldset className="mt-4 space-y-2">
              <legend className="label">Then</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="close" checked={closeSession} onChange={() => setCloseSession(true)} /> Close the conversation</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="close" checked={!closeSession} onChange={() => setCloseSession(false)} /> Hand back to Octo (conversation stays open)</label>
            </fieldset>
            {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setResolveOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={pending || !outcome.trim()}
                onClick={() => run(() => resolveEscalation(sessionId, outcome, closeSession), () => setResolveOpen(false))}>
                {pending ? 'Working…' : closeSession ? 'Resolve & close' : 'Resolve & hand back'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
