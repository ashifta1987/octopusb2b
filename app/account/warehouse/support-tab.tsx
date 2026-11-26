'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { StatusBadge } from '@/components/ui';
import { ticketStatusLabel } from '@/components/account/support-shared';
import { createClient } from '@/lib/supabase/client';
import { fmtWh } from '@/lib/warehouse-inbound';
import { SUPPORT_KINDS, SUPPORT_KIND_LABEL, refKind, type SupportKind, type SupportRow } from '@/lib/warehouse-w5';
import { createSupportRequestAction } from './w5-actions';

/**
 * Warehouse OS · W5 portal Support tab (board 24): new request by type with an optional order / stock notice / return, request
 * list with status; the thread is the existing support conversation (/account/support/[id]) with the warehouse record linked.
 */
type Msg = { ok: boolean; text: string; id?: string } | null;
export type SupportRefs = { orders: { code: string; label: string }[]; asns: { code: string; label: string }[]; returns: { code: string; label: string }[] };
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

function safeFileName(name: string) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${base}.${ext}` : base;
}
const kindFor = (ref: string): SupportKind => {
  const k = refKind(ref);
  return k === 'order' ? 'order_problem' : k === 'asn' ? 'inbound' : k === 'return' ? 'return' : 'other';
};

function NewRequest({ orgId, refs, defaultRef }: { orgId: string; refs: SupportRefs; defaultRef: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [kind, setKind] = useState<SupportKind | ''>(defaultRef ? kindFor(defaultRef) : '');
  const [ref, setRef] = useState(defaultRef);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const why = !kind ? 'Choose the type of request' : subject.trim().length < 3 ? 'Enter a short subject' : body.trim().length < 5 ? 'Describe the problem or question' : null;
  return (
    <section className="card p-5" aria-labelledby="wh-sup-new" data-testid="wh-support-form">
      <h2 id="wh-sup-new" className="text-[18px] font-semibold m-0">New request</h2>
      <p className="mt-1 mb-4 text-[13.5px] text-black/75">Choose the order, stock notice or return it is about so our team sees the packing record and photos straight away. We reply within 1 business day.</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => {
        e.preventDefault();
        if (why || !kind) return;
        setMsg(null);
        start(async () => {
          const attachments: { path: string; name: string }[] = [];
          const sb = createClient();
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            setProgress(`Uploading ${i + 1} of ${files.length}…`);
            const path = `${orgId}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
            const { error } = await sb.storage.from('tickets').upload(path, f, { contentType: f.type || undefined });
            if (error) { setProgress(null); setMsg({ ok: false, text: `Upload failed for ${f.name}: ${error.message}` }); return; }
            attachments.push({ path, name: f.name });
          }
          setProgress('Sending…');
          const r = await createSupportRequestAction({ kind, subject, body, ref, attachments });
          setProgress(null);
          setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Sent.' : r.error ?? 'Something went wrong.', id: r.id });
          if (r.ok) { setSubject(''); setBody(''); setFiles([]); router.refresh(); }
        });
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="wh-sup-kind" className="label">Type of request *</label>
            <select id="wh-sup-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as SupportKind)}>
              <option value="">Choose a type</option>
              {SUPPORT_KINDS.map((k) => <option key={k} value={k}>{SUPPORT_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="wh-sup-ref" className="label">About (order, stock notice or return)</label>
            <select id="wh-sup-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)}>
              <option value="">Nothing specific</option>
              {refs.orders.length > 0 && <optgroup label="Orders">{refs.orders.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>}
              {refs.asns.length > 0 && <optgroup label="Stock notices">{refs.asns.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>}
              {refs.returns.length > 0 && <optgroup label="Returns">{refs.returns.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="wh-sup-subject" className="label">Subject *</label>
            <input id="wh-sup-subject" className="input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="wh-sup-body" className="label">What happened? *</label>
            <textarea id="wh-sup-body" className="input min-h-28 py-2" value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="wh-sup-files" className="label">Photos or files (optional, up to {MAX_FILES})</label>
            <input id="wh-sup-files" type="file" multiple accept="image/*,application/pdf" className="text-[14px] min-h-11" disabled={pending}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > MAX_FILES) { setMsg({ ok: false, text: `Choose up to ${MAX_FILES} files.` }); e.target.value = ''; return; }
                if (list.some((f) => f.size > MAX_BYTES)) { setMsg({ ok: false, text: 'Each file can be up to 10 MB.' }); e.target.value = ''; return; }
                setFiles(list);
              }} />
            <p className="mt-1 mb-0 text-[12.5px] text-black/70">A photo of a damaged carton or the label helps us resolve it faster.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={pending || Boolean(why)} aria-describedby={why ? 'wh-sup-why' : undefined} data-testid="wh-support-submit">Send request</button>
          {why && <span id="wh-sup-why" className="text-[13px] text-black/70">{why}</span>}
          {progress && <span className="text-[13px] text-black/70" role="status">{progress}</span>}
        </div>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-support-msg" className={`m-0 text-[14px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>
            {msg.text}{msg.ok && msg.id ? <> <Link href={`/account/support/${msg.id}`} className="underline">Open the conversation</Link></> : null}
          </p>
        )}
      </form>
    </section>
  );
}

export function SupportTab({ orgId, refs, requests, defaultRef }: { orgId: string; refs: SupportRefs; requests: SupportRow[]; defaultRef: string }) {
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-support-tab">
      <NewRequest orgId={orgId} refs={refs} defaultRef={defaultRef} />
      <section className="card p-0 overflow-hidden" aria-labelledby="wh-sup-list">
        <h2 id="wh-sup-list" className="text-[18px] font-semibold m-0 px-5 pt-5 pb-3">Your warehouse requests</h2>
        {requests.length === 0 ? <p className="px-5 pb-5 m-0 text-[14px] text-black/75">No requests yet.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Your warehouse requests">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr>
                  <th className="th pl-5">Request</th><th className="th">Subject</th><th className="th">About</th><th className="th">Status</th><th className="th">Updated</th>
                  <th className="th pr-5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((t) => (
                  <tr key={t.id} className="border-t border-line" data-testid={`wh-support-row-${t.code}`}>
                    <td className="py-2 pl-5 pr-3 font-mono text-[13px] whitespace-nowrap">{t.code}</td>
                    <td className="py-2 pr-3"><div className="font-semibold">{t.subject}</div><div className="text-[12.5px] text-black/70">{SUPPORT_KIND_LABEL[t.kind] ?? t.kind}</div></td>
                    <td className="py-2 pr-3 font-mono text-[13px]">{t.ref ?? '—'}</td>
                    <td className="py-2 pr-3"><StatusBadge status={t.status} label={ticketStatusLabel(t.status)} /></td>
                    <td className="py-2 pr-3 text-[13px] text-black/70 whitespace-nowrap">{fmtWh(t.updated_at)}</td>
                    <td className="py-2 pr-5 text-right"><Link href={`/account/support/${t.id}`} className="btn btn-ghost btn-sm">Open<span className="sr-only"> {t.code}</span></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
