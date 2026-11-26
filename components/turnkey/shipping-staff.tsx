'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TK_DOC_MAX_BYTES, TK_DOC_TYPES, TK_HANDOVER_DOC_KINDS, TK_SHIPMENT_DOC_KINDS, TK_SHIPMENT_MODES, nextShipmentStatuses, shipmentStatusLabel } from '@/lib/turnkey/format';
import {
  addHandoverItemAction, addShipmentEventAction, cancelShipmentAction, createShipmentAction, issueBalanceAction, registerDocumentAction, releaseDocumentAction,
  removeDocumentAction, removeHandoverItemAction, setHandoverItemAction, withdrawDocumentAction, type ShipmentInput,
} from '@/app/admin/turnkey/projects/actions';

type Msg = { ok: boolean; text: string } | null;
type R = { ok: boolean; message?: string; error?: string };
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const act = (fn: () => Promise<R>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { pending, msg, setMsg, act, start, router };
}

/**
 * Turnkey T6 — staff tools for the balance, shipments, tracking, shipping / final documents and the handover checklist
 * (design: "7. Shipment: booking, tracking and shipping documents"; "8. Handover: final documents, sign-off"). Every
 * change goes through a tk_* function that checks the Turnkey edit right, the TK division and 2FA again. Files go
 * straight from the browser to the private bucket turnkey-documents and start as drafts the client cannot see.
 */
export function BalanceIssueButton({ projectId, code, label }: { projectId: string; code: string; label: string }) {
  const { pending, msg, act } = useAct();
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id="tk-balance-msg" />
      <div><button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act(() => issueBalanceAction(projectId, code))} data-testid="tk-balance-issue">{label}</button></div>
    </div>
  );
}

const emptyShipment: ShipmentInput = { mode: 'sea', carrier: '', bookingRef: '', containerNo: '', trackingNo: '', origin: '', destination: '', etd: '', eta: '', staffNote: '' };

export function ShipmentCreateForm({ projectId, code }: { projectId: string; code: string }) {
  const { pending, msg, act } = useAct();
  const [s, setS] = useState<ShipmentInput>(emptyShipment);
  const f = (k: keyof ShipmentInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });
  const input = (k: keyof ShipmentInput, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`tk-sh-${k}`}>{label}</label>
      <input id={`tk-sh-${k}`} className="input min-h-11" value={s[k]} onChange={f(k)} data-testid={`tk-sh-${k}`} {...extra} />
    </div>
  );
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-sh-new-h" data-testid="tk-shipment-create"
      onSubmit={(e) => { e.preventDefault(); act(() => createShipmentAction(projectId, code, s), () => setS(emptyShipment)); }}>
      <h3 id="tk-sh-new-h" className="m-0 text-[15px] font-semibold">Book a shipment</h3>
      <Note msg={msg} id="tk-shipment-create-msg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-sh-mode">Mode</label>
          <select id="tk-sh-mode" className="input min-h-11" value={s.mode} onChange={f('mode')} data-testid="tk-sh-mode">
            {TK_SHIPMENT_MODES.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>
        </div>
        {input('carrier', 'Carrier or forwarder (the client sees it) *', { maxLength: 120 })}
        {input('bookingRef', 'Booking reference', { maxLength: 80 })}
        {input('containerNo', 'Container number', { maxLength: 24 })}
        {input('trackingNo', 'Tracking number (air / express)', { maxLength: 80 })}
        {input('origin', 'From (port or city)', { maxLength: 120 })}
        {input('destination', 'To (port or city)', { maxLength: 120 })}
        {input('etd', 'Departure (ETD)', { type: 'date' })}
        {input('eta', 'Arrival (ETA)', { type: 'date' })}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tk-sh-staffNote">Staff note (rates, forwarder contact; never shown to the client)</label>
          <textarea id="tk-sh-staffNote" className="input min-h-16" value={s.staffNote} onChange={f('staffNote')} maxLength={2000} />
        </div>
      </div>
      <p className="m-0 text-[12.5px] text-muted">Never name a factory: the client deals only with Octopus (the database refuses it).</p>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !s.carrier.trim()} data-testid="tk-sh-save">Book shipment</button></div>
    </form>
  );
}

/** A tracking event: when, optional new status (forward only), where, what happened. */
export function ShipmentEventForm({ shipmentId, code, status, seq }: { shipmentId: string; code: string; status: string; seq: number }) {
  const { pending, msg, act } = useAct();
  const [at, setAt] = useState('');
  const [next, setNext] = useState('');
  const [loc, setLoc] = useState('');
  const [desc, setDesc] = useState('');
  const id = `tk-ev-${seq}`;
  const options = nextShipmentStatuses(status);
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-event-form-${seq}`}
      onSubmit={(e) => { e.preventDefault(); const iso = at ? new Date(at).toISOString() : new Date().toISOString(); act(() => addShipmentEventAction(shipmentId, code, iso, next, loc, desc), () => { setAt(''); setNext(''); setLoc(''); setDesc(''); }); }}>
      <h4 className="m-0 text-[14px] font-semibold">Add a tracking event</h4>
      <Note msg={msg} id={`tk-event-msg-${seq}`} />
      <div className="grid grid-cols-1 sm:grid-cols-[200px_170px_1fr] gap-2">
        <div>
          <label className="label" htmlFor={`${id}-at`}>When (empty = now)</label>
          <input id={`${id}-at`} type="datetime-local" className="input min-h-11" value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-st`}>New status</label>
          <select id={`${id}-st`} className="input min-h-11" value={next} onChange={(e) => setNext(e.target.value)} data-testid={`tk-event-status-${seq}`}>
            <option value="">No change</option>
            {options.map((o) => <option key={o} value={o}>{shipmentStatusLabel(o).label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-loc`}>Where</label>
          <input id={`${id}-loc`} className="input min-h-11" value={loc} onChange={(e) => setLoc(e.target.value)} maxLength={120} data-testid={`tk-event-location-${seq}`} />
        </div>
        <div className="sm:col-span-3">
          <label className="label" htmlFor={`${id}-desc`}>What happened (the client sees it) *</label>
          <input id={`${id}-desc`} className="input min-h-11" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} data-testid={`tk-event-desc-${seq}`} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !desc.trim()} data-testid={`tk-event-save-${seq}`}>Add event</button></div>
    </form>
  );
}

export function ShipmentCancel({ shipmentId, code, seq }: { shipmentId: string; code: string; seq: number }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-sh-cancel-${seq}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act(() => cancelShipmentAction(shipmentId, code, reason)); }}>
      <Note msg={msg} id={`tk-sh-cancel-msg-${seq}`} />
      <label className="label" htmlFor={id}>Cancel this booking (reason, staff only)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Cancel shipment</button>
      </div>
    </form>
  );
}

/** Upload a shipping document (per shipment) or a final document to the private bucket; it starts as a draft. */
export function DocumentUpload({ projectId, code, section, shipments }: { projectId: string; code: string; section: 'shipment' | 'handover'; shipments: { id: string; seq: number }[] }) {
  const { pending, msg, setMsg, start, router } = useAct();
  const kinds = section === 'shipment' ? TK_SHIPMENT_DOC_KINDS : TK_HANDOVER_DOC_KINDS;
  const [kind, setKind] = useState(kinds[0].code);
  const [shipment, setShipment] = useState(shipments[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  const p = `tk-doc-${section}`;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setMsg({ ok: false, text: 'Choose a file.' }); return; }
    if (!(TK_DOC_TYPES as readonly string[]).includes(file.type)) { setMsg({ ok: false, text: 'Upload a PDF, JPG, PNG or WEBP file.' }); return; }
    if (file.size > TK_DOC_MAX_BYTES) { setMsg({ ok: false, text: 'Files can be up to 20 MB.' }); return; }
    if (section === 'shipment' && !shipment) { setMsg({ ok: false, text: 'Choose the shipment.' }); return; }
    start(async () => {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
      const path = `${projectId}/${crypto.randomUUID()}-${safe}`;
      const up = await createClient().storage.from('turnkey-documents').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setMsg({ ok: false, text: `Upload failed: ${up.error.message}` }); return; }
      const r = await registerDocumentAction(projectId, code, section, kind, title, path, file.name, section === 'shipment' ? shipment : '');
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Uploaded.' : r.error ?? 'Something went wrong.' });
      if (r.ok) { setFile(null); setTitle(''); setKey((k) => k + 1); router.refresh(); }
    });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-labelledby={`${p}-h`} data-testid={`${p}-upload`}>
      <h3 id={`${p}-h`} className="m-0 text-[15px] font-semibold">{section === 'shipment' ? 'Add a shipping document' : 'Add a final document'}</h3>
      <Note msg={msg} id={`${p}-msg`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {section === 'shipment' && (
          <div>
            <label className="label" htmlFor={`${p}-sh`}>Shipment</label>
            <select id={`${p}-sh`} className="input min-h-11" value={shipment} onChange={(e) => setShipment(e.target.value)}>
              {shipments.map((s) => <option key={s.id} value={s.id}>Shipment {s.seq}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor={`${p}-kind`}>Document</label>
          <select id={`${p}-kind`} className="input min-h-11" value={kind} onChange={(e) => setKind(e.target.value)} data-testid={`${p}-kind`}>
            {kinds.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${p}-title`}>Title the client sees (optional)</label>
          <input id={`${p}-title`} className="input min-h-11" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid={`${p}-title`} />
        </div>
        <div>
          <label className="label" htmlFor={`${p}-file`}>File (PDF, JPG, PNG or WEBP, up to 20 MB) *</label>
          <input key={key} id={`${p}-file`} type="file" className="input min-h-11" accept={TK_DOC_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid={`${p}-file`} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !file} data-testid={`${p}-save`}>{pending ? 'Uploading…' : 'Upload as draft'}</button></div>
    </form>
  );
}

/** Share a draft, remove a draft, or withdraw a shared document (reason staff-only). */
export function DocumentActions({ documentId, code, status, testId }: { documentId: string; code: string; status: string; testId: string }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-doc-wd-${documentId}`;
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id={`tk-doc-msg-${testId}`} />
      {status === 'draft' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act(() => releaseDocumentAction(documentId, code))} data-testid={`tk-doc-release-${testId}`}>Share with the client</button>
          <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => removeDocumentAction(documentId, code))} data-testid={`tk-doc-remove-${testId}`}>Remove draft</button>
        </div>
      )}
      {status === 'released' && (
        <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); act(() => withdrawDocumentAction(documentId, code, reason)); }}>
          <div className="flex-1">
            <label className="label" htmlFor={id}>Withdraw (reason, staff only)</label>
            <input id={id} className="input min-h-11" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Withdraw</button>
        </form>
      )}
    </div>
  );
}

export function HandoverItemForm({ projectId, code }: { projectId: string; code: string }) {
  const { pending, msg, act } = useAct();
  const [label, setLabel] = useState('');
  return (
    <form className="flex flex-col gap-2" data-testid="tk-ho-add" onSubmit={(e) => { e.preventDefault(); act(() => addHandoverItemAction(projectId, code, label), () => setLabel('')); }}>
      <Note msg={msg} id="tk-ho-add-msg" />
      <label className="label" htmlFor="tk-ho-label">New checklist line (the client sees it), e.g. Warranty certificates</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id="tk-ho-label" className="input min-h-11 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} data-testid="tk-ho-label" />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !label.trim()} data-testid="tk-ho-add-save">Add line</button>
      </div>
    </form>
  );
}

/** Tick a checklist line (optionally with a shared final document), untick it, or remove an open line. */
export function HandoverItemControls({ itemId, code, done, position, documents }: { itemId: string; code: string; done: boolean; position: number; documents: { id: string; title: string }[] }) {
  const { pending, msg, act } = useAct();
  const [doc, setDoc] = useState('');
  const id = `tk-ho-doc-${position}`;
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id={`tk-ho-msg-${position}`} />
      {done ? (
        <div><button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => setHandoverItemAction(itemId, code, false, ''))}>Mark not ready</button></div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          {documents.length > 0 && (
            <div className="flex-1">
              <label className="label" htmlFor={id}>Shared final document (optional)</label>
              <select id={id} className="input min-h-11" value={doc} onChange={(e) => setDoc(e.target.value)} data-testid={`tk-ho-doc-${position}`}>
                <option value="">None</option>
                {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act(() => setHandoverItemAction(itemId, code, true, doc))} data-testid={`tk-ho-done-${position}`}>Mark ready</button>
          <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => removeHandoverItemAction(itemId, code))}>Remove line</button>
        </div>
      )}
    </div>
  );
}
