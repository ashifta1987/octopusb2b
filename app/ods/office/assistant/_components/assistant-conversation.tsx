'use client';
// ODS T9
/**
 * ODS T9 · Assistant conversation (record view of one queue item). Same behaviour as today's ConversationWorkspace:
 * every open is audited (logAssistantOpen), inline reply or internal note (staffAssistantReply), Take over
 * (takeOverSession), Resolve / hand back to Octo with a required outcome (resolveEscalation), and the Octo side rail
 * (facts insert into the reply; refreshFact; lookupShipmentFact). All of them are today's server actions, passed in as
 * props; STEP_UP_REQUIRED results go to today's step-up page. Live updates: the real page adds RealtimeRefresh.
 */
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Field, Input, Modal, Panel, RadioCards, StatusPill, Textarea } from '@octopus/ui';
import { stepUpRedirect } from '@/lib/staff/step-up';
import {
  authorLabel, conversationActions, conversationStatusText, initials, validateReply,
  type AssistantResult, type ConversationFact, type ConversationMessage,
} from '../_lib/assistant-core';
import { InlineNotice } from '../../_components/sales-bits';

type FactResult = { ok: true; fact: { title: string; text: string } | null } | { ok: false; error: string };

export type AssistantConversationProps = {
  sessionId: string;
  status: string;
  hasOpenEscalation: boolean;
  messages: ConversationMessage[];
  facts: ConversationFact[];
  identity: ReactNode;
  canReply: boolean;
  canTakeOver: boolean;
  canClose: boolean;
  onOpen?: (session: string) => Promise<unknown>;
  reply: (session: string, content: string, internal: boolean) => Promise<AssistantResult>;
  takeOver: (session: string) => Promise<AssistantResult>;
  resolve: (session: string, outcome: string, close: boolean) => Promise<AssistantResult>;
  lookup: (ref: string) => Promise<FactResult>;
  refresh: (kind: 'quotes' | 'wallet', ref: string) => Promise<FactResult>;
  sample?: boolean;
};

const timeFmt = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AssistantConversation(p: AssistantConversationProps) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [facts, setFacts] = useState(p.facts);
  const [lookup, setLookup] = useState('');
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [takeOverOpen, setTakeOverOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [closeSession, setCloseSession] = useState('close');
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const a = conversationActions(p);
  const { onOpen, sessionId } = p;

  useEffect(() => { void onOpen?.(sessionId); }, [onOpen, sessionId]); // audit every open (log_assistant_open)
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [p.messages.length]);

  const stepUp = (r: AssistantResult) => {
    if (r.ok || r.error !== 'STEP_UP_REQUIRED') return false;
    if (!p.sample) window.location.assign(r.redirect ?? stepUpRedirect(window.location.pathname + window.location.search));
    return true;
  };
  const run = (fn: () => Promise<AssistantResult>, after?: () => void) => {
    setErr(null); setNote(null);
    start(async () => {
      const r = await fn();
      if (stepUp(r)) return;
      if (!r.ok) { setErr(r.error === 'REASON_REQUIRED' ? 'Write the outcome first.' : r.error); return; }
      setNote(r.message ?? null); after?.();
      if (!p.sample) router.refresh();
    });
  };
  const send = () => {
    const v = validateReply(draft);
    if (v) { setErr(v); return; }
    run(() => p.reply(p.sessionId, draft, internal), () => setDraft(''));
  };
  const insert = (text: string) => { setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${text}` : text)); boxRef.current?.focus(); };

  return (
    <div className="grid min-w-0 items-start gap-3 ods-desktop:grid-cols-[minmax(0,1fr)_20rem]" data-testid="assistant-conversation">
      <section className="flex min-w-0 flex-col rounded-ods-card border border-ods-line bg-ods-surface" aria-label="Conversation">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ods-line px-3 py-2">
          <p className="m-0 text-ods-small text-ods-slate">Status: <b className="text-ods-navy">{conversationStatusText(p.status)}</b></p>
          <div className="flex flex-wrap gap-2">
            {a.takeOver ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => setTakeOverOpen(true)} data-testid="assistant-take-over">Take over</Button> : null}
            {a.resolve ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setOutcome(''); setResolveOpen(true); }} data-testid="assistant-resolve">Resolve / hand back to Octo</Button> : null}
          </div>
        </div>
        <ol ref={listRef} className="m-0 grid max-h-[60vh] min-h-64 list-none content-start gap-2 overflow-y-auto px-3 py-3" aria-label="Messages" tabIndex={0}>
          {p.messages.length === 0 ? <li className="text-ods-small text-ods-slate">No messages yet.</li> : null}
          {p.messages.map((m) => {
            const right = m.author === 'bot' || m.author === 'staff';
            return (
              <li key={m.id} className={`flex items-start gap-2 ${right ? 'flex-row-reverse' : ''} ${m.author === 'system' ? 'justify-center' : ''}`}>
                {m.author !== 'system' ? (
                  <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${m.author === 'bot' ? 'bg-ods-blue text-white' : m.author === 'customer' ? 'bg-ods-navy text-white' : 'bg-ods-teal text-ods-navy'}`}>
                    {m.author === 'bot' ? 'O' : m.author === 'customer' ? 'C' : initials(m.authorName)}
                  </span>
                ) : null}
                <div className={`max-w-[85%] rounded-ods-card px-3 py-2 text-ods-body ${
                  m.author === 'bot' ? 'bg-ods-blue-tint text-ods-text'
                    : m.author === 'customer' ? 'bg-ods-navy text-white'
                      : m.author === 'staff' && m.internal ? 'border border-dashed border-ods-warning bg-ods-warning-tint text-ods-text'
                        : m.author === 'staff' ? 'bg-ods-success-tint text-ods-text'
                          : 'bg-ods-canvas text-ods-text'}`}>
                  <div className={`mb-0.5 flex flex-wrap gap-x-2 text-[11px] font-semibold ${m.author === 'customer' ? 'text-white' : 'text-ods-slate'}`}>
                    <span>{authorLabel(m.author, m.internal, m.authorName)}</span>
                    <span className="font-normal" suppressHydrationWarning>{timeFmt(m.createdAt)}</span>
                    {m.author === 'bot' && m.confidence != null ? <span className="font-normal">confidence {Math.round(m.confidence * 100)}%</span> : null}
                    {m.author === 'bot' && m.tools > 0 ? <span className="font-normal">{m.tools} tool call{m.tools === 1 ? '' : 's'}</span> : null}
                  </div>
                  <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-ods-line px-3 py-3">
          {a.reply ? (
            <div className="grid gap-2">
              <Field label={internal ? 'Internal note (staff only)' : 'Reply to the customer'}>
                <Textarea ref={boxRef} rows={3} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                  placeholder={internal ? 'Note for colleagues…' : 'Type your reply. It appears in the customer’s thread instantly.'} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox label="Internal note" checked={internal} onCheckedChange={setInternal} />
                <Button size="sm" variant={internal ? 'secondary' : 'primary'} loading={pending} disabled={!draft.trim()} onClick={send} data-testid="assistant-send">{internal ? 'Save note' : 'Send reply'}</Button>
                <span className="text-ods-small text-ods-slate">Ctrl/⌘ + Enter to send</span>
              </div>
            </div>
          ) : (
            <p className="m-0 text-ods-small text-ods-slate">{a.closed ? 'This conversation is closed.' : 'View only. Your role cannot reply.'}</p>
          )}
          {err ? <InlineNotice tone="danger" role="alert" className="mt-2">{err}</InlineNotice> : null}
          {note ? <InlineNotice tone="success" role="status" className="mt-2">{note}</InlineNotice> : null}
        </div>
      </section>

      <aside className="grid min-w-0 gap-3" aria-label="Customer and Octo facts">
        {p.identity}
        <Panel title="Octo side rail" headingLevel={2} description="Facts from this customer’s own data. Select one to insert it into your reply.">
          <div className="grid gap-2">
            {facts.length === 0 ? <p className="m-0 text-ods-small text-ods-slate">No orders, open RFQs or wallet activity yet.</p> : (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {facts.map((f) => (
                  <li key={f.key} className="rounded-ods-control border border-ods-line">
                    <button type="button" className="w-full rounded-ods-control px-2.5 py-1.5 text-start hover:bg-ods-canvas disabled:opacity-60" disabled={!a.reply} onClick={() => insert(f.text)}>
                      <span className="block text-ods-small font-semibold text-ods-blue">{f.title} <span className="font-normal text-ods-slate">· insert<span className="sr-only"> into the reply</span></span></span>
                      <span className="line-clamp-4 block whitespace-pre-line text-ods-small text-ods-text">{f.text}</span>
                    </button>
                    {(f.kind === 'quotes' || f.kind === 'wallet') && f.ref ? (
                      <button type="button" className="min-h-6 px-2.5 pb-1.5 text-[11px] text-ods-slate underline" disabled={pending}
                        onClick={() => start(async () => {
                          const r = await p.refresh(f.kind as 'quotes' | 'wallet', f.ref!);
                          if (r.ok && r.fact) setFacts((prev) => prev.map((x) => (x.key === f.key ? { ...x, title: r.fact!.title, text: r.fact!.text } : x)));
                        })}>Refresh</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form className="grid gap-1.5" onSubmit={(e) => {
              e.preventDefault(); setLookupErr(null);
              start(async () => {
                const r = await p.lookup(lookup);
                if (!r.ok) { setLookupErr(r.error); return; }
                if (!r.fact) { setLookupErr('Nothing found for that reference (or not one of your customers).'); return; }
                setFacts((prev) => [{ key: `lookup:${lookup}:${Date.now()}`, title: r.fact!.title, text: r.fact!.text, kind: 'shipment', ref: lookup }, ...prev]);
                setLookup('');
              });
            }}>
              <Field label="Look up shipment" error={lookupErr ?? undefined}>
                <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Tracking no. or ORD-…" />
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={pending || !lookup.trim()}>Find</Button>
            </form>
          </div>
        </Panel>
      </aside>

      <Modal open={takeOverOpen} onClose={() => setTakeOverOpen(false)} title="Take over this conversation?" description="Octo stops answering until you hand it back." confirmLabel="Take over" loading={pending}
        onConfirm={() => run(() => p.takeOver(p.sessionId), () => setTakeOverOpen(false))} />
      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} size="md" title="Resolve this handoff"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setResolveOpen(false)} disabled={pending}>Cancel</Button>
            <Button loading={pending} disabled={!outcome.trim()} onClick={() => run(() => p.resolve(p.sessionId, outcome, closeSession === 'close'), () => setResolveOpen(false))}>
              {closeSession === 'close' ? 'Resolve & close' : 'Resolve & hand back'}
            </Button>
          </div>
        )}>
        <div className="grid gap-3">
          <Field label="Outcome" required>
            <Textarea rows={3} maxLength={500} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Refund request passed to Finance (FA-…); customer informed." />
          </Field>
          <RadioCards legend="Then" columns={1} value={closeSession} onValueChange={setCloseSession}
            options={[{ value: 'close', label: 'Close the conversation' }, { value: 'handback', label: 'Hand back to Octo', description: 'The conversation stays open.' }]} />
          {err ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
        </div>
      </Modal>
    </div>
  );
}

/** Identity card (left of the side rail). Presentational; the page computes the values with today's reads. */
export type IdentityVM = {
  org: { name: string; buyerCode: string | null; country: string | null; city: string | null; kycStatusName: string; kycRaw: string } | null;
  contact: { name: string | null; email: string | null } | null;
  manager: { name: string; you: boolean; outOfOffice: boolean; team: string | null; since: string | null } | null;
  startedAt: string;
  channel: string;
  pageContext: string | null;
  escalation: {
    reason: string | null; reasonText: string; slaText: ReactNode; excerpt: string | null; assigned: string; takenBy: string | null;
    resolved: string | null; ticket: { code: string; status: string | null; href: string | null } | null;
  } | null;
};

export function IdentityCard({ v }: { v: IdentityVM }) {
  return (
    <Panel title="Customer" headingLevel={2} data-testid="assistant-identity">
      {v.org ? (
        <dl className="m-0 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-ods-small">
          <dt className="text-ods-slate">Company</dt><dd className="m-0 font-semibold">{v.org.name}</dd>
          <dt className="text-ods-slate">Buyer code</dt><dd className="m-0 font-mono">{v.org.buyerCode ?? '—'}</dd>
          <dt className="text-ods-slate">Country</dt><dd className="m-0">{v.org.country ?? '—'}{v.org.city ? ` · ${v.org.city}` : ''}</dd>
          <dt className="text-ods-slate">KYC</dt><dd className="m-0"><StatusPill status={v.org.kycStatusName} /> <span className="sr-only">({v.org.kycRaw})</span></dd>
          {v.contact ? <><dt className="text-ods-slate">Contact</dt><dd className="m-0 break-words">{v.contact.name}{v.contact.email ? <><br /><span className="text-ods-slate">{v.contact.email}</span></> : null}</dd></> : null}
          <dt className="text-ods-slate">Account mgr</dt>
          <dd className="m-0">{v.manager ? <>{v.manager.name}{v.manager.you ? ' (you)' : ''}{v.manager.outOfOffice ? ' · out of office' : ''}{v.manager.team ? <span className="block text-ods-slate">{v.manager.team} team{v.manager.since ? ` · since ${v.manager.since}` : ''}</span> : null}</> : 'Unassigned'}</dd>
        </dl>
      ) : <p className="m-0 text-ods-small text-ods-slate">Customer details are not visible to you.</p>}
      <div className="mt-3 grid gap-1 border-t border-ods-line pt-3 text-ods-small">
        <div><span className="text-ods-slate">Started</span> {v.startedAt} · {v.channel}</div>
        {v.pageContext ? <div className="break-all"><span className="text-ods-slate">Page</span> <span className="font-mono">{v.pageContext}</span></div> : null}
        {v.escalation ? (
          <>
            <div className="flex flex-wrap items-center gap-2">{v.escalation.reason ? <StatusPill tone="warning">{v.escalation.reasonText}</StatusPill> : null}{v.escalation.slaText}</div>
            {v.escalation.excerpt ? <p className="m-0 italic text-ods-slate">“{v.escalation.excerpt}”</p> : null}
            <div><span className="text-ods-slate">Assigned</span> {v.escalation.assigned}{v.escalation.takenBy ? ` · taken by ${v.escalation.takenBy}` : ''}</div>
            {v.escalation.resolved ? <div><span className="text-ods-slate">Resolved</span> {v.escalation.resolved}</div> : null}
            {v.escalation.ticket ? (
              <div><span className="text-ods-slate">Support ticket</span>{' '}
                {v.escalation.ticket.href ? <a className="font-mono font-semibold text-ods-blue underline" href={v.escalation.ticket.href}>{v.escalation.ticket.code}</a> : <span className="font-mono">{v.escalation.ticket.code}</span>}
                {v.escalation.ticket.status ? ` · ${v.escalation.ticket.status.replace(/_/g, ' ')}` : ''}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Panel>
  );
}
