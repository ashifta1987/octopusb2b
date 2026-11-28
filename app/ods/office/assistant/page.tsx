// ODS T9 · Assistant queue (SPEC §20.5, Part 7.6 list + record). Replaces the T8 re-export of app/office/assistant/page.tsx.
// Same guard (requireStaff('assistant','view')), same reads (profiles, account_managers, assistant_queue_view escalations +
// low-confidence, assistant_sessions, hidden confidence / escalation columns via withHiddenColumns after the guard,
// assistant_people, facts), same ?session= deep link and the same actions from app/office/assistant/actions.ts, unchanged
// (assistant:reply / take_over / close are re-checked in each action). Switch off → today's page.
import { Suspense } from 'react';
import { can, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { nowMs as nowMsFn } from '@/components/admin/server';
import { one } from '@/components/backoffice/server-utils';
import { getQuoteFacts, getShipmentFacts, getWalletFacts } from '@/components/backoffice/assistant/facts';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { COUNTRY_NAMES, fmtDate, humanize } from '@/lib/format';
import { logAssistantOpen, lookupShipmentFact, refreshFact, resolveEscalation, setOutOfOffice, staffAssistantReply, takeOverSession } from '@/app/office/assistant/actions';
import { submissionCompanyStatus } from '../kyc/_lib/kyc-core';
import { assignmentOf, assistantTab, reasonLabel, type AssistantRow, type AssistantTab, type ConversationFact, type ConversationMessage, type QueueAuthor } from './_lib/assistant-core';
import { AssistantQueue, SlaText } from './_components/assistant-queue';
import { AssistantConversation, IdentityCard, type IdentityVM } from './_components/assistant-conversation';
import { SalesPageHead, InlineNotice } from '../_components/sales-bits';

export const metadata = { title: 'Assistant queue' };

type SP = Promise<{ session?: string; tab?: string }>;
type QueueRow = {
  session_id: string; org_id: string; org_name: string; buyer_code: string | null; country: string | null; status: string; title: string | null;
  low_confidence_turns: number; last_message_at: string; escalation_id: string | null; reason: string | null;
  assigned_to: string | null; taken_by_staff_id: string | null; sla_due_at: string | null; resolved_at: string | null;
};

export default function AssistantQueuePage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<Head />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function Head({ title, crumb }: { title?: string; crumb?: string }) {
  return (
    <SalesPageHead
      crumbs={crumb ? [{ label: 'Support desk' }, { label: 'Assistant queue', href: crumb }, { label: title ?? 'Conversation' }] : [{ label: 'Support desk' }, { label: 'Assistant queue' }]}
      title={title ?? 'Assistant queue'}
      subtitle={crumb ? undefined : 'Customers handed over by Octo, your assigned customers, and conversations where Octo is unsure.'}
    />
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('assistant', 'view', '/office/assistant');
  const { session: selId, tab: rawTab } = await searchParams;
  const tab: AssistantTab = assistantTab(rawTab);
  const sb = await createClient();
  const now = nowMsFn();

  if (selId) return <Conversation s={s} selId={selId} tab={tab} now={now} />;

  const [{ data: me }, { data: mineRaw, error: e1 }, { data: escRaw, error: e2 }, { data: lowRaw, error: e3 }] = await Promise.all([
    sb.from('profiles').select('out_of_office, team, full_name').eq('id', s.userId).maybeSingle(),
    sb.from('account_managers').select('org_id, team, assigned_at, organizations(name, buyer_code, country, kyc_status)').eq('staff_user_id', s.userId).order('assigned_at', { ascending: false }),
    sb.from('assistant_queue_view').select('*').not('escalation_id', 'is', null).is('resolved_at', null).order('sla_due_at', { ascending: true }).limit(100),
    sb.from('assistant_queue_view').select('*').eq('status', 'bot').gte('low_confidence_turns', 2).order('last_message_at', { ascending: false }).limit(50),
  ]);
  const mine = (mineRaw ?? []).map((r) => ({ ...r, org: one(r.organizations as unknown as { name: string; buyer_code: string | null; country: string | null; kyc_status: string } | null) }));
  const mineIds = mine.map((m) => m.org_id as string);
  const { data: lastSessions } = mineIds.length
    ? await sb.from('assistant_sessions').select('id, org_id, title, status, last_message_at').in('org_id', mineIds).order('last_message_at', { ascending: false }).limit(300)
    : { data: [] as { id: string; org_id: string; title: string | null; status: string; last_message_at: string }[] };
  const lastByOrg = new Map<string, { id: string; title: string | null; status: string; last_message_at: string }>();
  for (const x of lastSessions ?? []) if (!lastByOrg.has(x.org_id as string)) lastByOrg.set(x.org_id as string, x as { id: string; title: string | null; status: string; last_message_at: string });

  const fromQueue = (q: QueueRow): AssistantRow => ({
    sessionId: q.session_id, key: q.session_id, orgName: q.org_name, buyerCode: q.buyer_code, country: q.country, title: q.title ?? 'Conversation',
    status: q.status, reason: q.reason, slaDueAt: q.sla_due_at, lastMessageAt: q.last_message_at, lowTurns: q.low_confidence_turns,
    assignment: q.escalation_id ? assignmentOf(q.assigned_to, s.userId) : null, taken: !!q.taken_by_staff_id,
  });
  const lists: Record<AssistantTab, AssistantRow[]> = {
    escalations: ((escRaw ?? []) as QueueRow[]).map(fromQueue),
    low: ((lowRaw ?? []) as QueueRow[]).map(fromQueue),
    mine: mine.map((m) => {
      const last = lastByOrg.get(m.org_id as string);
      return {
        sessionId: last?.id ?? null, key: `org:${m.org_id}`, orgName: m.org?.name ?? 'Customer', buyerCode: m.org?.buyer_code ?? null, country: m.org?.country ?? null,
        title: last?.title ?? 'Conversation', status: last?.status ?? null, reason: null, slaDueAt: null, lastMessageAt: last?.last_message_at ?? null, lowTurns: 0,
        assignment: null, taken: false, kycStatus: m.org?.kyc_status ?? null,
      };
    }),
  };

  return (
    <div className="grid min-w-0 gap-3">
      <Head />
      {/* SPEC §20.5 / §21.1 #10: new handoffs nudge the queue live (same subscription as today) */}
      <RealtimeRefresh channel="assistant-queue" subs={[{ table: 'escalations', event: 'INSERT' }, { table: 'escalations', event: 'UPDATE' }]} />
      <AssistantQueue
        tab={tab}
        lists={lists}
        nowMs={now}
        base="/office/assistant"
        outOfOffice={!!me?.out_of_office}
        team={(me?.team as string | null) ?? null}
        setOutOfOffice={setOutOfOffice}
        error={!!(e1 || e2 || e3)}
      />
    </div>
  );
}

async function Conversation({ s, selId, tab, now }: { s: Awaited<ReturnType<typeof requireStaff>>; selId: string; tab: AssistantTab; now: number }) {
  const sb = await createClient();
  const back = `/office/assistant${tab !== 'escalations' ? `?tab=${tab}` : ''}`;
  const { data: sel } = await sb.from('assistant_sessions')
    .select('id, org_id, customer_user_id, title, status, channel, page_context, low_confidence_turns, escalation_id, started_at, last_message_at').eq('id', selId).maybeSingle();
  if (!sel) {
    return (
      <div className="grid min-w-0 gap-3">
        <Head title="Conversation" crumb={back} />
        <InlineNotice tone="danger" role="alert">Conversation not found, or it belongs to a customer you are not assigned to. <a href={back} className="font-semibold text-ods-blue underline">Back to the queue</a></InlineNotice>
      </div>
    );
  }
  const { data: me } = await sb.from('profiles').select('full_name').eq('id', s.userId).maybeSingle();
  const [{ data: msgRows }, { data: escRow }, { data: orgRow }, { data: am }, { data: orders }, { data: rfqs }] = await Promise.all([
    sb.from('assistant_messages').select('id, author, author_user_id, content, hidden_from_customer, created_at').eq('session_id', sel.id).order('created_at').limit(500),
    sel.escalation_id ? sb.from('escalations').select('id, team, ticket_id, requested_at, sla_due_at, taken_at, resolved_at').eq('id', sel.escalation_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('organizations').select('id, name, buyer_code, country, city, kyc_status').eq('id', sel.org_id).maybeSingle(),
    sb.from('account_managers').select('staff_user_id, team, assigned_at').eq('org_id', sel.org_id).maybeSingle(),
    sb.from('orders').select('id, code, status').eq('org_id', sel.org_id).order('created_at', { ascending: false }).limit(3),
    sb.from('rfqs').select('id, code, status').eq('org_id', sel.org_id).in('status', ['submitted', 'assigned', 'quoting', 'quoted']).order('created_at', { ascending: false }).limit(3),
  ]);
  // confidence / tools_called / escalation details are hidden from session reads (migration 195): rows from the session
  // client (RLS), the columns from the service role after requireStaff — exactly as today.
  const [msgs, [esc = null]] = await Promise.all([
    withHiddenColumns<NonNullable<typeof msgRows>[number], { confidence: number | null; tools_called: unknown[] | null }>('assistant_messages', msgRows, 'confidence, tools_called'),
    withHiddenColumns<NonNullable<typeof escRow>, { reason: string | null; confidence: number | null; excerpt: string | null; assigned_to: string | null; taken_by_staff_id: string | null; outcome: string | null }>(
      'escalations', escRow ? [escRow] : [], 'reason, confidence, excerpt, assigned_to, taken_by_staff_id, outcome'),
  ]);
  const org = orgRow as { id: string; name: string; buyer_code: string | null; country: string | null; city: string | null; kyc_status: string } | null;
  const staffIds = [...new Set([...(msgs ?? []).map((m) => m.author_user_id), am?.staff_user_id, esc?.assigned_to, esc?.taken_by_staff_id].filter(Boolean))] as string[];
  const [{ data: ppl }, { data: ticket }, { data: customer }] = await Promise.all([
    staffIds.length ? sb.rpc('assistant_people', { p_ids: staffIds }) : Promise.resolve({ data: [] }),
    esc?.ticket_id ? sb.from('tickets').select('id, code, status').eq('id', esc.ticket_id).maybeSingle() : Promise.resolve({ data: null }),
    sel.customer_user_id ? sb.from('profiles').select('full_name, email, phone').eq('id', sel.customer_user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const people: Record<string, string> = {};
  const amInfo: Record<string, { team: string | null; out_of_office: boolean }> = {};
  for (const p of (ppl ?? []) as { id: string; full_name: string; team: string | null; out_of_office: boolean }[]) { people[p.id] = p.full_name; amInfo[p.id] = p; }
  if (me?.full_name) people[s.userId] = me.full_name as string;

  const settled = await Promise.allSettled([
    ...(orders ?? []).map((o) => getShipmentFacts(sb, o.code as string).then((f) => (f ? { key: `ship:${o.id}`, title: f.title, text: f.text, kind: 'shipment' as const, ref: o.code as string } : null))),
    ...(rfqs ?? []).map((r) => getQuoteFacts(sb, r.id as string).then((f) => (f ? { key: `rfq:${r.id}`, title: f.title, text: f.text, kind: 'quotes' as const, ref: r.id as string } : null))),
    getWalletFacts(sb, sel.org_id as string).then((f) => (f ? { key: 'wallet', title: f.title, text: f.text, kind: 'wallet' as const, ref: sel.org_id as string } : null)),
  ]);
  const facts = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value as ConversationFact] : []));
  const messages: ConversationMessage[] = (msgs ?? []).map((m) => ({
    id: m.id as string, author: m.author as QueueAuthor, authorName: m.author_user_id ? people[m.author_user_id as string] ?? null : null, content: m.content as string,
    internal: Boolean(m.hidden_from_customer), confidence: m.confidence == null ? null : Number(m.confidence),
    tools: Array.isArray(m.tools_called) ? m.tools_called.length : 0, createdAt: m.created_at as string,
  }));
  const amId = am?.staff_user_id as string | undefined;
  const who = (id: string | null | undefined, meWord: string) => (id ? (id === s.userId ? meWord : people[id] ?? 'staff') : null);
  const identity: IdentityVM = {
    org: org ? {
      name: org.name, buyerCode: org.buyer_code, country: org.country ? `${COUNTRY_NAMES[org.country] ?? org.country} (${org.country})` : null, city: org.city,
      kycStatusName: submissionCompanyStatus(org.kyc_status), kycRaw: humanize(org.kyc_status),
    } : null,
    contact: customer ? { name: (customer.full_name as string | null) ?? null, email: (customer.email as string | null) ?? null } : null,
    manager: amId ? { name: people[amId] ?? 'Staff', you: amId === s.userId, outOfOffice: !!amInfo[amId]?.out_of_office, team: (am?.team as string | null) ?? null, since: am?.assigned_at ? fmtDate(am.assigned_at as string) : null } : null,
    startedAt: fmtDate(sel.started_at as string, true),
    channel: humanize(sel.channel as string),
    pageContext: (sel.page_context as string | null) ?? null,
    escalation: esc ? {
      reason: (esc.reason as string | null) ?? null,
      reasonText: reasonLabel(esc.reason as string | null),
      slaText: esc.taken_at ? <span className="text-ods-slate">First response {fmtDate(esc.taken_at as string, true)}</span> : <SlaText due={esc.sla_due_at as string | null} resolvedAt={esc.resolved_at as string | null} nowMs={now} />,
      excerpt: (esc.excerpt as string | null) ?? null,
      assigned: esc.assigned_to ? (esc.assigned_to === s.userId ? 'to me' : people[esc.assigned_to as string] ?? 'staff') : `${(esc.team as string | null) ?? 'Team'} queue`,
      takenBy: who(esc.taken_by_staff_id as string | null, 'me'),
      resolved: esc.resolved_at ? `${fmtDate(esc.resolved_at as string, true)}${esc.outcome ? ` — ${esc.outcome}` : ''}` : null,
      ticket: esc.ticket_id ? { code: (ticket?.code as string | undefined) ?? 'Ticket opened', status: (ticket?.status as string | undefined) ?? null, href: can(s, 'support', 'view') ? `/office/support?t=${esc.ticket_id}` : null } : null,
    } : null,
  };

  return (
    <div className="grid min-w-0 gap-3">
      <Head title={(sel.title as string | null) ?? 'Conversation'} crumb={back} />
      <p className="-mt-2 m-0 font-mono text-ods-small text-ods-slate">{org?.buyer_code ?? ''}{org?.buyer_code ? ' · ' : ''}{org?.name ?? ''}</p>
      {/* live: new messages in this thread + session status changes re-read the server view (today's workspace subscribes to the same tables) */}
      <RealtimeRefresh channel={`assistant-staff:${sel.id}`} subs={[{ table: 'assistant_messages', event: 'INSERT', filter: `session_id=eq.${sel.id}` }, { table: 'assistant_sessions', event: 'UPDATE', filter: `id=eq.${sel.id}` }]} />
      <AssistantConversation
        key={sel.id as string}
        sessionId={sel.id as string}
        status={sel.status as string}
        hasOpenEscalation={!!esc && !esc.resolved_at}
        messages={messages}
        facts={facts}
        identity={<IdentityCard v={identity} />}
        canReply={can(s, 'assistant', 'reply')}
        canTakeOver={can(s, 'assistant', 'take_over')}
        canClose={can(s, 'assistant', 'close')}
        onOpen={logAssistantOpen}
        reply={staffAssistantReply}
        takeOver={takeOverSession}
        resolve={resolveEscalation}
        lookup={lookupShipmentFact}
        refresh={refreshFact}
      />
    </div>
  );
}
