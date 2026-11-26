import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { withHiddenColumns, withSuppliers } from '@/components/backoffice/hidden-columns';
import { Card, PageHeader, StatusBadge, EmptyState, Stat } from '@/components/ui';
import { ActionForm, RunButton } from '@/components/backoffice/action-form';
import { TicketReply } from '@/components/backoffice/ticket-reply';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getCurrencyContext } from '@/lib/currency';
import { SUPPORT_KIND_LABEL, type TicketContext } from '@/lib/warehouse-w5';
import { CASE_KIND_LABEL, caseStatusLabel, usd, type CaseKind, type CaseStatus } from '@/lib/dropship-problems-shared';
import { replyTicket, updateTicket, ticketStatusForm, ticketPriorityForm, saveMacro, escalateToFinance } from '../actions';

export const metadata = { title: 'Support desk' };

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'gray' | 'blue'> = { urgent: 'red', high: 'red', normal: 'gray', low: 'gray' };
const FILTERS = ['all', 'complaint', 'question', 'feedback', 'overdue', 'mine', 'resolved'] as const;

function slaLabel(d: string | null, status: string) {
  if (!d || ['resolved', 'closed'].includes(status)) return { text: humanize(status), bad: false };
  const h = Math.round((new Date(d).getTime() - Date.now()) / 36e5);
  return h < 0 ? { text: `Overdue ${-h} h`, bad: true } : { text: h < 24 ? `${h} h left` : `${Math.round(h / 24)} days left`, bad: h < 4 };
}

export default async function SupportDesk({ searchParams }: { searchParams: Promise<{ f?: string; t?: string; p?: string }> }) {
  const s = await requireStaff('support', 'view', '/office/support');
  const { f = 'all', t: selId, p: prio } = await searchParams;
  const sb = await createClient();
  let q = sb.from('tickets').select('id, code, subject, category, priority, status, sla_due_at, created_at, updated_at, organizations(name)').limit(200);
  if (f === 'resolved') q = q.in('status', ['resolved', 'closed']);
  else q = q.not('status', 'in', '(resolved,closed)');
  if (['complaint', 'question', 'feedback'].includes(f)) q = q.eq('category', f);
  if (f === 'overdue') q = q.lt('sla_due_at', new Date().toISOString());
  // tickets.assigned_to is hidden from session reads (migration 195): "mine" = ids assigned to the caller (service role,
  // own assignments only), still intersected with the caller's RLS-visible tickets by the session query.
  if (f === 'mine') {
    const { data: mineIds } = await createAdminClient().from('tickets').select('id').eq('assigned_to', s.userId).limit(1000);
    q = q.in('id', (mineIds ?? []).map((r) => r.id as string).concat('00000000-0000-0000-0000-000000000000'));
  }
  if (prio) q = q.eq('priority', prio);
  const [{ data: ticketRows }, { count: openCount }, { count: overdueCount }, { data: macros }, { data: csat }] = await Promise.all([
    q,
    sb.from('tickets').select('id', { count: 'exact', head: true }).not('status', 'in', '(resolved,closed)'),
    sb.from('tickets').select('id', { count: 'exact', head: true }).not('status', 'in', '(resolved,closed)').lt('sla_due_at', new Date().toISOString()),
    sb.from('support_macros').select('id, title, body').order('title'),
    sb.from('tickets').select('csat').not('csat', 'is', null).limit(500),
  ]);
  const rawTickets = await withHiddenColumns<NonNullable<typeof ticketRows>[number], { assigned_to: string | null }>('tickets', ticketRows, 'assigned_to');
  const tickets = [...rawTickets].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.sla_due_at ?? '9').localeCompare(b.sla_due_at ?? '9'));
  const sel = selId ?? tickets[0]?.id;
  const { data: tRow } = sel ? await sb.from('tickets')
    .select('id, code, org_id, order_id, store_order_id, subject, category, priority, status, sla_due_at, csat, created_at, organizations(name, country, kyc_status), orders(id, code, status, currency, claim_visible_until, claim_hidden_until, delivered_at)')
    .eq('id', sel).maybeSingle() : { data: null };
  // assigned_to and the order's supplier (orders.supplier_id) are hidden from session reads (migration 195): added with the
  // service role for the ticket / order RLS returned, after requireStaff.
  const [t = null] = tRow ? await withHiddenColumns<NonNullable<typeof tRow> & Record<string, unknown>, { assigned_to: string | null }>('tickets', [tRow], 'assigned_to') : [];
  const tOrder = t ? one(t.orders as unknown as Record<string, unknown> | null) : null;
  const [ordWithSup] = tOrder ? await withSuppliers<Record<string, unknown>, { code: string }>(sb, 'orders', [tOrder as Record<string, unknown>], 'code') : [];
  const { data: msgs } = t ? await sb.from('ticket_messages').select('id, author_id, is_staff, internal, body, attachments, created_at').eq('ticket_id', t.id).order('created_at') : { data: null };
  // Warehouse OS W5: a warehouse request carries its type and the client's order / stock notice / return (links to the warehouse screens)
  const { data: whCtxRaw } = t && t.category === 'warehouse' ? await sb.rpc('wh_ticket_context', { p_ticket: t.id }) : { data: null };
  const whCtx = (whCtxRaw ?? null) as TicketContext;
  // Octopus Dropship Step 10: a ticket linked to a store order shows the order and its claims / returns (Order problems)
  const { data: dsCtxRaw } = t && t.store_order_id ? await sb.rpc('ds10_ticket_context', { p_ticket: t.id }) : { data: null };
  const dsCtx = (dsCtxRaw ?? null) as { store_order_id: string; order_number: string; external_order_name: string | null; merchant_status: string; payment_state: string;
    total_cents: number | null; cases: { code: string; kind: CaseKind; status: CaseStatus }[] } | null;
  const authorIds = [...new Set([...(msgs ?? []).map((m) => m.author_id), t?.assigned_to].filter(Boolean))] as string[];
  const { data: people } = authorIds.length ? await sb.from('profiles').select('id, full_name').in('id', authorIds) : { data: [] };
  const name = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? (id ? 'User' : '—');
  const canEdit = can(s, 'support', 'edit');
  const canEscalate = can(s, 'support', 'create') || can(s, 'finance', 'create');
  const avgCsat = csat?.length ? (csat.reduce((a, c) => a + (c.csat ?? 0), 0) / csat.length).toFixed(1) : null;
  const org = t ? one(t.organizations as unknown as { name: string; country: string | null; kyc_status: string } | null) : null;
  const ord = t ? ((ordWithSup ?? null) as unknown as { id: string; code: string; status: string; currency: string; claim_visible_until: string | null; claim_hidden_until: string | null; delivered_at: string | null; suppliers: { code: string } | { code: string }[] | null } | null) : null;
  // finance approvals use the order currency, else the platform currency (SPEC §15.1)
  const escCurrency = ord?.currency ?? (await getCurrencyContext()).currency;
  const link = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(); const m = { f, p: prio, t: selId, ...o };
    Object.entries(m).forEach(([k, v]) => v && p.set(k, v));
    return `/office/support?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Support desk" subtitle="Complaints, claims, questions and feedback from customers, in one queue." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Open tickets" value={openCount ?? 0} hint={`${overdueCount ?? 0} past reply target`} hintTone={(overdueCount ?? 0) > 0 ? 'bad' : 'ok'} />
        <Stat label="Assigned to me" value={(rawTickets ?? []).filter((x) => x.assigned_to === s.userId).length} hint="in this view" />
        <Stat label="Customer satisfaction" value={avgCsat ? `${avgCsat} / 5` : '—'} hint={csat?.length ? `from ${csat.length} ratings` : 'no ratings yet'} />
        <Stat label="Macros" value={macros?.length ?? 0} hint="quick replies" />
      </div>

      <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        <section className="card overflow-hidden">
          <nav className="flex flex-wrap gap-2 p-4 border-b border-line" aria-label="Ticket filters">
            {FILTERS.map((k) => <Link key={k} href={link({ f: k, t: undefined })} aria-current={f === k ? 'page' : undefined} className={cn('rounded-full px-3 py-1.5 text-sm font-semibold border', f === k ? 'bg-ink text-white border-ink' : 'border-line-strong')}>{humanize(k)}</Link>)}
            <form className="w-full flex gap-2 mt-1">
              <input type="hidden" name="f" value={f} />
              <label htmlFor="sd-p" className="sr-only">Priority</label>
              <select id="sd-p" name="p" defaultValue={prio ?? ''} className="input min-h-9 text-sm"><option value="">Any priority</option>{['urgent', 'high', 'normal', 'low'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
              <button className="btn btn-ghost btn-sm">Filter</button>
            </form>
          </nav>
          {!tickets.length ? <EmptyState title="No tickets" body="Nothing in this view." /> : (
            <ul className="divide-y divide-line max-h-[760px] overflow-y-auto">
              {tickets.map((x) => {
                const sla = slaLabel(x.sla_due_at, x.status);
                return (
                  <li key={x.id}>
                    <Link href={link({ t: x.id })} aria-current={x.id === sel ? 'true' : undefined} className={cn('block px-4 py-3 border-l-[3px]', x.id === sel ? 'bg-tint border-coral-text' : 'border-transparent hover:bg-pearl')}>
                      <div className="flex justify-between gap-2 text-xs"><span className="mono text-muted">{x.code} · {one(x.organizations as unknown as { name: string } | null)?.name}</span><span className={cn('font-semibold', sla.bad ? 'text-bad' : 'text-muted')}>{sla.text}</span></div>
                      <div className="font-semibold mt-1">{x.subject}</div>
                      <div className="flex gap-2 mt-1.5">
                        <StatusBadge status={x.category} label={humanize(x.category)} tone={x.category === 'complaint' ? 'red' : x.category === 'feedback' ? 'amber' : 'blue'} />
                        <StatusBadge status={x.priority} label={humanize(x.priority)} tone={PRIORITY_TONE[x.priority]} />
                        <StatusBadge status={x.status} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {t ? (
          <div className="space-y-6 min-w-0">
            <section className="card p-6">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <div className="mono text-xs text-muted">{t.code} · opened {fmtDate(t.created_at, true)} · {humanize(t.category)}</div>
                  <h2 className="text-2xl font-semibold mt-1">{t.subject}</h2>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <div className="rounded-[10px] bg-pearl p-3"><div className="text-sm text-muted">Customer</div><div className="font-semibold">{org?.name} · {org?.country} · KYC {humanize(org?.kyc_status)}</div></div>
                <div className="rounded-[10px] bg-pearl p-3"><div className="text-sm text-muted">Order</div><div className="font-semibold mono">{ord ? <Link href={`/office/orders/${ord.id}`} className="text-coral-text">{ord.code}</Link> : '—'}</div>{ord && <div className="text-xs text-muted">{humanize(ord.status)}</div>}</div>
                <div className="rounded-[10px] bg-pearl p-3"><div className="text-sm text-muted">Supplier · SLA</div><div className="font-semibold mono">{ord ? one(ord.suppliers)?.code ?? '—' : '—'}</div><div className={cn('text-xs', slaLabel(t.sla_due_at, t.status).bad ? 'text-bad font-semibold' : 'text-muted')}>{slaLabel(t.sla_due_at, t.status).text} · assigned {name(t.assigned_to)}</div></div>
              </div>
              {ord?.delivered_at && (
                <div className={cn('mt-3 rounded-[10px] px-4 py-2 text-sm', ord.claim_hidden_until && new Date(ord.claim_hidden_until) > new Date() ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad')}>
                  Claim window (Terms): visible defects until {fmtDate(ord.claim_visible_until)}, hidden defects until {fmtDate(ord.claim_hidden_until)}
                </div>
              )}
            </section>

            {whCtx && (
              <section className="card p-6" aria-labelledby="sd-wh" data-testid="sd-warehouse">
                <h3 id="sd-wh" className="text-lg font-semibold">Warehouse request · {SUPPORT_KIND_LABEL[whCtx.kind] ?? humanize(whCtx.kind)}</h3>
                {whCtx.order ? (
                  <div className="mt-2 text-[15px]" data-testid="sd-warehouse-order">
                    Order <Link href={`/office/warehouse/orders/${whCtx.order.code}`} className="mono text-coral-text">{whCtx.order.code}</Link>
                    {whCtx.order.external_ref ? <span className="text-muted"> (client ref {whCtx.order.external_ref})</span> : null} · {humanize(whCtx.order.status)} · {whCtx.order.warehouse_code}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {whCtx.order.packed && (
                        <Link href={`/office/warehouse/evidence/${whCtx.order.code}`} className="btn btn-ghost btn-sm" data-testid="sd-warehouse-evidence">
                          Packing record{whCtx.order.photos ? ` (${whCtx.order.photos} photo${whCtx.order.photos === 1 ? '' : 's'})` : ''}
                        </Link>
                      )}
                      {whCtx.order.tracking_token && <Link href={`/t/${whCtx.order.tracking_token}`} target="_blank" className="btn btn-ghost btn-sm">Tracking page</Link>}
                    </div>
                  </div>
                ) : whCtx.asn ? (
                  <div className="mt-2 text-[15px]">Stock notice <Link href={`/office/warehouse/receive/${whCtx.asn.code}`} className="mono text-coral-text">{whCtx.asn.code}</Link> · {humanize(whCtx.asn.status)} · {whCtx.asn.warehouse_code}</div>
                ) : whCtx.return ? (
                  <div className="mt-2 text-[15px]">Return <Link href={`/office/warehouse/returns?status=all&r=${whCtx.return.code}`} className="mono text-coral-text">{whCtx.return.code}</Link> · {humanize(whCtx.return.status)}{whCtx.return.decision ? ` · ${humanize(whCtx.return.decision)}` : ''}</div>
                ) : <p className="mt-2 text-sm text-muted">No order, stock notice or return was chosen.</p>}
                <p className="text-xs text-muted mt-3">Photos the client attached are in the conversation below.</p>
              </section>
            )}

            {dsCtx && (
              <section className="card p-6" aria-labelledby="sd-ds" data-testid="sd-dropship">
                <h3 id="sd-ds" className="text-lg font-semibold">Dropship order {dsCtx.external_order_name ?? dsCtx.order_number}</h3>
                <div className="mt-2 text-[15px]"><span className="mono">{dsCtx.order_number}</span> · {humanize(dsCtx.merchant_status)} · {humanize(dsCtx.payment_state)} · {usd(dsCtx.total_cents)}</div>
                {dsCtx.cases.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[15px]">
                    {dsCtx.cases.map((c) => (
                      <li key={c.code}><Link href={`/office/dropship/problems?c=${c.code}`} className="mono text-coral-text">{c.code}</Link> · {CASE_KIND_LABEL[c.kind]} · {caseStatusLabel(c.status, c.kind).label}</li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-sm text-muted">No claim or return on this order.</p>}
                <p className="text-xs text-muted mt-3">Claims, returns and refunds are decided in Dropship › Order problems (refunds above US$1,000 need a second Finance approver).</p>
              </section>
            )}

            <section className="card p-6">
              <h3 className="text-lg font-semibold mb-4">Conversation</h3>
              <ol className="space-y-3">
                {(msgs ?? []).map((m) => (
                  <li key={m.id} className={cn('rounded-[10px] px-4 py-3 max-w-[85%]', m.internal ? 'ml-auto bg-warn-bg border border-dashed border-warn/60' : m.is_staff ? 'ml-auto bg-tint' : 'bg-pearl')}>
                    <div className={cn('text-xs font-semibold', m.internal ? 'text-warn' : m.is_staff ? 'text-coral-text' : 'text-ink')}>
                      {m.internal ? 'Internal note · ' : m.is_staff ? 'Support · ' : 'Customer · '}{name(m.author_id)} · {fmtDate(m.created_at, true)}
                    </div>
                    <p className="text-[15px] mt-1 whitespace-pre-line">{m.body}</p>
                    {Array.isArray(m.attachments) && m.attachments.length > 0 && <div className="text-xs text-muted mt-1">{m.attachments.length} attachment(s)</div>}
                  </li>
                ))}
              </ol>
              <div className="mt-5">
                {canEdit ? <TicketReply action={replyTicket.bind(null, t.id)} macros={macros ?? []} /> : <p className="text-sm text-muted">View only.</p>}
                <p className="text-xs text-muted mt-2">Replies go to the customer&apos;s portal and email. Internal notes are never shown to the customer.</p>
              </div>
            </section>

            {canEdit && (
              <section className="card p-6 grid md:grid-cols-3 gap-6">
                <ActionForm action={ticketStatusForm.bind(null, t.id)} submitLabel="Update status" submitClass="btn btn-ghost btn-sm">
                  <label htmlFor="ts-s" className="label">Status</label>
                  <select id="ts-s" name="status" defaultValue={t.status} className="input">{['new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'reopened'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
                </ActionForm>
                <ActionForm action={ticketPriorityForm.bind(null, t.id)} submitLabel="Update priority" submitClass="btn btn-ghost btn-sm">
                  <label htmlFor="ts-p" className="label">Priority</label>
                  <select id="ts-p" name="priority" defaultValue={t.priority} className="input">{['urgent', 'high', 'normal', 'low'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
                </ActionForm>
                <div>
                  <span className="label">Assigned to</span>
                  <div className="input flex items-center bg-pearl">{name(t.assigned_to)}</div>
                  {t.assigned_to !== s.userId && <div className="mt-3"><RunButton action={updateTicket.bind(null, t.id, { assign_to_me: true })}>Assign to me</RunButton></div>}
                </div>
              </section>
            )}

            {canEscalate && (
              <section className="card p-6">
                <h3 className="text-lg font-semibold">Escalate to finance</h3>
                <p className="text-sm text-muted">Refunds and credit notes go to Finance for approval (maker–checker: you cannot approve your own request; amounts over the limit need Admin).</p>
                <ActionForm action={escalateToFinance.bind(null, t.id, t.org_id, t.order_id ?? null)} submitLabel="Send to finance" resetOnSuccess confirm="Send this refund / credit note request to Finance?">
                  <div className="grid sm:grid-cols-[180px_160px_1fr] gap-3 mt-3">
                    <div>
                      <label htmlFor="es-k" className="label">Resolution</label>
                      <select id="es-k" name="kind" className="input"><option value="credit_note">Credit note</option><option value="refund">Refund</option></select>
                    </div>
                    <div>
                      <label htmlFor="es-a" className="label">Amount ({escCurrency})</label>
                      <input id="es-a" name="amount" type="number" step="0.01" min="0.01" required className="input mono" />
                    </div>
                    <div>
                      <label htmlFor="es-r" className="label">Reason</label>
                      <input id="es-r" name="reason" required className="input" placeholder="e.g. 2 cartons crushed in transit, 400 pcs affected" />
                    </div>
                  </div>
                </ActionForm>
              </section>
            )}

            {canEdit && (
              <details className="card p-6">
                <summary className="font-semibold cursor-pointer">Manage macros ({macros?.length ?? 0})</summary>
                <ul className="mt-3 space-y-2 text-sm">{(macros ?? []).map((m) => <li key={m.id}><b>{m.title}</b> — <span className="text-muted">{m.body}</span></li>)}</ul>
                <ActionForm action={saveMacro} submitLabel="Save macro" resetOnSuccess submitClass="btn btn-ghost btn-sm">
                  <div className="grid sm:grid-cols-[200px_1fr] gap-3 mt-4">
                    <div><label htmlFor="mc-t" className="label">Title</label><input id="mc-t" name="title" className="input" required /></div>
                    <div><label htmlFor="mc-b" className="label">Text</label><textarea id="mc-b" name="body" className="input min-h-16 py-2" required /></div>
                  </div>
                </ActionForm>
              </details>
            )}
          </div>
        ) : <Card><EmptyState title="Select a ticket" /></Card>}
      </div>
    </>
  );
}
