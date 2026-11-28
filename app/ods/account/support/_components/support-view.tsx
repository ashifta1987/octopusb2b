import type { ReactNode } from 'react';
import Link from 'next/link';
import { Inbox, Mail, MessageCircle, Phone } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Icon, Skeleton, StatusPill, Tabs, cx, formatDate } from '@octopus/ui';
import { PageHead } from '../../_services/ui';
import { SUPPORT_TABS, ticketCategory, ticketStatus, type SupportTab } from '../../_services/logic';

export type TicketListRow = {
  id: string; code: string; subject: string; status: string; category: string; updatedAt: string;
  order: { id: string; code: string } | null; last: { fromTeam: boolean; text: string } | null;
};
export type TicketsState = { kind: 'ready'; rows: TicketListRow[] } | { kind: 'loading' } | { kind: 'error' };
export type SupportContacts = { whatsapp: string | null; email: string | null; phone: string | null; claimVisibleDays: number | null; claimHiddenDays: number | null };

function TicketList({ rows, empty }: { rows: TicketListRow[]; empty: ReactNode }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-ods-line rounded-ods-card bg-ods-surface p-0 shadow-ods-card">
      {rows.map((t) => {
        const st = ticketStatus(t.status);
        return (
          <li key={t.id} data-testid="ticket-row" data-status={t.status}>
            <Link href={`/account/support/${t.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-ods-canvas focus-visible:outline-2 focus-visible:outline-ods-focus">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ods-navy">{t.subject}</span>
                <StatusPill tone={st.tone}>{st.label}</StatusPill>
              </span>
              <span className="text-ods-small text-ods-slate">
                <span className="tabular-nums">{t.code}</span> · {ticketCategory(t.category)}{t.order ? <> · order <span className="tabular-nums">{t.order.code}</span></> : null} · updated {formatDate(t.updatedAt)}
              </span>
              {t.last ? <span className="line-clamp-1 text-ods-small text-ods-text">{t.last.fromTeam ? 'Team replied' : 'You wrote'}: {t.last.text}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * /account/support (Part 6.7, Support pattern): underline Tabs Open · Closed (`?tab=`) with the company's tickets, the
 * new-ticket form (`?new=1` puts it first and opens it on phones), claim windows and contacts from settings.
 */
export function SupportView({ tickets, tab, tabParam = 'tab', newTicket, openNew, contacts }: {
  tickets: TicketsState; tab: SupportTab; tabParam?: string | null; newTicket: ReactNode; openNew: boolean; contacts: SupportContacts;
}) {
  const list = (group: SupportTab) => {
    if (tickets.kind === 'loading') return <Skeleton lines={4} label="Loading your tickets" />;
    if (tickets.kind === 'error') return <ErrorState headingLevel={3} title="Your tickets could not be loaded" description="Reload the page. You can still send a new ticket." action={<Button variant="secondary" href="/account/support">Reload</Button>} />;
    const rows = tickets.rows.filter((t) => ticketStatus(t.status).group === group);
    return <TicketList rows={rows} empty={<EmptyState icon={Inbox} headingLevel={3} title={group === 'open' ? 'No open tickets' : 'No closed tickets yet'} description={group === 'open' ? 'Complaints, questions and feedback you send appear here with our replies.' : 'Resolved and closed tickets move here.'} />} />;
  };
  const count = (g: SupportTab) => (tickets.kind === 'ready' ? tickets.rows.filter((t) => ticketStatus(t.status).group === g).length : undefined);
  const wa = contacts.whatsapp ? `https://wa.me/${contacts.whatsapp.replace(/[^0-9]/g, '')}` : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Support" description="Report a problem with an order, ask a question or tell us how we did. Our team replies within 1 business day."
        actions={<Button href="/account/support?new=1#new-ticket" data-testid="support-new">New ticket</Button>} />
      <div className="grid grid-cols-1 items-start gap-6 ods-desktop:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="tickets-h" className={cx('flex min-w-0 flex-col gap-3', openNew && 'order-2 ods-desktop:order-1')}>
          <h2 id="tickets-h" className="m-0 text-ods-h2 text-ods-navy">Your tickets</h2>
          <Tabs label="Tickets" param={tabParam ?? undefined} defaultValue={tab} data-testid="support-tabs" panelClassName="pt-4"
            items={SUPPORT_TABS.map((id) => ({ id, label: id === 'open' ? 'Open' : 'Closed', count: count(id), panel: list(id), testId: `support-tab-${id}` }))} />
        </section>
        <div className={cx('flex min-w-0 flex-col gap-6', openNew && 'order-1 ods-desktop:order-2')}>
          <Card as="section" id="new-ticket" title="New ticket" headingLevel={2} description="One ticket per problem, even if several of our teams work on it." data-testid="new-ticket">
            {newTicket}
          </Card>
          <Card as="section" title="Talk to us" headingLevel={2}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-ods-body">
              {wa ? <li className="flex items-center gap-2"><Icon icon={MessageCircle} size="sm" /><a href={wa} target="_blank" rel="noopener noreferrer" className="font-semibold text-ods-blue underline">WhatsApp {contacts.whatsapp}</a></li> : null}
              {contacts.email ? <li className="flex items-center gap-2"><Icon icon={Mail} size="sm" /><a href={`mailto:${contacts.email}`} className="break-all font-semibold text-ods-blue underline">{contacts.email}</a></li> : null}
              {contacts.phone ? <li className="flex items-center gap-2"><Icon icon={Phone} size="sm" /><a href={`tel:${contacts.phone.replace(/\s+/g, '')}`} className="font-semibold text-ods-blue underline">{contacts.phone}</a></li> : null}
              {!wa && !contacts.email && !contacts.phone ? <li className="text-ods-slate">Use the form to reach our team.</li> : null}
            </ul>
            {contacts.claimVisibleDays != null || contacts.claimHiddenDays != null ? (
              <p className="m-0 mt-3 text-ods-small text-ods-slate">Claim windows: {contacts.claimVisibleDays != null ? `${contacts.claimVisibleDays} days after delivery for visible problems` : ''}{contacts.claimVisibleDays != null && contacts.claimHiddenDays != null ? '; ' : ''}{contacts.claimHiddenDays != null ? `${contacts.claimHiddenDays} days for hidden defects` : ''}. Photos of cartons, labels and the packing list help us resolve claims faster.</p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
