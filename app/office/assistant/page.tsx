import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { ToggleSetting } from '@/components/admin/client';
import { nowMs } from '@/components/admin/server';
import { one } from '@/components/backoffice/server-utils';
import { ConversationWorkspace, SlaCounter, type QueueMessage, type RailFact } from '@/components/backoffice/assistant/conversation';
import { getQuoteFacts, getShipmentFacts, getWalletFacts } from '@/components/backoffice/assistant/facts';
import { REASON_LABEL, REASON_TONE } from '@/components/backoffice/assistant/sla';
import { COUNTRY_NAMES, fmtDate, humanize } from '@/lib/format';
import { cn } from '@/lib/cn';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { setOutOfOffice } from './actions';

export const metadata = { title: 'Assistant queue' };

type QueueRow = {
  session_id: string; org_id: string; org_name: string; buyer_code: string | null; country: string | null; status: string; title: string | null;
  low_confidence_turns: number; last_message_at: string; account_manager_id: string | null; escalation_id: string | null; reason: string | null;
  assigned_to: string | null; taken_by_staff_id: string | null; sla_due_at: string | null; requested_at: string | null; resolved_at: string | null;
  ticket_id: string | null; mine: boolean | null;
};
type Org = { id: string; name: string; buyer_code: string | null; country: string | null; city: string | null; kyc_status: string };

const ago = (d: string | null | undefined, now: number) => {
  if (!d) return '—';
  const m = Math.max(0, Math.round((now - new Date(d).getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const STATUS_LABEL: Record<string, string> = { bot: 'Octo', escalated: 'Waiting for human', human: 'Human', closed: 'Closed' };
const STATUS_TONE: Record<string, 'blue' | 'amber' | 'green' | 'gray'> = { bot: 'blue', escalated: 'amber', human: 'green', closed: 'gray' };

/** Back-office assistant queue (SPEC §20.5): my customers, open escalations with SLA, Octo low-confidence threads. */
export default async function AssistantQueuePage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const s = await requireStaff('assistant', 'view', '/office/assistant');
  const { session: selId } = await searchParams;
  const sb = await createClient();
  const now = nowMs();

  const [{ data: me }, { data: mineRaw }, { data: escRaw }, { data: lowRaw }] = await Promise.all([
    sb.from('profiles').select('out_of_office, team, full_name').eq('id', s.userId).maybeSingle(),
    sb.from('account_managers').select('org_id, team, assigned_at, organizations(name, buyer_code, country, kyc_status)').eq('staff_user_id', s.userId).order('assigned_at', { ascending: false }),
    sb.from('assistant_queue_view').select('*').not('escalation_id', 'is', null).is('resolved_at', null).order('sla_due_at', { ascending: true }).limit(100),
    sb.from('assistant_queue_view').select('*').eq('status', 'bot').gte('low_confidence_turns', 2).order('last_message_at', { ascending: false }).limit(50),
  ]);
  const mine = (mineRaw ?? []).map((r) => ({ ...r, org: one(r.organizations as unknown as Omit<Org, 'id' | 'city'> | null) }));
  const escalations = (escRaw ?? []) as QueueRow[];
  const lowConf = (lowRaw ?? []) as QueueRow[];

  const mineIds = mine.map((m) => m.org_id as string);
  const { data: lastSessions } = mineIds.length
    ? await sb.from('assistant_sessions').select('id, org_id, title, status, last_message_at').in('org_id', mineIds).order('last_message_at', { ascending: false }).limit(300)
    : { data: [] as { id: string; org_id: string; title: string | null; status: string; last_message_at: string }[] };
  const lastByOrg = new Map<string, { id: string; title: string | null; status: string; last_message_at: string }>();
  for (const x of lastSessions ?? []) if (!lastByOrg.has(x.org_id)) lastByOrg.set(x.org_id, x);

  // ───────── selected conversation ─────────
  const { data: sel } = selId
    ? await sb.from('assistant_sessions').select('id, org_id, customer_user_id, title, status, channel, page_context, low_confidence_turns, escalation_id, started_at, last_message_at').eq('id', selId).maybeSingle()
    : { data: null };

  let workspace: React.ReactNode = null;
  if (sel) {
    const [{ data: msgs }, { data: esc }, { data: orgRow }, { data: am }, { data: orders }, { data: rfqs }] = await Promise.all([
      sb.from('assistant_messages').select('id, author, author_user_id, content, hidden_from_customer, confidence, tools_called, created_at').eq('session_id', sel.id).order('created_at').limit(500),
      sel.escalation_id ? sb.from('escalations').select('id, reason, confidence, excerpt, assigned_to, team, ticket_id, requested_at, sla_due_at, taken_by_staff_id, taken_at, resolved_at, outcome').eq('id', sel.escalation_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('organizations').select('id, name, buyer_code, country, city, kyc_status').eq('id', sel.org_id).maybeSingle(),
      sb.from('account_managers').select('staff_user_id, team, assigned_at, reason').eq('org_id', sel.org_id).maybeSingle(),
      sb.from('orders').select('id, code, status').eq('org_id', sel.org_id).order('created_at', { ascending: false }).limit(3),
      sb.from('rfqs').select('id, code, status').eq('org_id', sel.org_id).in('status', ['submitted', 'assigned', 'quoting', 'quoted']).order('created_at', { ascending: false }).limit(3),
    ]);
    const org = orgRow as Org | null;
    const staffIds = [...new Set([...(msgs ?? []).map((m) => m.author_user_id), am?.staff_user_id, esc?.assigned_to, esc?.taken_by_staff_id].filter(Boolean))] as string[];
    const [{ data: ppl }, { data: ticket }, { data: customer }] = await Promise.all([
      staffIds.length ? sb.rpc('assistant_people', { p_ids: staffIds }) : Promise.resolve({ data: [] }),
      esc?.ticket_id ? sb.from('tickets').select('id, code, status').eq('id', esc.ticket_id).maybeSingle() : Promise.resolve({ data: null }),
      sel.customer_user_id ? sb.from('profiles').select('full_name, email, phone').eq('id', sel.customer_user_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const people: Record<string, string> = {};
    const amInfo: Record<string, { team: string | null; out_of_office: boolean; title: string | null }> = {};
    for (const p of (ppl ?? []) as { id: string; full_name: string; title: string | null; team: string | null; out_of_office: boolean }[]) {
      people[p.id] = p.full_name;
      amInfo[p.id] = p;
    }
    if (me?.full_name) people[s.userId] = me.full_name;

    const settled = await Promise.allSettled([
      ...(orders ?? []).map((o) => getShipmentFacts(sb, o.code as string).then((f) => (f ? { key: `ship:${o.id}`, title: f.title, text: f.text, kind: 'shipment' as const, ref: o.code as string } : null))),
      ...(rfqs ?? []).map((r) => getQuoteFacts(sb, r.id as string).then((f) => (f ? { key: `rfq:${r.id}`, title: f.title, text: f.text, kind: 'quotes' as const, ref: r.id as string } : null))),
      getWalletFacts(sb, sel.org_id as string).then((f) => (f ? { key: 'wallet', title: f.title, text: f.text, kind: 'wallet' as const, ref: sel.org_id as string } : null)),
    ]);
    const facts = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value as RailFact] : []));

    const messages: QueueMessage[] = (msgs ?? []).map((m) => ({
      id: m.id as string, author: m.author as QueueMessage['author'], author_user_id: (m.author_user_id as string | null) ?? null, content: m.content as string,
      hidden_from_customer: Boolean(m.hidden_from_customer), confidence: m.confidence == null ? null : Number(m.confidence),
      tools: Array.isArray(m.tools_called) ? m.tools_called.length : 0, created_at: m.created_at as string,
    }));
    const amId = am?.staff_user_id as string | undefined;
    const openEsc = !!esc && !esc.resolved_at;

    const identity = (
      <section className="card p-5" aria-label="Customer identity">
        <div className="eyebrow">Customer</div>
        {org ? (
          <>
            <h3 className="text-lg font-semibold mt-1">{org.name}</h3>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted">Buyer code</dt><dd className="mono">{org.buyer_code ?? '—'}</dd>
              <dt className="text-muted">Country</dt><dd>{org.country ? `${COUNTRY_NAMES[org.country] ?? org.country} (${org.country})` : '—'}{org.city ? ` · ${org.city}` : ''}</dd>
              <dt className="text-muted">KYC</dt><dd><StatusBadge status={org.kyc_status} /></dd>
              {customer && (<><dt className="text-muted">Contact</dt><dd className="break-words">{customer.full_name}{customer.email ? <><br /><span className="text-muted">{customer.email}</span></> : null}</dd></>)}
              <dt className="text-muted">Account mgr</dt>
              <dd>
                {amId ? (people[amId] ?? 'Staff') : 'Unassigned'}
                {amId === s.userId && <span className="text-xs text-muted"> (you)</span>}
                {amId && amInfo[amId]?.out_of_office && <span className="ml-1"><StatusBadge status="ooo" label="Out of office" tone="amber" /></span>}
                {am?.team && <div className="text-xs text-muted">{am.team} team · since {fmtDate(am.assigned_at as string)}</div>}
              </dd>
            </dl>
          </>
        ) : <p className="text-sm text-muted mt-1">Customer details are not visible to you.</p>}
        <div className="mt-4 pt-4 border-t border-line text-sm space-y-1.5">
          <div><span className="text-muted">Started</span> {fmtDate(sel.started_at as string, true)} · {humanize(sel.channel as string)}</div>
          {sel.page_context && <div className="break-all"><span className="text-muted">Page</span> <span className="mono text-xs">{sel.page_context as string}</span></div>}
          {esc && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={esc.reason as string} label={REASON_LABEL[esc.reason as string] ?? humanize(esc.reason as string)} tone={REASON_TONE[esc.reason as string] ?? 'gray'} />
                {esc.taken_at ? <span className="text-xs text-muted">First response {fmtDate(esc.taken_at as string, true)}</span> : <SlaCounter due={esc.sla_due_at as string | null} resolvedAt={esc.resolved_at as string | null} />}
              </div>
              {esc.excerpt && <p className="text-[13px] text-muted italic">“{esc.excerpt as string}”</p>}
              <div>
                <span className="text-muted">Assigned</span>{' '}
                {esc.assigned_to ? (esc.assigned_to === s.userId ? 'to me' : people[esc.assigned_to as string] ?? 'staff') : `${esc.team ?? 'Team'} queue`}
                {esc.taken_by_staff_id && <> · taken by {esc.taken_by_staff_id === s.userId ? 'me' : people[esc.taken_by_staff_id as string] ?? 'staff'}</>}
              </div>
              {esc.resolved_at && <div><span className="text-muted">Resolved</span> {fmtDate(esc.resolved_at as string, true)}{esc.outcome ? ` — ${esc.outcome}` : ''}</div>}
              {esc.ticket_id && (
                <div>
                  <span className="text-muted">Support ticket</span>{' '}
                  {can(s, 'support', 'view')
                    ? <Link className="text-coral-text font-semibold mono" href={`/office/support?t=${esc.ticket_id}`}>{(ticket?.code as string | undefined) ?? 'Open ticket'}</Link>
                    : <span className="mono">{(ticket?.code as string | undefined) ?? 'Ticket opened'}</span>}
                  {ticket?.status && <span className="ml-1"><StatusBadge status={ticket.status as string} /></span>}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    );

    workspace = (
      <div className="min-w-0">
        <div className="mb-4">
          <div className="mono text-xs text-muted">{org?.buyer_code ?? ''} · last message {ago(sel.last_message_at as string, now)}</div>
          <h2 className="text-2xl font-semibold mt-1">{(sel.title as string | null) ?? 'Conversation'}</h2>
        </div>
        <ConversationWorkspace
          key={sel.id as string}
          sessionId={sel.id as string}
          status={sel.status as string}
          hasOpenEscalation={openEsc}
          initialMessages={messages}
          people={people}
          facts={facts}
          identity={identity}
          canReply={can(s, 'assistant', 'reply')}
          canTakeOver={can(s, 'assistant', 'take_over')}
          canClose={can(s, 'assistant', 'close')}
        />
      </div>
    );
  }

  const href = (id: string) => `/office/assistant?session=${id}`;
  const itemCls = (id: string) => cn('block px-4 py-3 border-l-[3px]', id === selId ? 'bg-tint border-coral-text' : 'border-transparent hover:bg-pearl');
  const overdueCount = escalations.filter((e) => e.sla_due_at && new Date(e.sla_due_at).getTime() < now).length;

  return (
    <>
      <PageHeader
        eyebrow="Support desk"
        title="Assistant queue"
        subtitle="Customers handed over by Octo, your assigned customers, and conversations where Octo is unsure."
        actions={
          <div className="flex flex-col items-end gap-1">
            {/* SPEC §20.5 / §21.1 #10: new handoffs nudge the queue live */}
            <RealtimeRefresh channel="assistant-queue" subs={[{ table: 'escalations', event: 'INSERT' }, { table: 'escalations', event: 'UPDATE' }]} />
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="font-semibold">Out of office</span>
              <ToggleSetting checked={!!me?.out_of_office} label="Out of office" onToggle={setOutOfOffice} showText />
            </span>
            <span className="text-xs text-muted">
              {me?.out_of_office ? `New handoffs go to the ${me?.team ?? 'team'} queue until you return.` : `Handoffs for your customers come to you${me?.team ? ` · ${me.team} team` : ''}.`}
            </span>
          </div>
        }
      />
      {me?.out_of_office && <div className="mb-6"><Notice tone="amber">You are marked <strong>out of office</strong>. Your customers&apos; new handoffs are routed to the team queue.</Notice></div>}

      <div className={cn('grid gap-6', 'lg:grid-cols-[340px_minmax(0,1fr)]')}>
        <div className="space-y-6 min-w-0">
          <section className="card overflow-hidden" aria-labelledby="q-esc">
            <div className="px-4 py-3 border-b border-line flex justify-between items-center">
              <h2 id="q-esc" className="font-semibold">Open escalations</h2>
              <span className="text-xs text-muted">{escalations.length} open{overdueCount ? <> · <span className="text-bad font-semibold">{overdueCount} overdue</span></> : null}</span>
            </div>
            {escalations.length === 0 ? <div className="p-4"><EmptyState title="No open escalations" body="When Octo hands a customer over, it appears here with its SLA." /></div> : (
              <ul className="divide-y divide-line">
                {escalations.map((e) => (
                  <li key={e.session_id}>
                    <Link href={href(e.session_id)} className={itemCls(e.session_id)} aria-current={e.session_id === selId ? 'true' : undefined}>
                      <div className="flex justify-between gap-2 text-xs"><span className="mono text-muted truncate">{e.buyer_code ?? ''} · {e.country ?? ''}</span><SlaCounter due={e.sla_due_at} resolvedAt={null} /></div>
                      <div className="font-semibold mt-1 truncate">{e.org_name}</div>
                      <div className="text-[13px] text-muted truncate">{e.title ?? 'Conversation'}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {e.reason && <StatusBadge status={e.reason} label={REASON_LABEL[e.reason] ?? humanize(e.reason)} tone={REASON_TONE[e.reason] ?? 'gray'} />}
                        <StatusBadge status="assign" label={e.assigned_to ? (e.assigned_to === s.userId ? 'Assigned to me' : 'Assigned to colleague') : 'Team queue'} tone={e.assigned_to === s.userId ? 'green' : 'gray'} />
                        {e.taken_by_staff_id && <StatusBadge status="taken" label="Taken" tone="blue" />}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card overflow-hidden" aria-labelledby="q-mine">
            <div className="px-4 py-3 border-b border-line flex justify-between items-center"><h2 id="q-mine" className="font-semibold">My active customers</h2><span className="text-xs text-muted">{mine.length}</span></div>
            {mine.length === 0 ? <div className="p-4"><EmptyState title="No assigned customers" body="Customers are assigned on KYC verification or by an Admin." /></div> : (
              <ul className="divide-y divide-line">
                {mine.map((m) => {
                  const last = lastByOrg.get(m.org_id as string);
                  const inner = (
                    <>
                      <div className="flex justify-between gap-2 text-xs"><span className="mono text-muted">{m.org?.buyer_code ?? ''} · {m.org?.country ?? ''}</span><span className="text-muted">{last ? ago(last.last_message_at, now) : 'no chats'}</span></div>
                      <div className="font-semibold mt-1 truncate">{m.org?.name ?? 'Customer'}</div>
                      {last ? (
                        <div className="flex items-center gap-2 mt-1"><StatusBadge status={last.status} label={STATUS_LABEL[last.status] ?? humanize(last.status)} tone={STATUS_TONE[last.status] ?? 'gray'} /><span className="text-[13px] text-muted truncate">{last.title ?? 'Conversation'}</span></div>
                      ) : <div className="text-[13px] text-muted mt-1">KYC {humanize(m.org?.kyc_status)}</div>}
                    </>
                  );
                  return <li key={m.org_id as string}>{last ? <Link href={href(last.id)} className={itemCls(last.id)}>{inner}</Link> : <div className="px-4 py-3">{inner}</div>}</li>;
                })}
              </ul>
            )}
          </section>

          <section className="card overflow-hidden" aria-labelledby="q-low">
            <div className="px-4 py-3 border-b border-line flex justify-between items-center"><h2 id="q-low" className="font-semibold">Octo low-confidence</h2><span className="text-xs text-muted">{lowConf.length}</span></div>
            {lowConf.length === 0 ? <div className="p-4"><EmptyState title="Nothing flagged" body="Conversations with 2+ low-confidence bot turns in a row show here before they escalate." /></div> : (
              <ul className="divide-y divide-line">
                {lowConf.map((l) => (
                  <li key={l.session_id}>
                    <Link href={href(l.session_id)} className={itemCls(l.session_id)} aria-current={l.session_id === selId ? 'true' : undefined}>
                      <div className="flex justify-between gap-2 text-xs"><span className="mono text-muted">{l.buyer_code ?? ''}</span><span className="text-muted">{ago(l.last_message_at, now)}</span></div>
                      <div className="font-semibold mt-1 truncate">{l.org_name}</div>
                      <div className="flex items-center gap-2 mt-1"><StatusBadge status="low" label={`${l.low_confidence_turns} low turns`} tone="amber" /><span className="text-[13px] text-muted truncate">{l.title ?? 'Conversation'}</span></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="min-w-0">
          {selId && !sel && <Notice tone="red">Conversation not found, or it belongs to a customer you are not assigned to.</Notice>}
          {workspace ?? (!selId && <div className="card p-10"><EmptyState title="Pick a conversation" body="Open an escalation, one of your customers or a flagged thread to read the full history and reply inline. Every open is written to the audit log." /></div>)}
        </div>
      </div>
    </>
  );
}
