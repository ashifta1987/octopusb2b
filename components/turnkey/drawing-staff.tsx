'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TK_DRAWING_MAX_BYTES, TK_DRAWING_TYPES } from '@/lib/turnkey/format';
import { registerDrawingAction, staffDrawingCommentAction, waiveDrawingFeeAction } from '@/app/admin/turnkey/projects/actions';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok-line text-ok font-semibold' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;

/**
 * Turnkey T4 — staff share the next layout drawing version (design: Drawing). The browser uploads the file straight to the
 * private bucket (storage policy: Turnkey editors, project in Design), then the server registers it as the next version;
 * the database checks type, size, the free versions and the extra-version payment. Files never go through a public URL.
 */
export function DrawingUpload({ projectId, code, nextVersion, blocked }: { projectId: string; code: string; nextVersion: number; blocked: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setMsg({ ok: false, text: 'Choose a file.' }); return; }
    if (!(TK_DRAWING_TYPES as readonly string[]).includes(file.type)) { setMsg({ ok: false, text: 'Upload a PDF, JPG, PNG or WEBP file.' }); return; }
    if (file.size > TK_DRAWING_MAX_BYTES) { setMsg({ ok: false, text: 'Files can be up to 20 MB.' }); return; }
    start(async () => {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120);
      const path = `${projectId}/${crypto.randomUUID()}-${safe}`;
      const up = await createClient().storage.from('turnkey-drawings').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setMsg({ ok: false, text: `Upload failed: ${up.error.message}` }); return; }
      const r = await registerDrawingAction(projectId, code, path, file.name, message);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Shared.' : r.error ?? 'Something went wrong.' });
      if (r.ok) { setFile(null); setMessage(''); router.refresh(); }
    });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-labelledby="tk-dr-up-h" data-testid="tk-drawing-upload">
      <h3 id="tk-dr-up-h" className="m-0 text-[15px] font-semibold">Share version {nextVersion}</h3>
      <Note msg={msg} id="tk-drawing-msg" />
      {blocked && <p className="m-0 text-[13.5px] text-warn" data-testid="tk-drawing-blocked">{blocked}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-dr-file">Drawing file (PDF, JPG, PNG or WEBP, up to 20 MB) *</label>
          <input id="tk-dr-file" type="file" className="input min-h-11" accept={TK_DRAWING_TYPES.join(',')} data-testid="tk-drawing-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!!blocked} />
        </div>
        <div>
          <label className="label" htmlFor="tk-dr-msg">Message to the client (optional)</label>
          <input id="tk-dr-msg" className="input min-h-11" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} data-testid="tk-drawing-message" disabled={!!blocked} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !!blocked || !file} data-testid="tk-drawing-share">{pending ? 'Uploading…' : `Share version ${nextVersion}`}</button></div>
    </form>
  );
}

export function StaffDrawingComment({ versionId, code }: { versionId: string; code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const id = `tk-dr-sc-${versionId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await staffDrawingCommentAction(versionId, code, body); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Sent.' : r.error ?? 'Something went wrong.' }); if (r.ok) { setBody(''); router.refresh(); } }); }}>
      <label className="label" htmlFor={id}>Reply to the client</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !body.trim()}>Send</button>
      </div>
      <Note msg={msg} id={`tk-dr-sc-msg-${versionId}`} />
    </form>
  );
}

/** Admins: waive an unpaid extra version charge with a reason (its proforma is cancelled). */
export function WaiveExtraFee({ extraId, code, version }: { extraId: string; code: string; version: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const id = `tk-waive-${extraId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await waiveDrawingFeeAction(extraId, code, reason); setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Waived.' : r.error ?? 'Something went wrong.' }); if (r.ok) router.refresh(); }); }}>
      <label className="label" htmlFor={id}>Waive the charge for version {version} (admins, staff-only reason)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid={`tk-waive-reason-${version}`} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()} data-testid={`tk-waive-${version}`}>Waive</button>
      </div>
      <Note msg={msg} id={`tk-waive-msg-${version}`} />
    </form>
  );
}
