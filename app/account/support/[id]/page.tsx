import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, humanize } from '@/lib/format';
import { Card, EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { SupportReply } from '@/components/account/support-reply';
import { SupportCsat, SupportCsatResult } from '@/components/account/support-csat';
import { parseAttachments, ticketStatusLabel } from '@/components/account/support-shared';

export const metadata = { title: 'Support ticket' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG = /\.(png|jpe?g|gif|webp)$/i;

type Ticket = {
  id: string; code: string; subject: string; category: string; status: string; priority: string; csat: number | null;
  order_id: string | null; created_at: string; updated_at: string; orders: { code: string; title: string } | null;
};
type Message = { id: string; author_id: string | null; is_staff: boolean; internal: boolean; body: string; attachments: unknown; created_at: string };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCustomer(`/account/support/${id}`);
  if (!UUID.test(id)) notFound();
  if (!s.org) {
    return (
      <>
        <PageHeader title="Support ticket" />
        <Notice tone="amber">Your account is not linked to a buyer company. Staff can view tickets in the office support desk.</Notice>
      </>
    );
  }

  const sb = await createClient();
  const { data: tRaw } = await sb
    .from('tickets')
    .select('id, code, subject, category, status, priority, csat, order_id, created_at, updated_at, orders(code, title)')
    .eq('id', id)
    .eq('org_id', s.org.id)
    .maybeSingle();
  if (!tRaw) notFound();
  const t = tRaw as unknown as Ticket;

  const { data: mRaw } = await sb
    .from('ticket_messages')
    .select('id, author_id, is_staff, internal, body, attachments, created_at')
    .eq('ticket_id', t.id)
    .eq('internal', false)
    .order('created_at', { ascending: true });
  const messages = ((mRaw ?? []) as Message[]).filter((m) => !m.internal);

  // Signed URLs (60 s, server-side) for inline image previews; the download link goes through ./attachment which re-signs on click.
  const allPaths = messages.flatMap((m) => parseAttachments(m.attachments).map((a) => a.path));
  const signed = new Map<string, string>();
  if (allPaths.length) {
    const { data } = await sb.storage.from('tickets').createSignedUrls(allPaths, 60);
    (data ?? []).forEach((d) => { if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl); });
  }

  const finished = t.status === 'resolved' || t.status === 'closed';

  return (
    <>
      <div className="mb-3 text-sm"><Link href="/account/support" className="text-muted hover:text-ink">← Help &amp; complaints</Link></div>
      <PageHeader
        eyebrow={<span className="eyebrow">{t.code} · {humanize(t.category)}</span>}
        title={t.subject}
        subtitle={
          <>
            Opened {fmtDate(t.created_at)} · updated {fmtDate(t.updated_at, true)}
            {t.order_id && t.orders ? <> · Order <Link href={`/account/orders/${t.order_id}`} className="mono underline">{t.orders.code}</Link> <span className="text-muted">({t.orders.title})</span></> : null}
          </>
        }
        actions={<StatusBadge status={t.status} label={ticketStatusLabel(t.status)} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <Card title="Conversation" action={<RealtimeRefresh channel={`ticket-${t.id}`} subs={[{ table: 'ticket_messages', filter: `ticket_id=eq.${t.id}` }]} />}>
          <div className="px-6 pb-6">
            {messages.length === 0 ? (
              <EmptyState title="No messages yet" body="Messages between you and our support team will appear here." />
            ) : (
              <ol className="space-y-4" aria-label="Messages">
                {messages.map((m) => {
                  const mine = !m.is_staff;
                  const who = m.is_staff ? 'Octopus support' : m.author_id === s.userId ? 'You' : 'Your team';
                  const atts = parseAttachments(m.attachments);
                  return (
                    <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[85%] rounded-[12px] border px-4 py-3', mine ? 'bg-tint border-coral-text/20' : 'bg-white border-line')}>
                        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-semibold text-ink">{who}</span>
                          <time className="text-muted mono" dateTime={m.created_at}>{fmtDate(m.created_at, true)}</time>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[15px]">{m.body}</p>
                        {atts.length > 0 && (
                          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
                            {atts.map((a) => {
                              const href = `/account/support/attachment?p=${encodeURIComponent(a.path)}`;
                              const preview = IMG.test(a.name) ? signed.get(a.path) : undefined;
                              return (
                                <li key={a.path}>
                                  <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-[8px] border border-line bg-white px-2 py-1.5 text-sm hover:border-ink">
                                    {preview ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={preview} alt="" className="h-10 w-10 rounded object-cover" />
                                    ) : (
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
                                    )}
                                    <span className="max-w-[200px] truncate">{a.name}</span>
                                  </a>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="mt-6 border-t border-line pt-5">
              <SupportReply ticketId={t.id} reopens={finished} />
            </div>
          </div>
        </Card>

        <aside className="space-y-5">
          {(finished || t.csat != null) && (
            <Card>
              <div className="p-5">
                {t.csat == null ? <SupportCsat ticketId={t.id} /> : <SupportCsatResult rating={t.csat} />}
              </div>
            </Card>
          )}
          <Card>
            <dl className="p-5 space-y-3 text-[15px]">
              <div><dt className="text-sm text-muted">Ticket</dt><dd className="mono font-semibold">{t.code}</dd></div>
              <div><dt className="text-sm text-muted">Status</dt><dd className="mt-0.5"><StatusBadge status={t.status} label={ticketStatusLabel(t.status)} /></dd></div>
              <div><dt className="text-sm text-muted">Type</dt><dd>{humanize(t.category)}</dd></div>
              <div>
                <dt className="text-sm text-muted">Order</dt>
                <dd>{t.order_id && t.orders ? <Link href={`/account/orders/${t.order_id}`} className="mono underline">{t.orders.code}</Link> : 'No order'}</dd>
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
