import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Skeleton } from '@octopus/ui';
import { createClient } from '@/lib/supabase/server';
import { parseAttachments } from '@/components/account/support-shared';
import type { TicketContext } from '@/lib/warehouse-w5';
import { requireAccount } from '../../_lib/loaders';
import { PageWrap } from '../../_services/ui';
import { TicketThreadView, type ThreadMessage, type ThreadTicket } from '../_components/ticket-thread';

export const metadata: Metadata = { title: 'Support ticket' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG = /\.(png|jpe?g|gif|webp)$/i;

type Ticket = { id: string; code: string; subject: string; category: string; status: string; csat: number | null; order_id: string | null; created_at: string; updated_at: string; orders: { code: string; title: string } | null };
type Msg = { id: string; author_id: string | null; is_staff: boolean; internal: boolean; body: string; attachments: unknown; created_at: string };

/**
 * ODS /account/support/<uuid>. Same reads as today's app/account/support/[id]/page.tsx: the ticket (own company), its
 * non-internal messages, 60 s signed previews for image attachments (tickets bucket; downloads go through today's
 * /account/support/attachment route), and wh_ticket_context for warehouse requests. Actions: today's replyTicket, rateTicket.
 */
export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageWrap>
      <Suspense fallback={<div className="flex flex-col gap-6"><Skeleton lines={2} label="Loading the ticket" /><Skeleton lines={8} silent /></div>}>
        <Thread params={params} />
      </Suspense>
    </PageWrap>
  );
}

async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireAccount(`/account/support/${id}`);
  if (!UUID.test(id)) notFound();
  const sb = await createClient();
  const { data: tRaw } = await sb.from('tickets').select('id, code, subject, category, status, csat, order_id, created_at, updated_at, orders(code, title)').eq('id', id).eq('org_id', s.org!.id).maybeSingle();
  if (!tRaw) notFound();
  const t = tRaw as unknown as Ticket;
  const { data: mRaw } = await sb.from('ticket_messages').select('id, author_id, is_staff, internal, body, attachments, created_at').eq('ticket_id', t.id).eq('internal', false).order('created_at', { ascending: true });
  const msgs = ((mRaw ?? []) as Msg[]).filter((m) => !m.internal);
  const imgPaths = msgs.flatMap((m) => parseAttachments(m.attachments).filter((a) => IMG.test(a.name) || IMG.test(a.path)).map((a) => a.path));
  const signed = new Map<string, string>();
  if (imgPaths.length) {
    const { data } = await sb.storage.from('tickets').createSignedUrls(imgPaths, 60);
    (data ?? []).forEach((d) => { if (d.path && d.signedUrl) signed.set(d.path, d.signedUrl); });
  }
  const { data: whRaw } = t.category === 'warehouse' ? await sb.rpc('wh_ticket_context', { p_ticket: t.id }) : { data: null };
  const wh = (whRaw ?? null) as TicketContext;
  const ticket: ThreadTicket = {
    id: t.id, code: t.code, subject: t.subject, category: t.category, status: t.status, csat: t.csat, createdAt: t.created_at, updatedAt: t.updated_at,
    order: t.order_id && t.orders ? { id: t.order_id, code: t.orders.code, title: t.orders.title } : null,
    warehouse: wh ? { kind: wh.kind, order: wh.order ? { code: wh.order.code, external_ref: wh.order.external_ref ?? null, packed: !!wh.order.packed } : null, asn: wh.asn ? { code: wh.asn.code } : null, ret: wh.return ? { code: wh.return.code } : null } : null,
  };
  const messages: ThreadMessage[] = msgs.map((m) => ({
    id: m.id, who: m.is_staff ? 'team' : m.author_id === s.userId ? 'you' : 'colleague', body: m.body, createdAt: m.created_at,
    attachments: parseAttachments(m.attachments).map((a) => ({ path: a.path, name: a.name, previewUrl: signed.get(a.path) ?? null })),
  }));
  return <TicketThreadView t={ticket} messages={messages} />;
}
