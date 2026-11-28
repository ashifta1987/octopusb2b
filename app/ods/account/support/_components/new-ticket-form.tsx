'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, FileDrop, Input, RadioCards, Select, Textarea, formatDate, type FileDropItem } from '@octopus/ui';
import { createClient } from '@/lib/supabase/client';
import { createTicket } from '@/app/account/support/actions';
import { ActionMessage, type ActionMsg } from '../../_services/action-kit';
import { Notice } from '../../_services/ui';

export type TicketOrderOption = { id: string; code: string; title: string; status: string; delivered_at: string | null; claim_visible_until: string | null; claim_hidden_until: string | null };

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

/** Claim window for the chosen order (same rules and words as today's support form). */
function claimText(o: TicketOrderOption, now: number): { tone: 'warning' | 'danger'; text: string } | null {
  if (o.status !== 'delivered' && o.status !== 'closed') return null;
  const vis = o.claim_visible_until ? Date.parse(o.claim_visible_until) : null;
  const hid = o.claim_hidden_until ? Date.parse(o.claim_hidden_until) : null;
  if (!vis && !hid) return null;
  if (vis && now <= vis) return { tone: 'warning', text: `Report visible problems by ${formatDate(o.claim_visible_until!)}${o.delivered_at ? ` (${o.code} was delivered ${formatDate(o.delivered_at)})` : ''}.${hid ? ` Hidden defects can be reported until ${formatDate(o.claim_hidden_until!)}.` : ''}` };
  if (hid && now <= hid) return { tone: 'warning', text: `The window for visible problems on ${o.code} ended ${o.claim_visible_until ? formatDate(o.claim_visible_until) : ''}. Hidden defects can still be reported until ${formatDate(o.claim_hidden_until!)}.` };
  return { tone: 'danger', text: `The claim window for ${o.code} has ended. You can still contact us — our team will review case by case.` };
}

/**
 * New ticket (Support, Part 6.7) — the same flow as today's components/account/support-new-ticket.tsx: files go from the
 * browser to the private `tickets` bucket in the company's folder, then TODAY's createTicket action (create_ticket RPC);
 * on success we open the new ticket thread.
 */
export function NewTicketForm({ orders, orgId, now, defaultOrderId, defaultSubject = '', defaultBody = '' }: {
  orders: TicketOrderOption[]; orgId: string; now: number; defaultOrderId?: string | null; defaultSubject?: string; defaultBody?: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(defaultOrderId ? 'complaint' : 'question');
  const [what, setWhat] = useState(WHAT_HAPPENED[0]);
  const [orderId, setOrderId] = useState(defaultOrderId && orders.some((o) => o.id === defaultOrderId) ? defaultOrderId : '');
  const [subject, setSubject] = useState(defaultSubject);
  const [qty, setQty] = useState('');
  const [remedy, setRemedy] = useState(REMEDIES[0]);
  const [body, setBody] = useState(defaultBody);
  const [files, setFiles] = useState<{ id: string; file: File; item: FileDropItem }[]>([]);
  const [msg, setMsg] = useState<ActionMsg>(null);
  const [pending, setPending] = useState(false);
  const order = useMemo(() => orders.find((o) => o.id === orderId) ?? null, [orders, orderId]);
  const claim = order ? claimText(order, now) : null;

  const add = (list: File[]) => {
    const next = [...files, ...list.map((f) => ({ id: crypto.randomUUID(), file: f, item: { id: '', name: f.name, size: f.size, status: 'done' as const } }))].slice(0, MAX_FILES);
    if (files.length + list.length > MAX_FILES) setMsg({ ok: false, text: `You can attach up to ${MAX_FILES} files.` });
    setFiles(next.map((x) => ({ ...x, item: { ...x.item, id: x.id } })));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (subject.trim().length < 3) { setMsg({ ok: false, text: 'Enter a short subject.' }); return; }
    if (body.trim().length < 5) { setMsg({ ok: false, text: 'Please describe the problem or question.' }); return; }
    const header: string[] = [];
    if (category === 'complaint') { header.push(`What happened: ${what}`); if (qty.trim()) header.push(`Quantity affected: ${qty.trim()}`); header.push(`Requested fix: ${remedy}`); }
    const fullBody = header.length ? `${header.join('\n')}\n\n${body.trim()}` : body.trim();
    setPending(true);
    try {
      const attachments: { path: string; name: string }[] = [];
      if (files.length) {
        const sb = createClient();
        for (let i = 0; i < files.length; i++) {
          const f = files[i].file;
          setMsg({ ok: true, text: `Uploading ${i + 1} of ${files.length}…` });
          const path = `${orgId}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
          const { error } = await sb.storage.from('tickets').upload(path, f, { contentType: f.type || undefined });
          if (error) { setMsg({ ok: false, text: `Upload failed for ${f.name}: ${error.message}` }); return; }
          attachments.push({ path, name: f.name });
        }
      }
      setMsg({ ok: true, text: 'Sending…' });
      const r = await createTicket({ category, subject: subject.trim(), body: fullBody, orderId: orderId || null, attachments });
      if (!r.ok || !r.data) { setMsg({ ok: false, text: r.ok ? 'Could not create the ticket' : r.error }); return; }
      router.push(`/account/support/${r.data.id}`);
    } catch {
      setMsg({ ok: false, text: 'Something went wrong. Please try again.' });
    } finally { setPending(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="New ticket">
      <RadioCards legend="Type of request" required value={category} onValueChange={(v) => setCategory(v as Category)} columns={1}
        options={CATEGORIES.map((c) => ({ value: c.value, label: c.label, description: c.hint }))} />
      {category === 'complaint' ? (
        <Field label="What happened?"><Select value={what} onChange={(e) => setWhat(e.target.value)}>{WHAT_HAPPENED.map((w) => <option key={w}>{w}</option>)}</Select></Field>
      ) : null}
      <Field label="Order" optional>
        <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">No order</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.title}</option>)}
        </Select>
      </Field>
      {claim ? <Notice tone={claim.tone}>{claim.text}</Notice> : null}
      {category === 'complaint' ? (
        <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-2">
          <Field label="Quantity affected" optional hint="For example 400 pcs, 2 cartons"><Input value={qty} onChange={(e) => setQty(e.target.value)} maxLength={200} /></Field>
          <Field label="What would you like us to do?" hint="Under our Terms we choose the remedy after checking, and we explain why."><Select value={remedy} onChange={(e) => setRemedy(e.target.value)}>{REMEDIES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        </div>
      ) : null}
      <Field label="Subject" required><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></Field>
      <Field label={category === 'complaint' ? 'Describe the problem' : 'Your message'} required hint={category === 'complaint' ? 'What is wrong, how you found it, carton or batch marks.' : undefined}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={5} />
      </Field>
      <FileDrop accept={ACCEPT} acceptLabel="Photos, videos, PDF or spreadsheets" maxSize={MAX_BYTES} multiple files={files.map((f) => f.item)}
        onFilesAdded={add} onRemove={(id) => setFiles((p) => p.filter((x) => x.id !== id))} disabled={pending}
        prompt={category === 'complaint' ? 'We need: packing list, photos of cartons and labels, the count.' : 'Optional: add photos, screenshots or files.'} />
      <ActionMessage msg={msg} />
      <div><Button type="submit" loading={pending} loadingText="Sending…" data-testid="new-ticket-submit">Send ticket</Button></div>
    </form>
  );
}
