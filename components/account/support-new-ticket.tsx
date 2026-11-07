'use client';
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, humanize } from '@/lib/format';
import { cn } from '@/lib/cn';
import { createTicket } from '@/app/account/support/actions';

export type SupportOrderOption = {
  id: string; code: string; title: string; status: string;
  delivered_at: string | null; claim_visible_until: string | null; claim_hidden_until: string | null;
};

type Category = 'complaint' | 'question' | 'feedback';
const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: 'complaint', label: 'Complaint', hint: 'A problem with an order or service' },
  { value: 'question', label: 'Question', hint: 'Orders, invoices, services, shipping' },
  { value: 'feedback', label: 'Feedback', hint: 'Tell us how we did or suggest something' },
];
const WHAT_HAPPENED = ['Shortage or wrong goods', 'Damaged in transit', 'Hidden defect', 'Not as specified', 'Late delivery', 'Invoice or payment', 'Service (sample, QC, 3PL)', 'Other'];
const REMEDIES = ['Let the team suggest the best fix', 'Replacement on next shipment', 'Credit on a future order', 'Refund of affected units'];

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const ACCEPT = 'image/*,video/mp4,video/quicktime,application/pdf,.xlsx,.xls,.csv';

function safeFileName(name: string) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${base}.${ext}` : base;
}

export function SupportNewTicket({ orders, defaultOrderId, orgId, now, defaultSubject = '', defaultBody = '' }: { orders: SupportOrderOption[]; defaultOrderId: string | null; orgId: string; now: number; defaultSubject?: string; defaultBody?: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(defaultOrderId ? 'complaint' : 'question');
  const [what, setWhat] = useState(WHAT_HAPPENED[0]);
  const [orderId, setOrderId] = useState<string>(defaultOrderId && orders.some((o) => o.id === defaultOrderId) ? defaultOrderId : '');
  const [subject, setSubject] = useState(defaultSubject);
  const [qty, setQty] = useState('');
  const [remedy, setRemedy] = useState(REMEDIES[0]);
  const [body, setBody] = useState(defaultBody);
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);

  function addFiles(list: FileList | null) {
    setErr(null);
    const arr = Array.from(list ?? []);
    const big = arr.find((f) => f.size > MAX_BYTES);
    if (big) { setErr(`${big.name} is larger than 10 MB.`); return; }
    const next = [...files, ...arr].slice(0, MAX_FILES);
    if (files.length + arr.length > MAX_FILES) setErr(`You can attach up to ${MAX_FILES} files.`);
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (subject.trim().length < 3) { setErr('Enter a short subject.'); return; }
    if (body.trim().length < 5) { setErr('Please describe the problem or question.'); return; }

    const header: string[] = [];
    if (category === 'complaint') {
      header.push(`What happened: ${what}`);
      if (qty.trim()) header.push(`Quantity affected: ${qty.trim()}`);
      header.push(`Requested fix: ${remedy}`);
    }
    const fullBody = header.length ? `${header.join('\n')}\n\n${body.trim()}` : body.trim();

    start(async () => {
      const attachments: { path: string; name: string }[] = [];
      if (files.length) {
        const sb = createClient();
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setProgress(`Uploading ${i + 1} of ${files.length}…`);
          const path = `${orgId}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
          const { error } = await sb.storage.from('tickets').upload(path, f, { contentType: f.type || undefined });
          if (error) { setErr(`Upload failed for ${f.name}: ${error.message}`); setProgress(null); return; }
          attachments.push({ path, name: f.name });
        }
      }
      setProgress('Sending…');
      const r = await createTicket({ category, subject: subject.trim(), body: fullBody, orderId: orderId || null, attachments });
      setProgress(null);
      if (!r.ok || !r.data) { setErr(r.ok ? 'Could not create the ticket' : r.error); return; }
      router.push(`/account/support/${r.data.id}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset>
        <legend className="label">Type of request<span className="text-bad" aria-hidden> *</span></legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <label key={c.value} className={cn('cursor-pointer rounded-[8px] border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue',
              category === c.value ? 'bg-navy border-navy text-white' : 'bg-white border-line-2 hover:border-navy')}>
              <input type="radio" name="category" value={c.value} checked={category === c.value} onChange={() => setCategory(c.value)} className="sr-only" />
              <span className="block font-semibold">{c.label}{category === c.value && <span className="sr-only"> (selected)</span>}</span>
              <span className={cn('block text-xs mt-0.5', category === c.value ? 'text-white/80' : 'text-muted')}>{c.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {category === 'complaint' && (
        <fieldset>
          <legend className="label">What happened?</legend>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            {WHAT_HAPPENED.map((w) => (
              <label key={w} className={cn('cursor-pointer rounded-[8px] border px-3 py-2.5 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue',
                what === w ? 'bg-navy border-navy text-white' : 'bg-white border-line-2 hover:border-navy')}>
                <input type="radio" name="what" value={w} checked={what === w} onChange={() => setWhat(w)} className="sr-only" />
                {w}{what === w && <span className="sr-only"> (selected)</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {order && <ClaimNotice order={order} now={now} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={category === 'complaint' ? '' : 'sm:col-span-2'}>
          <label className="label" htmlFor="tk-order">Order</label>
          <select id="tk-order" className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">No order</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.title} · {o.status === 'delivered' && o.delivered_at ? `delivered ${fmtDate(o.delivered_at)}` : humanize(o.status).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        {category === 'complaint' && (
          <div>
            <label className="label" htmlFor="tk-qty">Quantity affected</label>
            <input id="tk-qty" className="input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 400 pcs, 2 cartons" maxLength={200} />
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="tk-subject">Subject<span className="text-bad" aria-hidden> *</span></label>
        <input id="tk-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required aria-required maxLength={200}
          placeholder={category === 'complaint' ? 'e.g. Visible damage: 2 cartons crushed' : category === 'feedback' ? 'e.g. Great packaging on ORD-2202' : 'e.g. Question about DDP duties to Germany'} />
      </div>

      <div>
        <label className="label" htmlFor="tk-body">{category === 'complaint' ? 'Describe the problem' : 'Your message'}<span className="text-bad" aria-hidden> *</span></label>
        <textarea id="tk-body" className="input py-2.5 min-h-[110px] resize-y" value={body} onChange={(e) => setBody(e.target.value)} required aria-required maxLength={10000}
          placeholder={category === 'complaint' ? 'What is wrong, how you found it, carton or batch marks' : 'How can we help?'} />
      </div>

      <div className="rounded-[10px] border border-dashed border-line-2 bg-surface/50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {category === 'complaint' ? <><strong className="text-navy">We need:</strong> packing list, photos of cartons and labels, the count.</> : 'Optional: add photos, screenshots or files.'}
            <span className="block text-xs mt-0.5">Up to {MAX_FILES} files, 10 MB each.</span>
          </p>
          <input ref={fileRef} id="tk-files" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => addFiles(e.target.files)} />
          <label htmlFor="tk-files" className="btn btn-ghost btn-sm cursor-pointer">Add photos / video / files</label>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Files to attach">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{f.name} <span className="text-muted">· {(f.size / 1024 / 1024).toFixed(1)} MB</span></span>
                <button type="button" className="text-bad text-sm underline" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {category === 'complaint' && (
        <div>
          <label className="label" htmlFor="tk-remedy">What would you like us to do?</label>
          <select id="tk-remedy" className="input" value={remedy} onChange={(e) => setRemedy(e.target.value)}>
            {REMEDIES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-muted">Under our Terms we choose the remedy after checking, and we&apos;ll explain why.</p>
        </div>
      )}

      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{progress ?? (category === 'complaint' ? 'Please keep the goods until we agree next steps.' : 'We reply within 1 business day.')}</p>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Sending…' : 'Submit'}</button>
      </div>
    </form>
  );
}

function ClaimNotice({ order, now }: { order: SupportOrderOption; now: number }) {
  if (order.status !== 'delivered' && order.status !== 'closed') return null;
  const vis = order.claim_visible_until ? new Date(order.claim_visible_until).getTime() : null;
  const hid = order.claim_hidden_until ? new Date(order.claim_hidden_until).getTime() : null;
  if (!vis && !hid) return null;
  const del = order.delivered_at ? new Date(order.delivered_at).getTime() : null;
  if (vis && now <= vis) {
    const days = del ? Math.round((vis - del) / 86_400_000) : null;
    return (
      <p role="status" className="rounded-[10px] border border-warn/40 bg-[#FFF3D6] px-4 py-3 text-sm text-[#8A5A00]">
        Report visible problems{days ? ` within ${days} days of delivery` : ''}. {order.code}
        {del ? ` was delivered ${fmtDate(order.delivered_at)}, so the deadline is ` : ' deadline: '}{fmtDate(order.claim_visible_until)}.
        {hid ? ` Hidden defects can be reported until ${fmtDate(order.claim_hidden_until)}.` : ''}
      </p>
    );
  }
  if (hid && now <= hid) {
    return (
      <p role="status" className="rounded-[10px] border border-warn/40 bg-[#FFF3D6] px-4 py-3 text-sm text-[#8A5A00]">
        The window for visible problems on {order.code} ended {fmtDate(order.claim_visible_until)}. Hidden defects can still be reported until {fmtDate(order.claim_hidden_until)}.
      </p>
    );
  }
  return (
    <p role="status" className="rounded-[10px] border border-bad/40 bg-[#FDE8E8] px-4 py-3 text-sm text-[#A32D2D]">
      The claim window for {order.code} has ended{hid ? ` (${fmtDate(order.claim_hidden_until)})` : ''}. You can still contact us — our team will review case by case.
    </p>
  );
}
