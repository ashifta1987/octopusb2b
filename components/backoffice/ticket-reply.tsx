'use client';
import { useRef, useState } from 'react';
import { ActionForm, type ActionResult } from './action-form';

const STATUSES = ['', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed'];

/** Support desk composer: quick-reply macros insert text; reply or internal note; optional status change. */
export function TicketReply({ action, macros }: { action: (fd: FormData) => Promise<ActionResult>; macros: { id: string; title: string; body: string }[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [internal, setInternal] = useState(false);
  const insert = (text: string) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(el.selectionEnd ?? start);
    el.focus();
  };
  return (
    <ActionForm action={action} resetOnSuccess submitLabel={internal ? 'Add internal note' : 'Send reply'} submitClass={internal ? 'btn btn-dark' : 'btn btn-primary'} onDone={() => setInternal(false)}>
      {macros.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm text-muted">Quick replies:</span>
          {macros.map((m) => <button key={m.id} type="button" className="rounded-full border border-line-strong px-3 py-1 text-sm hover:border-ink" title={m.body} onClick={() => insert(m.body)}>{m.title}</button>)}
        </div>
      )}
      <label htmlFor="tr-body" className="sr-only">Reply</label>
      <textarea id="tr-body" ref={ref} name="body" required className={`input min-h-28 py-2 ${internal ? 'bg-warn-bg' : ''}`} placeholder="Write a reply to the customer, or an internal note" />
      <div className="flex flex-wrap items-center gap-4 mt-3">
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="internal" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (customer can&apos;t see)</label>
        <label className="inline-flex items-center gap-2 text-sm">Then set status
          <select name="status" className="input min-h-9 w-auto text-sm" defaultValue="">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'automatic'}</option>)}
          </select>
        </label>
      </div>
    </ActionForm>
  );
}
