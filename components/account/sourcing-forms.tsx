'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { postMessage, uploadFile } from '@/app/account/sourcing/actions';

/** "Ask a question" / reply to the sourcing team on a request. */
export function MessageForm({ kind, id, refCode, autoFocus = false, label = 'Ask the sourcing team' }: { kind: 'rfq' | 'service'; id: string; refCode: string; autoFocus?: boolean; label?: string }) {
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form id="ask" className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      setErr(null);
      start(async () => {
        const r = await postMessage({ kind, id, body, ref: refCode });
        if (!r.ok) return setErr(r.error);
        setBody(''); router.refresh();
      });
    }}>
      <label htmlFor="msg" className="label">{label}</label>
      <textarea id="msg" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={3} autoFocus={autoFocus}
        className="input py-2 min-h-[84px]" placeholder="e.g. Can the supplier do a custom logo? What is the carton size?" data-testid="message-input" />
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !body.trim()}>{pending ? 'Sending…' : 'Send'}</button>
    </form>
  );
}

/** Attach a photo, spec or invoice to a request (private storage). */
export function FileUpload({ kind, id, refCode }: { kind: 'rfq' | 'service'; id: string; refCode: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form ref={ref} className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setErr(null);
      start(async () => {
        const r = await uploadFile(fd);
        if (!r.ok) return setErr(r.error);
        ref.current?.reset(); router.refresh();
      });
    }}>
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="ref" value={refCode} />
      <label className="block"><span className="label">File</span>
        <input type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.docx,.txt" className="input py-2 text-sm" /></label>
      <label className="block"><span className="label">Type</span>
        <select name="file_kind" className="input" defaultValue="photo">
          <option value="photo">Photo</option><option value="spec">Spec / drawing</option><option value="invoice">Invoice</option><option value="other">Other</option>
        </select></label>
      <button type="submit" className="btn btn-ghost" disabled={pending}>{pending ? 'Uploading…' : 'Upload'}</button>
      {err && <p role="alert" className="basis-full text-sm text-bad">{err}</p>}
    </form>
  );
}
