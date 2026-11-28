import { Paperclip } from 'lucide-react';
import { Card, EmptyState, Icon, StatusPill, cx, formatDate, formatTime } from '@octopus/ui';
import { Facts, PageHead, TextLink } from '../../_services/ui';
import { ticketCategory, ticketStatus } from '../../_services/logic';
import { TicketRating, TicketReply } from './ticket-actions';

export type ThreadMessage = { id: string; who: 'you' | 'team' | 'colleague'; body: string; createdAt: string; attachments: { path: string; name: string; previewUrl: string | null }[] };
export type ThreadTicket = {
  id: string; code: string; subject: string; category: string; status: string; csat: number | null; createdAt: string; updatedAt: string;
  order: { id: string; code: string; title: string } | null;
  warehouse: { kind: string; order: { code: string; external_ref: string | null; packed: boolean } | null; asn: { code: string } | null; ret: { code: string } | null } | null;
};

const WHO = { you: 'You', team: 'Octopus support', colleague: 'Your team' } as const;

/**
 * /account/support/[id]: the ticket thread (visible messages only — internal notes are excluded in the query and again
 * here by type), attachments through TODAY's download route /account/support/attachment?p= (re-signs a 60 s link on every
 * click; inline image previews use short signed links), reply, and the rating on resolved / closed tickets.
 */
export function TicketThreadView({ t, messages }: { t: ThreadTicket; messages: ThreadMessage[] }) {
  const st = ticketStatus(t.status);
  const finished = t.status === 'resolved' || t.status === 'closed';
  const back = t.category === 'warehouse' ? { href: '/account/warehouse?tab=support', label: 'Warehouse requests' } : { href: '/account/support', label: 'Support' };
  return (
    <div className="flex flex-col gap-6" data-testid="ticket-thread">
      <PageHead back={back} eyebrow={`${t.code} · ${ticketCategory(t.category)}`} title={t.subject}
        description={`Opened ${formatDate(t.createdAt)} · updated ${formatDate(t.updatedAt)}`} meta={<StatusPill tone={st.tone}>{st.label}</StatusPill>} />
      <div className="grid grid-cols-1 items-start gap-6 ods-desktop:grid-cols-[minmax(0,1fr)_320px]">
        <Card as="section" title="Conversation" headingLevel={2}>
          {messages.length === 0 ? <EmptyState headingLevel={3} title="No messages yet" description="Messages between you and our support team appear here." /> : (
            <ol aria-label="Messages" className="m-0 flex list-none flex-col gap-4 p-0">
              {messages.map((m) => {
                const mine = m.who !== 'team';
                return (
                  <li key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')} data-testid="ticket-message">
                    <div className={cx('max-w-[85%] rounded-ods-card border px-4 py-3', mine ? 'border-ods-blue-tint bg-ods-blue-tint' : 'border-ods-line bg-ods-surface')}>
                      <p className="m-0 text-ods-small"><span className="font-semibold text-ods-navy">{WHO[m.who]}</span> · <time dateTime={m.createdAt}>{formatDate(m.createdAt)}, {formatTime(m.createdAt)}</time></p>
                      <p className="m-0 mt-1 whitespace-pre-wrap break-words text-ods-body">{m.body}</p>
                      {m.attachments.length ? (
                        <ul aria-label="Attachments" className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                          {m.attachments.map((a) => (
                            <li key={a.path}>
                              <a href={`/account/support/attachment?p=${encodeURIComponent(a.path)}`} target="_blank" rel="noopener noreferrer"
                                className="inline-flex min-h-ods-control items-center gap-2 rounded-ods-control border border-ods-line bg-ods-surface px-2 text-ods-small font-semibold text-ods-navy hover:border-ods-line-strong">
                                {a.previewUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={a.previewUrl} alt="" className="size-8 rounded object-cover" />
                                ) : <Icon icon={Paperclip} size="sm" />}
                                <span className="max-w-[200px] truncate">{a.name}</span><span className="sr-only"> (download)</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-6 border-t border-ods-line pt-5"><TicketReply ticketId={t.id} reopens={finished} /></div>
        </Card>
        <div className="flex flex-col gap-6">
          {finished || t.csat != null ? <Card as="section" title="Your rating" headingLevel={2}><TicketRating ticketId={t.id} rating={t.csat} /></Card> : null}
          {t.warehouse ? (
            <Card as="section" title="Warehouse request" headingLevel={2} data-testid="ticket-warehouse">
              {t.warehouse.order ? <p className="m-0 text-ods-body">Order <span className="font-semibold tabular-nums">{t.warehouse.order.code}</span>{t.warehouse.order.external_ref ? ` (your ${t.warehouse.order.external_ref})` : ''} · <TextLink href={`/account/warehouse?tab=orders&order=${t.warehouse.order.code}`}>{t.warehouse.order.packed ? 'Packing record' : 'Order status'}</TextLink></p>
                : t.warehouse.asn ? <p className="m-0 text-ods-body">Stock notice <TextLink href="/account/warehouse?tab=inbound">{t.warehouse.asn.code}</TextLink></p>
                : t.warehouse.ret ? <p className="m-0 text-ods-body">Return <TextLink href="/account/warehouse?tab=returns">{t.warehouse.ret.code}</TextLink></p>
                : <p className="m-0 text-ods-small text-ods-slate">Not about a specific order.</p>}
            </Card>
          ) : null}
          <Card as="section" title="Details" headingLevel={2}>
            <Facts className="ods-tablet:grid-cols-1" items={[
              ['Ticket', <span key="c" className="tabular-nums">{t.code}</span>], ['Status', <StatusPill key="s" tone={st.tone}>{st.label}</StatusPill>], ['Type', ticketCategory(t.category)],
              ['Order', t.order ? <TextLink key="o" href={`/account/orders/${t.order.id}`}>{t.order.code}</TextLink> : 'No order'],
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
