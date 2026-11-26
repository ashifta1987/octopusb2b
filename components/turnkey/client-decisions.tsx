'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideDrawingAction, decideQuoteAction, drawingCommentAction } from '@/app/account/turnkey/actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role={msg.ok ? 'status' : 'alert'} className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;

/**
 * Turnkey T4 — the client reviews the drawing version waiting for them (design: Drawing / ChangeRequest): approve it,
 * or ask for changes with a short note. `extraNext` tells them before sending that the next version is a paid extra one.
 */
export function DrawingReview({ code, versionId, version, extraNext, extraLabel }: { code: string; versionId: string; version: number; extraNext: boolean; extraLabel: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const act = (decision: 'approve' | 'changes') => start(async () => {
    const r = await decideDrawingAction(code, versionId, decision, comment);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setComment(''); router.refresh(); }
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); act('changes'); }} aria-labelledby={`tk-rv-h-${versionId}`} data-testid="tk-drawing-review">
      <h3 id={`tk-rv-h-${versionId}`} className="m-0 text-[15px] font-semibold">Your review of version {version}</h3>
      <Note msg={msg} id="tk-drawing-review-msg" />
      <div>
        <label className="label" htmlFor={`tk-rv-c-${versionId}`}>What should change? (needed to ask for changes)</label>
        <textarea id={`tk-rv-c-${versionId}`} className="input min-h-24" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} data-testid="tk-drawing-comment-input" />
      </div>
      <p className="m-0 text-[13px] text-muted" data-testid="tk-drawing-next-cost">
        {extraNext ? `The next version is an extra version: ${extraLabel ?? '50% of the drawing fee'}. It is invoiced when you ask for changes and we start it after you pay.`
          : 'The next version is free (3 versions are free).'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act('approve')} data-testid="tk-drawing-approve">Approve version {version}</button>
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !comment.trim()} data-testid="tk-drawing-changes">Ask for changes</button>
      </div>
    </form>
  );
}

export function DrawingComment({ code, versionId }: { code: string; versionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const id = `tk-dr-cc-${versionId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await drawingCommentAction(code, versionId, body); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setBody(''); router.refresh(); } }); }}>
      <label className="label" htmlFor={id}>Add a comment</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} data-testid={`tk-drawing-comment-${versionId}`} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !body.trim()}>Send</button>
      </div>
      <Note msg={msg} id={`tk-dr-cc-msg-${versionId}`} />
    </form>
  );
}

/** The client accepts the quote version waiting for them (the deposit proforma is issued) or asks for changes. */
export function QuoteDecision({ code, quoteId, version, depositLabel }: { code: string; quoteId: string; version: number; depositLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const act = (decision: 'accept' | 'changes') => start(async () => {
    const r = await decideQuoteAction(code, quoteId, decision, comment);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setComment(''); router.refresh(); }
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); act('changes'); }} aria-labelledby={`tk-qd-h-${quoteId}`} data-testid="tk-quote-decision">
      <h3 id={`tk-qd-h-${quoteId}`} className="m-0 text-[15px] font-semibold">Your answer to version {version}</h3>
      <Note msg={msg} id="tk-quote-msg" />
      <div>
        <label className="label" htmlFor={`tk-qd-c-${quoteId}`}>Comment (needed to ask for changes)</label>
        <textarea id={`tk-qd-c-${quoteId}`} className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} data-testid="tk-quote-comment" />
      </div>
      <p className="m-0 text-[13px] text-muted">When you accept, we issue the deposit proforma: {depositLabel}.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act('accept')} data-testid="tk-quote-accept">Accept version {version}</button>
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !comment.trim()} data-testid="tk-quote-changes">Ask for changes</button>
      </div>
    </form>
  );
}
