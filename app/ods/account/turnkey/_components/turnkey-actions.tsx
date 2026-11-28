'use client';

import { useState } from 'react';
import { Button, Checkbox, Field, Input, Textarea } from '@octopus/ui';
import { createClient } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import { TK_PASSPORT_MAX_BYTES, TK_PASSPORT_TYPES, passportExt, tripPrice, type TkTripPrices } from '@/lib/turnkey/format';
import {
  cancelTripAction, decideDrawingAction, decideQuoteAction, deletePassportAction, drawingCommentAction, payTurnkeyFeeAction,
  registerPassportAction, requestTripAction, signHandoverAction,
} from '@/app/account/turnkey/actions';
import { ActionMessage, useRun } from '../../_services/action-kit';

/**
 * ODS client islands for the Turnkey project page. Every button calls TODAY's server action from
 * app/account/turnkey/actions.ts unchanged (money: payTurnkeyFeeAction → pay_service_proforma; same idempotency key rule:
 * one key per page view per item). No new money code.
 */

/** "Pay US$ 1,860.00 from wallet" — today's payTurnkeyFeeAction (wallet; bank transfer explained next to it). */
export function PayFeeButton({ code, documentId, amountCents, label, idempotencyKey, testId }: { code: string; documentId: string; amountCents: number; label: string; idempotencyKey: string; testId?: string }) {
  const { pending, msg, run } = useRun();
  if (msg?.ok) return <ActionMessage msg={msg} testId={`turnkey-pay-done-${documentId}`} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button loading={pending} loadingText="Paying…" data-testid={testId ?? `turnkey-pay-${documentId}`}
        onClick={() => run(async () => { const r = await payTurnkeyFeeAction({ code, documentId, amountCents, idempotencyKey }); return { ok: r.ok, text: r.message }; })}>
        {`Pay ${label} from wallet`}
      </Button>
      <ActionMessage msg={msg} />
    </div>
  );
}

/** Approve the latest drawing version or ask for changes (today's decideDrawingAction). */
export function DrawingReview({ code, versionId, version, extraNext, extraLabel }: { code: string; versionId: string; version: number; extraNext: boolean; extraLabel: string | null }) {
  const { pending, msg, run } = useRun();
  const [comment, setComment] = useState('');
  const act = (d: 'approve' | 'changes') => run(async () => { const r = await decideDrawingAction(code, versionId, d, comment); return { ok: r.ok, text: r.message }; }, () => setComment(''));
  return (
    <form className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4" aria-labelledby={`dr-h-${versionId}`} onSubmit={(e) => { e.preventDefault(); act('changes'); }} data-testid="turnkey-drawing-review">
      <h4 id={`dr-h-${versionId}`} className="m-0 text-ods-body font-semibold text-ods-navy">Your review of version {version}</h4>
      <Field label="What should change?" hint="Needed to ask for changes.">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
      </Field>
      <p className="m-0 text-ods-small text-ods-slate">
        {extraNext ? `The next version is an extra version: ${extraLabel ?? '50% of the drawing fee'}. It is invoiced when you ask for changes and we start it after you pay.` : 'The next version is free (3 versions are free).'}
      </p>
      <ActionMessage msg={msg} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => act('approve')} loading={pending} data-testid="turnkey-drawing-approve">Approve version {version}</Button>
        <Button type="submit" variant="secondary" disabled={pending || !comment.trim()} disabledReason={!comment.trim() ? 'Write what should change first.' : undefined}>Ask for changes</Button>
      </div>
    </form>
  );
}

/** Add a comment to a drawing version (today's drawingCommentAction). */
export function DrawingComment({ code, versionId, version }: { code: string; versionId: string; version: number }) {
  const { pending, msg, run } = useRun();
  const [body, setBody] = useState('');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await drawingCommentAction(code, versionId, body); return { ok: r.ok, text: r.message }; }, () => setBody('')); }}>
      <Field label={`Comment on version ${version}`}>
        <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
      </Field>
      <div><Button type="submit" variant="secondary" size="sm" disabled={pending || !body.trim()}>Send comment</Button></div>
      <ActionMessage msg={msg} />
    </form>
  );
}

/** Accept the quote (the deposit proforma is issued) or ask for changes — today's decideQuoteAction. */
export function QuoteDecision({ code, quoteId, version, depositLabel }: { code: string; quoteId: string; version: number; depositLabel: string }) {
  const { pending, msg, run } = useRun();
  const [comment, setComment] = useState('');
  const act = (d: 'accept' | 'changes') => run(async () => { const r = await decideQuoteAction(code, quoteId, d, comment); return { ok: r.ok, text: r.message }; }, () => setComment(''));
  return (
    <form className="flex flex-col gap-3 rounded-ods-card border border-ods-line p-4" aria-labelledby={`qd-h-${quoteId}`} onSubmit={(e) => { e.preventDefault(); act('changes'); }}>
      <h4 id={`qd-h-${quoteId}`} className="m-0 text-ods-body font-semibold text-ods-navy">Your answer to version {version}</h4>
      <Field label="Comment" hint="Needed to ask for changes.">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
      </Field>
      <p className="m-0 text-ods-small text-ods-slate">When you accept, we issue the deposit proforma: {depositLabel}.</p>
      <ActionMessage msg={msg} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => act('accept')} loading={pending} data-testid="turnkey-quote-accept">Accept version {version}</Button>
        <Button type="submit" variant="secondary" disabled={pending || !comment.trim()} disabledReason={!comment.trim() ? 'Write a comment first.' : undefined}>Ask for changes</Button>
      </div>
    </form>
  );
}

/** Ask for a China visit; the estimate comes from today's tripPrice() and the services list (requestTripAction). */
export function TripRequestForm({ code, projectId, prices }: { code: string; projectId: string; prices: TkTripPrices }) {
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ start: '', end: '', travellers: '2', visa: '0', car: '0', pickups: '0', hotel: false, message: '' });
  const num = (v: string) => (/^\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : -1);
  const input = { start: f.start, end: f.end, travellers: num(f.travellers), visaLetters: num(f.visa), carDays: num(f.car), airportPickups: num(f.pickups), hotelHelp: f.hotel };
  const est = tripPrice(prices, input);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form className="flex flex-col gap-3" aria-labelledby="trip-new-h" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await requestTripAction(code, projectId, { ...input, message: f.message }); return { ok: r.ok, text: r.message }; }); }}>
      <h4 id="trip-new-h" className="m-0 text-ods-body font-semibold text-ods-navy">Ask for a China visit</h4>
      <div className="grid grid-cols-1 gap-3 ods-tablet:grid-cols-2">
        <Field label="First day (tomorrow or later)" required><Input type="date" value={f.start} onChange={set('start')} /></Field>
        <Field label="Last day" required><Input type="date" value={f.end} min={f.start || undefined} onChange={set('end')} /></Field>
        <Field label={`Travellers (the day price covers up to ${prices.includedTravellers})`}><Input type="number" min={0} max={20} value={f.travellers} onChange={set('travellers')} /></Field>
        <Field label="Visa invitation letters"><Input type="number" min={0} max={20} value={f.visa} onChange={set('visa')} /></Field>
        <Field label="Car and driver (days)"><Input type="number" min={0} max={30} value={f.car} onChange={set('car')} /></Field>
        <Field label="Airport pick-ups"><Input type="number" min={0} max={10} value={f.pickups} onChange={set('pickups')} /></Field>
      </div>
      <Checkbox label="Hotel help (free)" checked={f.hotel} onCheckedChange={(c) => setF((p) => ({ ...p, hotel: c }))} />
      <Field label="What would you like to see?" optional><Textarea value={f.message} onChange={set('message')} maxLength={2000} rows={2} /></Field>
      <div className="flex flex-col gap-1 rounded-ods-card border border-ods-line p-4 text-ods-body" aria-live="polite">
        {est.problem ? <p className="m-0 text-ods-slate">{est.problem}</p> : (
          <>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {est.lines.map((l) => <li key={l.label} className="flex justify-between gap-3"><span>{l.label} × {l.qty}</span><span className="tabular-nums">{money(l.totalCents)}</span></li>)}
            </ul>
            <p className="m-0 flex justify-between gap-3 border-t border-ods-line pt-1 font-semibold"><span>Estimate (from)</span><span className="tabular-nums">{money(est.listCents)}</span></p>
            <p className="m-0 text-ods-small text-ods-slate">A starting price: we confirm the exact fee, and you pay it before we confirm the trip.</p>
          </>
        )}
      </div>
      <ActionMessage msg={msg} />
      <div><Button type="submit" loading={pending} disabled={!!est.problem} disabledReason={est.problem ? 'Fill in the dates and travellers first.' : undefined}>Send request</Button></div>
    </form>
  );
}

export function TripCancel({ code, tripId }: { code: string; tripId: string }) {
  const { pending, msg, run } = useRun();
  const [reason, setReason] = useState('');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await cancelTripAction(code, tripId, reason); return { ok: r.ok, text: r.message }; }); }}>
      <Field label="Cancel this visit (tell us why)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
      <div><Button type="submit" variant="secondary" size="sm" disabled={pending || !reason.trim()}>Cancel visit</Button></div>
      <ActionMessage msg={msg} />
    </form>
  );
}

/** Passport copy straight to the PRIVATE bucket turnkey-passports (same path rule as today), then registerPassportAction. */
export function PassportUpload({ code, projectId, tripId, position }: { code: string; projectId: string; tripId: string; position: number }) {
  const { pending, msg, setMsg, run } = useRun();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setMsg({ ok: false, text: 'Choose the passport copy.' }); return; }
    if (!(TK_PASSPORT_TYPES as readonly string[]).includes(file.type)) { setMsg({ ok: false, text: 'Upload a PDF, JPG, PNG or WEBP file.' }); return; }
    if (file.size > TK_PASSPORT_MAX_BYTES) { setMsg({ ok: false, text: 'Files can be up to 10 MB.' }); return; }
    run(async () => {
      const tid = crypto.randomUUID();
      const path = `${projectId}/${tripId}/${tid}.${passportExt(file.type)}`;
      const up = await createClient().storage.from('turnkey-passports').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) return { ok: false, text: 'The upload did not finish. Please try again.' };
      const r = await registerPassportAction(code, tid, tripId, position, name, path);
      return { ok: r.ok, text: r.message };
    }, () => { setName(''); setFile(null); });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 ods-tablet:grid-cols-2">
        <Field label={`Traveller ${position}: name as in the passport`}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" /></Field>
        <Field label="Passport copy (PDF or photo, up to 10 MB)"><Input type="file" accept={TK_PASSPORT_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
      <ActionMessage msg={msg} />
      <div><Button type="submit" variant="secondary" size="sm" loading={pending} loadingText="Uploading…" disabled={!file || !name.trim()}>Upload securely</Button></div>
    </form>
  );
}

export function PassportDelete({ code, travellerId, position }: { code: string; travellerId: string; position: number }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="ghost" size="sm" loading={pending} onClick={() => run(async () => { const r = await deletePassportAction(code, travellerId); return { ok: r.ok, text: r.message }; })}>
        Delete<span className="sr-only"> passport copy of traveller {position}</span>
      </Button>
      <ActionMessage msg={msg} />
    </span>
  );
}

/** Handover sign-off with the typed full name; completes the project (today's signHandoverAction). */
export function HandoverSign({ code, projectId }: { code: string; projectId: string }) {
  const { pending, msg, run } = useRun();
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [agree, setAgree] = useState(false);
  const why = !agree ? 'Tick the box first.' : name.trim().length < 2 ? 'Type your full name first.' : undefined;
  return (
    <form className="flex flex-col gap-3" aria-labelledby="sign-h" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await signHandoverAction(code, projectId, name, comment); return { ok: r.ok, text: r.message }; }); }}>
      <h4 id="sign-h" className="m-0 text-ods-body font-semibold text-ods-navy">Sign the handover</h4>
      <Checkbox label="I received the goods and the final documents listed above. Signing completes the project." checked={agree} onCheckedChange={setAgree} />
      <div className="grid grid-cols-1 gap-3 ods-tablet:grid-cols-2">
        <Field label="Your full name (your signature)" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></Field>
        <Field label="Comment" optional><Input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} /></Field>
      </div>
      <ActionMessage msg={msg} />
      <div><Button type="submit" loading={pending} disabled={!!why} disabledReason={why}>Sign and complete</Button></div>
    </form>
  );
}
