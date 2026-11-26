'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { money } from '@/lib/format';
import { TK_PASSPORT_MAX_BYTES, TK_PASSPORT_TYPES, passportExt, tripPrice, type TkTripPrices } from '@/lib/turnkey/format';
import { cancelTripAction, deletePassportAction, registerPassportAction, requestTripAction, signHandoverAction } from '@/app/account/turnkey/actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;

/**
 * Turnkey T6 — the client's China visit request (design: ChinaVisit; "Visit China with us — from $399 per day, up to 2
 * people; extra traveller $99 per day"; extras visa letter $49, car and driver $100 per day, airport pick-up $39, hotel
 * help free). The estimate is worked out here from the services list and again by the database, which keeps it on the
 * request; the team then confirms the exact fee, which is paid before the trip is confirmed.
 */
export function TripRequestForm({ code, projectId, prices }: { code: string; projectId: string; prices: TkTripPrices }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [startOn, setStartOn] = useState('');
  const [endOn, setEndOn] = useState('');
  const [travellers, setTravellers] = useState('2');
  const [visa, setVisa] = useState('0');
  const [car, setCar] = useState('0');
  const [pickups, setPickups] = useState('0');
  const [hotel, setHotel] = useState(false);
  const [message, setMessage] = useState('');
  const num = (v: string) => (/^\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : -1);
  const input = { start: startOn, end: endOn, travellers: num(travellers), visaLetters: num(visa), carDays: num(car), airportPickups: num(pickups), hotelHelp: hotel };
  const est = tripPrice(prices, input);
  const field = (id: string, label: string, value: string, set: (v: string) => void, max: number) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} max={max} className="input min-h-11" value={value} onChange={(e) => set(e.target.value)} data-testid={id} />
    </div>
  );
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-trip-new-h" data-testid="tk-trip-request"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await requestTripAction(code, projectId, { ...input, message }); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); }); }}>
      <h3 id="tk-trip-new-h" className="m-0 text-[15px] font-semibold">Ask for a China visit</h3>
      <Note msg={msg} id="tk-trip-request-msg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-trip-start">First day (tomorrow or later) *</label>
          <input id="tk-trip-start" type="date" className="input min-h-11" value={startOn} onChange={(e) => setStartOn(e.target.value)} data-testid="tk-trip-start" />
        </div>
        <div>
          <label className="label" htmlFor="tk-trip-end">Last day *</label>
          <input id="tk-trip-end" type="date" min={startOn || undefined} className="input min-h-11" value={endOn} onChange={(e) => setEndOn(e.target.value)} data-testid="tk-trip-end" />
        </div>
        {field('tk-trip-travellers', `Travellers (the day price covers up to ${prices.includedTravellers})`, travellers, setTravellers, 20)}
        {field('tk-trip-visa', 'Visa invitation letters', visa, setVisa, 20)}
        {field('tk-trip-car', 'Car and driver (days)', car, setCar, 30)}
        {field('tk-trip-pickups', 'Airport pick-ups', pickups, setPickups, 10)}
      </div>
      <label className="flex items-center gap-2 text-[14px] min-h-11">
        <input type="checkbox" checked={hotel} onChange={(e) => setHotel(e.target.checked)} className="w-5 h-5" data-testid="tk-trip-hotel" />
        Hotel help (free)
      </label>
      <div>
        <label className="label" htmlFor="tk-trip-message">What would you like to see? (optional)</label>
        <textarea id="tk-trip-message" className="input min-h-16" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
      </div>
      <div className="border border-line rounded-[12px] p-4 flex flex-col gap-1 text-[14px]" aria-live="polite" data-testid="tk-trip-estimate">
        {est.problem ? <p className="m-0 text-muted">{est.problem}</p> : (
          <>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {est.lines.map((l) => <li key={l.label} className="flex justify-between gap-3"><span>{l.label} × {l.qty}</span><span className="mono">{money(l.totalCents)}</span></li>)}
            </ul>
            <p className="m-0 flex justify-between gap-3 font-semibold border-t border-line pt-1"><span>Estimate (from)</span><span className="mono" data-testid="tk-trip-estimate-total">{money(est.listCents)}</span></p>
            <p className="m-0 text-[12.5px] text-muted">A starting price: we confirm the exact fee, and you pay it before we confirm the trip.</p>
          </>
        )}
      </div>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !!est.problem} data-testid="tk-trip-submit">Send request</button></div>
    </form>
  );
}

export function TripCancelClient({ code, tripId }: { code: string; tripId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [reason, setReason] = useState('');
  const id = `tk-trip-cancel-${tripId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await cancelTripAction(code, tripId, reason); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); }); }}>
      <Note msg={msg} id="tk-trip-cancel-msg" />
      <label className="label" htmlFor={id}>Cancel this visit (tell us why)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Cancel visit</button>
      </div>
    </form>
  );
}

/**
 * Passport copy for one traveller (design: Legal "secure passport upload"). The file goes from the browser straight to
 * the PRIVATE bucket turnkey-passports; only your company and the team arranging the visit can open it, through links
 * that expire after a minute. You can delete it at any time; we delete copies 30 days after the visit.
 */
export function PassportUpload({ code, projectId, tripId, position }: { code: string; projectId: string; tripId: string; position: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const id = `tk-pass-${position}`;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setMsg({ ok: false, text: 'Choose the passport copy.' }); return; }
    if (!(TK_PASSPORT_TYPES as readonly string[]).includes(file.type)) { setMsg({ ok: false, text: 'Upload a PDF, JPG, PNG or WEBP file.' }); return; }
    if (file.size > TK_PASSPORT_MAX_BYTES) { setMsg({ ok: false, text: 'Files can be up to 10 MB.' }); return; }
    start(async () => {
      const tid = crypto.randomUUID();
      const path = `${projectId}/${tripId}/${tid}.${passportExt(file.type)}`;
      const up = await createClient().storage.from('turnkey-passports').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setMsg({ ok: false, text: 'The upload did not finish. Please try again.' }); return; }
      const r = await registerPassportAction(code, tid, tripId, position, name, path);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setName(''); setFile(null); router.refresh(); }
    });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid={`tk-passport-form-${position}`}>
      <Note msg={msg} id={`tk-passport-msg-${position}`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${id}-name`}>Traveller {position}: name as in the passport</label>
          <input id={`${id}-name`} className="input min-h-11" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" data-testid={`tk-passport-name-${position}`} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-file`}>Passport copy (PDF or photo, up to 10 MB)</label>
          <input id={`${id}-file`} type="file" className="input min-h-11" accept={TK_PASSPORT_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid={`tk-passport-file-${position}`} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !file || !name.trim()} data-testid={`tk-passport-save-${position}`}>{pending ? 'Uploading…' : 'Upload securely'}</button></div>
    </form>
  );
}

export function PassportDelete({ code, travellerId, position }: { code: string; travellerId: string; position: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} data-testid={`tk-passport-delete-${position}`}
        onClick={() => start(async () => { const r = await deletePassportAction(code, travellerId); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); })}>
        Delete<span className="sr-only"> passport copy of traveller {position}</span>
      </button>
      <Note msg={msg} id={`tk-passport-del-msg-${position}`} />
    </span>
  );
}

/** Handover sign-off (design: Handover "final documents, sign-off"): typed full name; completes the project. */
export function HandoverSignForm({ code, projectId }: { code: string; projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [agree, setAgree] = useState(false);
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-sign-h" data-testid="tk-handover-sign"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await signHandoverAction(code, projectId, name, comment); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh(); }); }}>
      <h3 id="tk-sign-h" className="m-0 text-[15px] font-semibold">Sign the handover</h3>
      <Note msg={msg} id="tk-handover-sign-msg" />
      <label className="flex items-start gap-2 text-[14px] min-h-11">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="w-5 h-5 mt-0.5" data-testid="tk-handover-agree" />
        I received the goods and the final documents listed above. Signing completes the project.
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-sign-name">Your full name (your signature) *</label>
          <input id="tk-sign-name" className="input min-h-11" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" data-testid="tk-handover-name" />
        </div>
        <div>
          <label className="label" htmlFor="tk-sign-comment">Comment (optional)</label>
          <input id="tk-sign-comment" className="input min-h-11" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !agree || name.trim().length < 2} data-testid="tk-handover-submit">Sign and complete</button></div>
    </form>
  );
}
