'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsIcon, DsInput, DsNotice, DsPageHeader, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { createClient } from '@/lib/supabase/client';
import type { SupportPageData } from '@/lib/dropship-problems';
import { TICKET_CATEGORIES, categoryLabel, fmtStamp, ticketStatusLabel } from '@/lib/dropship-problems-shared';
import { markNotificationsRead } from '@/app/account/notifications/actions';
import { createSupportTicketAction } from '../ds10-actions';

/**
 * Release 4 · Step 10 — Support (screens/Support.html, mobile/M_Support.html): header + New ticket, help topics, Your
 * tickets (Ticket · Subject · Linked to · Status · Updated), New ticket (Subject, Category, Order number, Message, Attach
 * file, Send ticket) and Notifications (Mark all read). SLA timers are staff-only and never shown here.
 */

export type NotificationItem = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file';
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export function SupportClient({ data, orgId, notifications }: { data: SupportPageData; orgId: string; notifications: NotificationItem[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLElement | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<string>('order_problem');
  const [orderRef, setOrderRef] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [pending, start] = useTransition();
  const unread = notifications.filter((n) => !n.read_at).length;

  function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    start(async () => {
      const attachments: { path: string; name: string }[] = [];
      if (files.length) {
        const sb = createClient();
        for (const f of files) {
          if (f.size > 10 * 1024 * 1024) { setError(`Attach file: ${f.name} is larger than 10 MB.`); return; }
          const path = `${orgId}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
          const { error: upErr } = await sb.storage.from('tickets').upload(path, f, { contentType: f.type || undefined });
          if (upErr) { setError(`Attach file: ${f.name} could not be uploaded. Try again.`); return; }
          attachments.push({ path, name: f.name });
        }
      }
      const r = await createSupportTicketAction({ subject, category, orderRef, body, attachments });
      if (!r.ok) { setError(r.message); return; }
      setCreated(r.data);
      setSubject(''); setOrderRef(''); setBody(''); setFiles([]);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-support-page">
      <DsPageHeader
        title="Support"
        icon="help"
        subtitle="Help articles, your requests and notifications. One ticket per problem, even if several Octopus teams work on it."
        actions={<DsButton icon="plus" testId="support-new" onClick={() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('ts')?.focus(); }}>New ticket</DsButton>}
      />

      <section className="ds-card" aria-label="Help topics" data-testid="support-help">
        <h2 className="m-0 mb-3 text-[17px] font-bold text-[#1A174A]">Help</h2>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {[
            { href: '/account/dropship/onboarding', title: 'Getting started', text: 'Connect, import, push', show: true },
            { href: '/account/dropship/orders', title: 'Orders and shipping', text: 'Holds, tracking, claims', show: data.orders_on },
            { href: '/account/dropship/pricing', title: 'Pricing and sync', text: 'Rules, currency, stock', show: data.orders_on },
            { href: '/account/dropship/wallet', title: 'Wallet and billing', text: 'Top-ups, invoices, plans', show: true },
          ].filter((x) => x.show).map((x) => (
            <Link key={x.title} href={x.href} className="ds-card !p-4 no-underline hover:border-[#C9D0DD] min-h-[44px]">
              <strong className="block text-[15px] text-[#1A174A]">{x.title}</strong>
              <span className="text-[13px] text-[#5B6478]">{x.text}</span>
            </Link>
          ))}
        </div>
      </section>

      <DsCard title="Your tickets" noPadding testId="support-tickets">
        {data.tickets.length === 0 ? (
          <div className="p-5"><DsEmptyState icon="help" title="No tickets yet" description="When you ask Octopus something, the conversation appears here." testId="support-empty" /></div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Your tickets">
            <table className="ds-tbl min-w-[640px]" data-testid="support-tickets-table">
              <thead><tr><th scope="col">Ticket</th><th scope="col">Subject</th><th scope="col">Linked to</th><th scope="col">Status</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                {data.tickets.map((t) => {
                  const s = ticketStatusLabel(t.status);
                  return (
                    <tr key={t.id} data-testid={`ticket-row-${t.code}`}>
                      <td><Link href={`/account/dropship/support/${t.id}`} className="font-mono text-[#2A6FD1] underline inline-flex items-center min-h-[44px]">{t.code}</Link></td>
                      <td>{t.subject}<span className="block text-[12px] text-[#5B6478]">{categoryLabel(t.category)}{t.case ? ` · ${t.case.code}` : ''}</span></td>
                      <td>
                        {t.store_order ? (data.orders_on
                          ? <Link href={`/account/dropship/orders/${t.store_order.id}`} className="text-[#2A6FD1] underline">{`Order ${t.store_order.external_order_name ?? t.store_order.order_number}`}</Link>
                          : `Order ${t.store_order.external_order_name ?? t.store_order.order_number}`)
                          : t.rfq ?? t.b2b_order ?? '—'}
                      </td>
                      <td><DsBadge tone={s.tone}>{s.label}</DsBadge></td>
                      <td className="whitespace-nowrap">{ago(t.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>

      <section className="ds-card" aria-labelledby="nt-title" ref={formRef} data-testid="support-new-ticket">
        <h2 id="nt-title" className="m-0 mb-3 text-[17px] font-bold text-[#1A174A]">New ticket</h2>
        {created && (
          <DsNotice tone="ok" title={`Ticket ${created.code} sent`} testId="support-created"
            action={<Link className="text-[14px] font-semibold text-[#2A6FD1] underline" href={`/account/dropship/support/${created.id}`}>Open the conversation</Link>}>
            Octopus support replies here and by notification.
          </DsNotice>
        )}
        <form onSubmit={send} className="grid gap-3 sm:grid-cols-2 mt-2">
          <DsInput id="ts" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} containerClassName="sm:col-span-2"
            error={error && /^Subject/.test(error) ? error : undefined} />
          <DsSelect id="tc" label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {TICKET_CATEGORIES.filter((c) => data.orders_on || c.value !== 'order_problem').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </DsSelect>
          {data.orders_on ? (
            <DsInput id="to" label="Order number (optional)" value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder={data.orders[0]?.external_order_name ?? data.orders[0]?.order_number ?? ''}
              list="ds-orders" maxLength={64} error={error && /^Order number/.test(error) ? error : undefined} />
          ) : <div />}
          <datalist id="ds-orders">{data.orders.map((o) => <option key={o.id} value={o.external_order_name ?? o.order_number}>{o.order_number}</option>)}</datalist>
          <DsTextarea id="tm" label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={5} required maxLength={10000} containerClassName="sm:col-span-2"
            error={error && /^Message/.test(error) ? error : undefined} />
          <div className="sm:col-span-2">
            <label className="ds-label" htmlFor="ta">Attach file</label>
            <input id="ta" type="file" multiple className="block text-[14px] min-h-[44px]" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} />
          </div>
          {error && !/^(Subject|Order number|Message)/.test(error) && <p role="alert" className="m-0 text-[13px] text-[#B42318] sm:col-span-2" data-testid="support-error">{error}</p>}
          <div className="sm:col-span-2 flex gap-2.5 flex-wrap">
            <DsButton type="submit" icon="send" loading={pending} disabled={pending} testId="support-send">Send ticket</DsButton>
          </div>
        </form>
      </section>

      <section className="ds-card" aria-labelledby="nf-title" data-testid="support-notifications">
        <div className="flex justify-between items-center gap-3 flex-wrap mb-2">
          <h2 id="nf-title" className="m-0 text-[17px] font-bold text-[#1A174A]">{`Notifications${unread ? ` (${unread} new)` : ''}`}</h2>
          {unread > 0 && (
            <form action={markNotificationsRead}>
              <input type="hidden" name="seen" value={notifications[0]?.created_at ?? ''} />
              <DsButton type="submit" variant="secondary">Mark all read</DsButton>
            </form>
          )}
        </div>
        {notifications.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">No notifications yet.</p> : (
          <ul className="list-none m-0 p-0 flex flex-col">
            {notifications.map((n) => (
              <li key={n.id} className="flex justify-between gap-3 py-2.5 border-b border-[#EEF0F4] last:border-0">
                <span className="text-[14px] text-[#1A174A] flex items-center gap-2">
                  {!n.read_at && <span className="text-[#2A6FD1] inline-flex"><DsIcon name="bell" size={14} /><span className="sr-only">New:</span></span>}
                  {n.link?.startsWith('/') ? <Link href={n.link} className="text-[#1A174A] underline">{n.title}</Link> : n.title}
                </span>
                <span className="text-[12px] text-[#5B6478] whitespace-nowrap">{fmtStamp(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
