import { Suspense } from 'react';
import Link from 'next/link';
import { DsBadge, DsCard, DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { signPaths } from '@/lib/dropship-problems';
import { categoryLabel, fmtStamp, ticketStatusLabel, type TicketStatus } from '@/lib/dropship-problems-shared';
import { createClient } from '@/lib/supabase/server';
import { ThreadReply } from './thread-reply';

export const metadata = { title: 'Support ticket · Octopus Dropship' };

type Att = { path: string; name?: string; bucket?: string };
const parseAtt = (a: unknown): Att[] => (Array.isArray(a) ? a.filter((x): x is Att => Boolean(x && typeof (x as Att).path === 'string')) : []);

/**
 * Release 4 · Step 10 — one support ticket (the thread of the shared desk, inside the Dropship shell). Reads the company's
 * own ticket and its non-internal messages (RLS), shows what it is linked to, and replies through reply_ticket. Staff
 * names, internal notes and SLA timers are never shown.
 */
async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireDropshipV2Merchant('/account/dropship/support');
  const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const sb = await createClient();
  const { data: t } = ok
    ? await sb.from('tickets').select('id, code, subject, category, status, created_at, store_order_id, store_orders(order_number, external_order_name)').eq('id', id).maybeSingle()
    : { data: null };
  if (!t) {
    return (
      <div className="flex flex-col gap-5" data-testid="support-thread">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Support ticket</h1>
        <DsNotice tone="info" title="This ticket was not found" action={<DsLinkButton href="/account/dropship/support" variant="secondary">Back to Support</DsLinkButton>}>
          It may belong to another company or the link is wrong.
        </DsNotice>
      </div>
    );
  }
  const [{ data: msgs }, features] = await Promise.all([
    sb.from('ticket_messages').select('id, is_staff, body, attachments, created_at').eq('ticket_id', id).eq('internal', false).order('created_at'),
    getDropshipFeatures(),
  ]);
  const claimPaths = (msgs ?? []).flatMap((m) => parseAtt(m.attachments).filter((a) => a.bucket === 'ds-claims').map((a) => a.path));
  const claimUrls = await signPaths(sb, 'ds-claims', claimPaths);
  const so = (Array.isArray(t.store_orders) ? t.store_orders[0] : t.store_orders) as { order_number: string; external_order_name: string | null } | null;
  const s = ticketStatusLabel(t.status as TicketStatus);
  return (
    <div className="flex flex-col gap-5" data-testid="support-thread">
      <nav aria-label="Breadcrumb" className="text-[13px] text-[#5B6478]"><Link href="/account/dropship/support" className="text-[#2A6FD1] underline">Support</Link> / {t.code}</nav>
      <header className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">{t.subject}</h1>
          <p className="m-0 mt-1.5 text-[14px] text-[#5B6478]">
            {`${t.code} · ${categoryLabel(t.category)} · opened ${fmtStamp(t.created_at)}`}
            {so && <> · {features.orders ? <Link className="text-[#2A6FD1] underline" href={`/account/dropship/orders/${t.store_order_id}`}>{`Order ${so.external_order_name ?? so.order_number}`}</Link> : `Order ${so.external_order_name ?? so.order_number}`}</>}
          </p>
        </div>
        <DsBadge tone={s.tone} testId="thread-status">{s.label}</DsBadge>
      </header>
      <DsCard title="Conversation" testId="thread-messages">
        <ol className="list-none m-0 p-0 flex flex-col gap-3">
          {(msgs ?? []).map((m) => (
            <li key={m.id} className={`rounded-[10px] px-4 py-3 max-w-[85%] ${m.is_staff ? 'ml-auto bg-[#F2F7FE]' : 'bg-[#F7F9FC]'}`}>
              <div className="text-[12px] font-semibold text-[#5B6478]">{`${m.is_staff ? 'Octopus support' : 'You'} · ${fmtStamp(m.created_at)}`}</div>
              <p className="m-0 mt-1 text-[14px] whitespace-pre-line text-[#1A174A]">{m.body}</p>
              {parseAtt(m.attachments).length > 0 && (
                <div className="flex gap-2 flex-wrap mt-1">
                  {parseAtt(m.attachments).map((a, n) => {
                    const href = a.bucket === 'ds-claims' ? claimUrls.get(a.path) : `/account/support/attachment?p=${encodeURIComponent(a.path)}`;
                    return href ? <a key={n} href={href} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[#2A6FD1] underline min-h-[44px] inline-flex items-center">{a.name ?? `File ${n + 1}`}</a> : null;
                  })}
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-4"><ThreadReply ticketId={t.id} /></div>
      </DsCard>
    </div>
  );
}

export default function Page(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton /></div>}>
      <Thread {...props} />
    </Suspense>
  );
}
