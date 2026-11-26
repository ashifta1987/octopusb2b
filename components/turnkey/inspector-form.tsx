'use client';

import { useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TK_ANSWERS, TK_PHOTO_MAX_BYTES, TK_PHOTO_TYPES, TK_RESULTS, aqlProblem, inspectionLabel, parseCount, photoExt } from '@/lib/turnkey/format';
import { registerInspectionPhotoAction, removeInspectionPhotoAction, startInspectionAction, submitInspectionAction } from '@/app/office/turnkey/inspect/actions';

type Item = { id: string; position: number; label: string; answer: string | null; remark: string | null };
type Photo = { id: string; item_id: string | null; file_path: string; url?: string | null };
export type InspectorJobProps = {
  id: string; projectId: string; kind: string; round: number; status: string; paid: boolean; projectOpen: boolean;
  items: Item[]; photos: Photo[];
  report: { submission_id: string; lot_size: number; sample_size: number; critical_defects: number; major_defects: number; minor_defects: number; result: string; remarks: string | null; signed_name: string } | null;
};
type Draft = {
  answers: Record<string, string>; itemRemarks: Record<string, string>; lot: string; sample: string; crit: string; major: string; minor: string;
  result: string; remarks: string; signed: string; submissionId: string | null;
};
type Msg = { ok: boolean; text: string } | null;

/*
 * The unsent report lives on the phone (localStorage, read through an external store so server and browser render the
 * same). It survives a reload or a lost connection; the submission id is made once and kept, so sending again after a
 * time-out is accepted once by the database (tk_submit_inspection is idempotent). This is the base for the offline mode
 * that comes later (programme D6): photos already carry ids made on the phone.
 */
const EVT = 'octopus-inspection-draft';
const memory = new Map<string, string>();
const keyOf = (id: string) => `tk-inspect:${id}`;
const subscribe = (cb: () => void) => { window.addEventListener('storage', cb); window.addEventListener(EVT, cb); return () => { window.removeEventListener('storage', cb); window.removeEventListener(EVT, cb); }; };
const readRaw = (id: string) => { try { return window.localStorage.getItem(keyOf(id)) ?? memory.get(id) ?? ''; } catch { return memory.get(id) ?? ''; } };
const writeRaw = (id: string, v: string | null) => {
  if (v == null) memory.delete(id); else memory.set(id, v);
  try { if (v == null) window.localStorage.removeItem(keyOf(id)); else window.localStorage.setItem(keyOf(id), v); } catch { /* storage disabled: memory only */ }
  window.dispatchEvent(new Event(EVT));
};

function fromJob(j: InspectorJobProps): Draft {
  const r = j.report;
  return {
    answers: Object.fromEntries(j.items.filter((i) => i.answer).map((i) => [i.id, i.answer as string])),
    itemRemarks: Object.fromEntries(j.items.filter((i) => i.remark).map((i) => [i.id, i.remark as string])),
    lot: r ? String(r.lot_size) : '', sample: r ? String(r.sample_size) : '', crit: r ? String(r.critical_defects) : '', major: r ? String(r.major_defects) : '',
    minor: r ? String(r.minor_defects) : '', result: r?.result ?? '', remarks: r?.remarks ?? '', signed: r?.signed_name ?? '', submissionId: null,
  };
}

export function InspectorForm({ job }: { job: InspectorJobProps }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [photoItem, setPhotoItem] = useState('');
  const raw = useSyncExternalStore(subscribe, () => readRaw(job.id), () => '');
  const draft: Draft = useMemo(() => {
    let d: Draft;
    try { d = raw ? { ...fromJob(job), ...JSON.parse(raw) } : fromJob(job); } catch { d = fromJob(job); }
    // a report the team returned needs a new submission id (the old one was used)
    return d.submissionId && d.submissionId === job.report?.submission_id ? { ...d, submissionId: null } : d;
  }, [raw, job]);
  const set = (patch: Partial<Draft>) => writeRaw(job.id, JSON.stringify({ ...draft, ...patch }));
  const open = (job.status === 'scheduled' || job.status === 'in_progress') && job.projectOpen && job.paid;
  const missing = job.items.filter((i) => !draft.answers[i.id]).map((i) => i.position);
  const problem = aqlProblem(parseCount(draft.lot), parseCount(draft.sample), parseCount(draft.crit, 1_000_000), parseCount(draft.major, 1_000_000), parseCount(draft.minor, 1_000_000))
    ?? (missing.length ? `Answer every checklist line (missing: ${missing.join(', ')}).` : null)
    ?? (!draft.result ? 'Choose the result.' : null)
    ?? (draft.result !== 'pass' && !draft.remarks.trim() ? 'Explain the remarks or the failure.' : null)
    ?? (!draft.signed.trim() ? 'Sign with your full name.' : null);

  const onStart = () => start(async () => {
    const r = await startInspectionAction(job.id);
    setMsg({ ok: r.ok, text: r.ok ? 'Started. Take photos and fill in the checklist.' : r.error ?? 'Something went wrong.' });
    if (r.ok) router.refresh();
  });

  const onPhoto = (file: File | null) => {
    if (!file) return;
    if (!(TK_PHOTO_TYPES as readonly string[]).includes(file.type)) { setMsg({ ok: false, text: 'Take a JPG, PNG or WEBP photo.' }); return; }
    if (file.size > TK_PHOTO_MAX_BYTES) { setMsg({ ok: false, text: 'Photos can be up to 10 MB.' }); return; }
    start(async () => {
      const photoId = crypto.randomUUID();
      const path = `${job.projectId}/${job.id}/${photoId}.${photoExt(file.type)}`;
      const up = await createClient().storage.from('turnkey-inspections').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setMsg({ ok: false, text: `Upload failed: ${up.error.message}. Try again.` }); return; }
      const r = await registerInspectionPhotoAction(photoId, job.id, path, photoItem || null);
      setMsg({ ok: r.ok, text: r.ok ? 'Photo added.' : r.error ?? 'Something went wrong.' });
      if (r.ok) router.refresh();
    });
  };

  const onRemove = (photoId: string) => start(async () => {
    const r = await removeInspectionPhotoAction(photoId, job.id);
    setMsg({ ok: r.ok, text: r.ok ? 'Photo removed.' : r.error ?? 'Something went wrong.' });
    if (r.ok) router.refresh();
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (problem) { setMsg({ ok: false, text: problem }); return; }
    const submissionId = draft.submissionId ?? crypto.randomUUID();
    if (!draft.submissionId) set({ submissionId });   // kept on the phone: a retry sends the same id
    start(async () => {
      const r = await submitInspectionAction(job.id, submissionId, {
        lot_size: parseCount(draft.lot)!, sample_size: parseCount(draft.sample)!, critical_defects: parseCount(draft.crit, 1_000_000)!,
        major_defects: parseCount(draft.major, 1_000_000)!, minor_defects: parseCount(draft.minor, 1_000_000)!, result: draft.result,
        remarks: draft.remarks.trim() || null, signed_name: draft.signed.trim(),
        answers: job.items.map((i) => ({ item_id: i.id, answer: draft.answers[i.id], remark: draft.itemRemarks[i.id]?.trim() || null })),
      });
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Report submitted.' : r.error ?? 'Something went wrong.' });
      if (r.ok || r.stale) { writeRaw(job.id, null); router.refresh(); }
    });
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-3" data-testid="tk-insp-closed">
        {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid="tk-insp-msg">{msg.text}</p>}
        <p className="m-0 text-[15px]">
          {job.status === 'submitted' ? 'Report submitted. The team reviews it and publishes it to the client.'
            : job.status === 'published' ? 'Report published to the client.'
            : !job.paid ? 'The inspection fee is not paid yet. Do not start.'
            : !job.projectOpen ? 'The project is not open at the moment. Do not start.'
            : 'This inspection is not open.'}
        </p>
      </div>
    );
  }

  const n = (k: 'lot' | 'sample' | 'crit' | 'major' | 'minor', label: string) => (
    <div>
      <label className="label" htmlFor={`tk-insp-${k}`}>{label}</label>
      <input id={`tk-insp-${k}`} className="input min-h-12 text-[17px]" inputMode="numeric" pattern="[0-9]*" value={draft[k]} onChange={(e) => set({ [k]: e.target.value.replace(/[^\d]/g, '') } as Partial<Draft>)} data-testid={`tk-insp-${k}`} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-testid="tk-insp-form" aria-label={`${inspectionLabel(job.kind, job.round)} report`}>
      {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid="tk-insp-msg">{msg.text}</p>}
      {job.status === 'scheduled' && (
        <button type="button" className="btn btn-primary min-h-12 w-full" onClick={onStart} disabled={pending} data-testid="tk-insp-start">Start inspection</button>
      )}

      <section aria-labelledby="tk-insp-check-h" className="flex flex-col gap-3">
        <h2 id="tk-insp-check-h" className="m-0 text-[17px] font-semibold">Checklist</h2>
        {job.items.map((i) => (
          <fieldset key={i.id} className="m-0 border border-line rounded-[12px] p-3 flex flex-col gap-2" data-testid={`tk-insp-item-${i.position}`}>
            <legend className="px-1 text-[15px] font-semibold">{i.position}. {i.label}</legend>
            <div className="grid grid-cols-3 gap-2">
              {TK_ANSWERS.map((a) => {
                const on = draft.answers[i.id] === a.code;
                return (
                  <label key={a.code} className={`min-h-12 rounded-[10px] border flex items-center justify-center gap-2 text-[15px] font-semibold cursor-pointer ${on ? (a.code === 'fail' ? 'bg-bad-bg border-bad text-bad' : a.code === 'pass' ? 'bg-ok-bg border-ok text-ok' : 'bg-tint border-line-strong') : 'border-line bg-white'}`}>
                    <input type="radio" name={`ans-${i.id}`} value={a.code} checked={on} onChange={() => set({ answers: { ...draft.answers, [i.id]: a.code } })} className="w-5 h-5" data-testid={`tk-insp-ans-${i.position}-${a.code}`} />
                    {a.label}
                  </label>
                );
              })}
            </div>
            <label className="label" htmlFor={`tk-insp-rm-${i.id}`}>Note for this line (staff only)</label>
            <input id={`tk-insp-rm-${i.id}`} className="input min-h-11" value={draft.itemRemarks[i.id] ?? ''} maxLength={1000} onChange={(e) => set({ itemRemarks: { ...draft.itemRemarks, [i.id]: e.target.value } })} />
          </fieldset>
        ))}
      </section>

      <section aria-labelledby="tk-insp-photo-h" className="flex flex-col gap-3">
        <h2 id="tk-insp-photo-h" className="m-0 text-[17px] font-semibold">Photos ({job.photos.length})</h2>
        {job.photos.length > 0 && (
          <ul className="list-none m-0 p-0 grid grid-cols-3 gap-2" data-testid="tk-insp-photos">
            {job.photos.map((p, k) => (
              <li key={p.id} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url ? <img src={p.url} alt={`Photo ${k + 1}${p.item_id ? ` (line ${job.items.find((i) => i.id === p.item_id)?.position ?? ''})` : ''}`} className="w-full aspect-square object-cover rounded-[8px] border border-line" /> : <span className="text-[13px]">Photo {k + 1}</span>}
                <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => onRemove(p.id)} disabled={pending}>Remove<span className="sr-only"> photo {k + 1}</span></button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <label className="label" htmlFor="tk-insp-photo-item">Photo for checklist line (optional)</label>
          <select id="tk-insp-photo-item" className="input min-h-12" value={photoItem} onChange={(e) => setPhotoItem(e.target.value)}>
            <option value="">General</option>
            {job.items.map((i) => <option key={i.id} value={i.id}>{i.position}. {i.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-insp-photo">Take or choose a photo (JPG, PNG, WEBP; up to 10 MB)</label>
          <input id="tk-insp-photo" type="file" accept={TK_PHOTO_TYPES.join(',')} capture="environment" className="input min-h-12" disabled={pending}
            onChange={(e) => { onPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }} data-testid="tk-insp-photo" />
        </div>
      </section>

      <section aria-labelledby="tk-insp-aql-h" className="flex flex-col gap-3">
        <h2 id="tk-insp-aql-h" className="m-0 text-[17px] font-semibold">AQL sampling</h2>
        <div className="grid grid-cols-2 gap-3">
          {n('lot', 'Lot size (pieces)')}
          {n('sample', 'Sample size (pieces)')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {n('crit', 'Critical')}
          {n('major', 'Major')}
          {n('minor', 'Minor')}
        </div>
      </section>

      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className="text-[17px] font-semibold mb-2">Result</legend>
        <div className="grid grid-cols-1 gap-2">
          {TK_RESULTS.map((r) => (
            <label key={r.code} className={`min-h-12 rounded-[10px] border px-3 flex items-center gap-3 text-[15px] font-semibold cursor-pointer ${draft.result === r.code ? 'border-ink bg-tint' : 'border-line bg-white'}`}>
              <input type="radio" name="result" value={r.code} checked={draft.result === r.code} onChange={() => set({ result: r.code })} className="w-5 h-5" data-testid={`tk-insp-result-${r.code}`} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="tk-insp-remarks">Remarks (staff only){draft.result && draft.result !== 'pass' ? ' *' : ''}</label>
        <textarea id="tk-insp-remarks" className="input min-h-24" value={draft.remarks} onChange={(e) => set({ remarks: e.target.value })} maxLength={4000} data-testid="tk-insp-remarks" />
      </div>
      <div>
        <label className="label" htmlFor="tk-insp-signed">Signature: your full name *</label>
        <input id="tk-insp-signed" className="input min-h-12" autoComplete="name" value={draft.signed} onChange={(e) => set({ signed: e.target.value })} maxLength={120} data-testid="tk-insp-signed" />
      </div>
      {problem && <p className="m-0 text-[13.5px] text-warn" data-testid="tk-insp-problem">{problem}</p>}
      <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={pending} data-testid="tk-insp-submit">{pending ? 'Sending…' : 'Submit report'}</button>
      <p className="m-0 text-[12.5px] text-muted">Your answers are kept on this phone until the report is sent.</p>
    </form>
  );
}
