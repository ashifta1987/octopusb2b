import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '@/app/ods/account/_services/ui';
import { SupportView, type SupportContacts, type TicketListRow, type TicketsState } from '@/app/ods/account/support/_components/support-view';
import { NewTicketForm } from '@/app/ods/account/support/_components/new-ticket-form';
import { TicketThreadView, type ThreadMessage, type ThreadTicket } from '@/app/ods/account/support/_components/ticket-thread';
import { ServicesFixtureFrame, fixtureState } from '../account-turnkey/_frame';

export const metadata: Metadata = { title: 'My account · Support · ODS fixtures (staging)', robots: { index: false, follow: false } };

/* SAMPLE tickets (Support board example) — staging only. */
const ROWS: TicketListRow[] = [
  { id: '00000000-0000-4000-8000-000000000201', code: 'TCK-201', subject: 'Address mismatch', status: 'waiting_customer', category: 'complaint', updatedAt: '2026-11-27T09:00:00Z', order: { id: 'o1', code: 'OCT-SRC-2026-0207' }, last: { fromTeam: true, text: 'Please confirm the delivery address for the balance shipment.' } },
  { id: '00000000-0000-4000-8000-000000000199', code: 'TCK-199', subject: 'Question about DDP duties to Germany', status: 'open', category: 'question', updatedAt: '2026-11-26T09:00:00Z', order: null, last: { fromTeam: false, text: 'Do your prices include duties?' } },
  { id: '00000000-0000-4000-8000-000000000198', code: 'TCK-198', subject: 'Product request: foldable crate', status: 'resolved', category: 'question', updatedAt: '2026-11-26T09:00:00Z', order: null, last: { fromTeam: true, text: 'We sent you RFQ-1042.' } },
];
const CONTACTS: SupportContacts = { whatsapp: '+971 50 000 0000', email: 'support@example.com', phone: null, claimVisibleDays: 7, claimHiddenDays: 30 };
const ORDERS = [{ id: 'o1', code: 'OCT-SRC-2026-0207', title: 'Kitchen storage line', status: 'delivered', delivered_at: '2026-11-24T09:00:00Z', claim_visible_until: '2026-12-01T09:00:00Z', claim_hidden_until: '2026-12-24T09:00:00Z' }];
const TICKET: ThreadTicket = { id: ROWS[0].id, code: 'TCK-201', subject: 'Address mismatch', category: 'complaint', status: 'waiting_customer', csat: null, createdAt: '2026-11-26T09:00:00Z', updatedAt: '2026-11-27T09:00:00Z', order: { id: 'o1', code: 'OCT-SRC-2026-0207', title: 'Kitchen storage line' }, warehouse: null };
const MESSAGES: ThreadMessage[] = [
  { id: 'm1', who: 'you', body: 'What happened: Shortage or wrong goods\nRequested fix: Let the team suggest the best fix\n\nThe delivery address on the packing list is our old office.', createdAt: '2026-11-26T09:00:00Z', attachments: [{ path: 'org/packing-list.pdf', name: 'packing-list.pdf', previewUrl: null }] },
  { id: 'm2', who: 'team', body: 'Thanks Anna. Please confirm the delivery address for the balance shipment.', createdAt: '2026-11-27T09:00:00Z', attachments: [] },
];

const STATES = [
  { id: 'open', label: 'Open tickets' }, { id: 'closed', label: 'Closed tickets' }, { id: 'new', label: 'New ticket first (?new=1)' }, { id: 'empty', label: 'No tickets' },
  { id: 'error', label: 'Tickets failed' }, { id: 'loading', label: 'Loading' }, { id: 'thread', label: 'Ticket thread' }, { id: 'thread-resolved', label: 'Resolved ticket (rating)' },
];

export default function SupportFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  const tickets: TicketsState = state === 'empty' ? { kind: 'ready', rows: [] } : state === 'error' ? { kind: 'error' } : state === 'loading' ? { kind: 'loading' } : { kind: 'ready', rows: ROWS };
  const thread = state === 'thread' || state === 'thread-resolved';
  return (
    <ServicesFixtureFrame path={thread ? '/account/support/x' : '/account/support'} states={STATES} current={state}>
      <PageWrap>
        {thread ? (
          <TicketThreadView t={state === 'thread-resolved' ? { ...TICKET, status: 'resolved' } : TICKET} messages={MESSAGES} />
        ) : (
          <SupportView key={state} tickets={tickets} tab={state === 'closed' ? 'closed' : 'open'} tabParam={null} contacts={CONTACTS} openNew={state === 'new'}
            newTicket={<NewTicketForm orders={ORDERS} orgId="sample-org" now={Date.parse('2026-11-27T12:00:00Z')} defaultOrderId={state === 'new' ? 'o1' : null} />} />
        )}
      </PageWrap>
    </ServicesFixtureFrame>
  );
}
