import { Suspense } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { getSettings } from '@/components/account/data';
import { requireAccount, settle } from '../_lib/loaders';
import { PageWrap } from '../_services/ui';
import { SUPPORT_TABS, pickTab, supportPrefill } from '../_services/logic';
import { SupportView, type SupportContacts, type TicketListRow, type TicketsState } from './_components/support-view';
import { NewTicketForm, type TicketOrderOption } from './_components/new-ticket-form';

export const metadata: Metadata = { title: 'Support' };

/** Request time for the claim-window notice (same pattern as today's support page). */
function nowMs() {
  return Date.now();
}

type SP = { tab?: string; new?: string; order?: string; topic?: string; about?: string; subject?: string };

/** Today's "Start …" presets (app/account/support/page.tsx TOPICS), kept so links from the service pages still prefill. */
const TOPICS: Record<string, [string, string]> = {
  dropship: ['Please switch on Dropshipping', 'We would like to start Dropshipping. Our store platform and the countries we sell to are: '],
  warehouse: ['Please switch on 3PL warehouse', 'We would like to store stock in your warehouse. Products, monthly volume and destination countries: '],
  brand: ['Please switch on Make My Brand', 'We would like to put our brand on verified-supplier products. Products and quantities we have in mind: '],
};

/**
 * ODS /account/support (Part 6.7). Same reads as today's app/account/support/page.tsx (RLS: the company's own tickets with the
 * latest visible message — internal notes excluded —, the company's orders for the form, company contacts and claim windows from
 * settings) and today's createTicket action. `?new=1` (FRAME's newTicket link) puts the form first; `?about=TKP-…|MB-…` and
 * `?subject=` prefill it; `?topic=` keeps today's presets.
 */
export default function SupportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <PageWrap testId="support-page">
      <Suspense fallback={<SupportView tickets={{ kind: 'loading' }} tab="open" tabParam={null} newTicket={null} openNew={false} contacts={{ whatsapp: null, email: null, phone: null, claimVisibleDays: null, claimHiddenDays: null }} />}>
        <Support searchParams={searchParams} />
      </Suspense>
    </PageWrap>
  );
}

type T = { id: string; code: string; subject: string; status: string; category: string; updated_at: string; order_id: string | null; orders: { code: string } | null };

async function loadTickets(orgId: string): Promise<TicketsState> {
  const sb = await createClient();
  const { data, error } = await sb.from('tickets').select('id, code, subject, status, category, updated_at, order_id, orders(code)').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(100);
  if (error) return { kind: 'error' };
  const tickets = (data ?? []) as unknown as T[];
  const last = new Map<string, { fromTeam: boolean; text: string }>();
  if (tickets.length) {
    const { data: msgs } = await sb.from('ticket_messages').select('ticket_id, body, is_staff, created_at').in('ticket_id', tickets.map((t) => t.id)).eq('internal', false).order('created_at', { ascending: false }).limit(500);
    for (const m of (msgs ?? []) as { ticket_id: string; body: string; is_staff: boolean }[]) {
      if (!last.has(m.ticket_id)) last.set(m.ticket_id, { fromTeam: !!m.is_staff, text: m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body });
    }
  }
  const rows: TicketListRow[] = tickets.map((t) => ({
    id: t.id, code: t.code, subject: t.subject, status: t.status, category: t.category, updatedAt: t.updated_at,
    order: t.order_id && t.orders ? { id: t.order_id, code: t.orders.code } : null, last: last.get(t.id) ?? null,
  }));
  return { kind: 'ready', rows };
}

async function Support({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireAccount('/account/support');
  const sp = await searchParams;
  const orgId = s.org!.id;
  const sb = await createClient();
  const [tickets, ordersRes, content, settings] = await Promise.all([
    settle(() => loadTickets(orgId)),
    sb.from('orders').select('id, code, title, status, delivered_at, claim_visible_until, claim_hidden_until').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
    settle(() => getSiteContent()),
    settle(() => getSettings()),
  ]);
  const orders = (ordersRes.data ?? []) as TicketOrderOption[];
  const preset = sp.topic ? TOPICS[sp.topic] : undefined;
  const pre = supportPrefill(sp.about, sp.subject);
  const company = content.ok ? content.data.company : null;
  const contacts: SupportContacts = {
    whatsapp: company?.whatsapp ?? null, email: company?.email ?? null, phone: company?.phone ?? null,
    claimVisibleDays: settings.ok ? settings.data.claim_visible_days : null, claimHiddenDays: settings.ok ? settings.data.claim_hidden_days : null,
  };
  const defaultOrderId = sp.order && orders.some((o) => o.id === sp.order) ? sp.order : null;
  return (
    <SupportView tab={pickTab(sp.tab, SUPPORT_TABS)} tickets={tickets.ok ? tickets.data : { kind: 'error' }} contacts={contacts}
      openNew={sp.new === '1' || !!pre || !!preset || !!defaultOrderId}
      newTicket={<NewTicketForm orders={orders} orgId={orgId} now={nowMs()} defaultOrderId={defaultOrderId} defaultSubject={preset?.[0] ?? pre?.subject ?? ''} defaultBody={preset?.[1] ?? pre?.body ?? ''} />} />
  );
}
