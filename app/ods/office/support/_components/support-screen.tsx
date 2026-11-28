'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, ExternalLink, FolderOpen, UserCheck } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KpiStrip,
  OctopusDataGrid,
  Select,
  StatusPill,
  Tabs,
  Textarea,
  cx,
  formatDate,
  type ContextMenuItem,
  type GridColumn,
} from '@octopus/ui';
import { useOfficeWorkspace } from '@/app/ods/office/_components/office-context';
import {
  FILTER_LABEL, PRIORITIES, REPLY_STATUSES, SUPPORT_PATH, TICKET_FILTERS, TICKET_STATUSES, categoryTone, claimWindowOpen, human, priorityTone, slaLabel, supportHref, ticketStatusTone,
  type Macro, type SupportKpis, type SupportPerms, type SupportQuery, type TicketDetail, type TicketFilter, type TicketRow,
} from '../_lib/support-core';

type Res = { ok: true; message?: string } | { ok: false; error: string };
export type SupportActions = {
  reply: (ticketId: string, fd: FormData) => Promise<Res>;
  setStatus: (ticketId: string, fd: FormData) => Promise<Res>;
  setPriority: (ticketId: string, fd: FormData) => Promise<Res>;
  assignToMe: (ticketId: string) => Promise<Res>;
  saveMacro: (fd: FormData) => Promise<Res>;
  escalate: (ticketId: string, orgId: string, orderId: string | null, fd: FormData) => Promise<Res>;
};

export type SupportResult =
  | { kind: 'ok'; tickets: TicketRow[] | null; kpis: SupportKpis; macros: Macro[]; selected: TicketDetail | null }
  | { kind: 'loading' }
  | { kind: 'forbidden' };

export type SupportScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: SupportQuery;
  result: SupportResult;
  perms: SupportPerms;
  actions: SupportActions;
  nowMs: number;
  fixture?: boolean;
};

const figure = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));

/** Status line under a form: success / error from today's action. */
function useResult() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return [msg, (r: Res) => setMsg(r.ok ? { ok: true, text: r.message ?? 'Saved' } : { ok: false, text: r.error })] as const;
}
function ResultLine({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return (
    <p role="status" className={cx('m-0 min-h-5 text-ods-small', msg?.ok ? 'text-ods-success' : 'text-ods-danger')}>
      {msg?.text ?? ''}
    </p>
  );
}

/**
 * ODS T9 · Back Office › Support desk. Queue (KpiStrip + filter tabs + OctopusDataGrid) and, with ?t=, the ticket record
 * (thread with internal notes, reply, status, priority, assign to me, close, escalate to Finance, macros). Every write is
 * TODAY's server action (app/office/actions.ts) unchanged.
 */
export function SupportScreen({ basePath = SUPPORT_PATH, extraParams, query, result, perms, actions, nowMs, fixture }: SupportScreenProps) {
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(query.q);
  const go = (patch: Partial<SupportQuery>) => startNav(() => router.push(supportHref(basePath, { ...query, ...patch }, extraParams), { scroll: false }));
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => go({ q: v.trim(), t: null }), 350);
  };

  const data = result.kind === 'ok' ? result : null;
  const rows = useMemo(() => data?.tickets ?? [], [data]);
  const openHref = (r: { id: string }) => supportHref(SUPPORT_PATH, { ...query, t: r.id });

  const head = (
    <div className="min-w-0 flex-1">
      <Breadcrumbs items={[{ label: 'Sales', href: '/office' }, { label: 'Support desk' }]} />
      <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">Support desk</h1>
      <p className="m-0 text-ods-small text-ods-slate">Complaints, claims, questions and feedback from customers, in one queue.</p>
    </div>
  );

  if (result.kind === 'forbidden') {
    return (
      <div data-testid="support-page" className="flex flex-col gap-4">
        {head}
        <div className="rounded-ods-card border border-ods-line bg-ods-surface">
          <EmptyState headingLevel={2} title="You don’t have permission to see the support desk" description="The support desk needs the Support view permission. Ask an admin if you need it." />
        </div>
      </div>
    );
  }

  if (data?.selected || (query.t && result.kind === 'ok')) {
    return (
      <div data-testid="support-page" className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-end gap-3">{head}</header>
        <a href={supportHref(basePath, { ...query, t: null }, extraParams)} className="inline-flex items-center gap-1 self-start text-ods-small font-semibold text-ods-info underline">
          <ArrowLeft aria-hidden className="size-4" /> Back to the queue
        </a>
        {data?.selected ? (
          <TicketRecord t={data.selected} macros={data.macros} perms={perms} actions={actions} nowMs={nowMs} onDone={() => !fixture && router.refresh()} />
        ) : (
          <Card><EmptyState headingLevel={2} title="Ticket not found" description="It may have been removed, or you can’t see it." /></Card>
        )}
      </div>
    );
  }

  const columns: GridColumn<TicketRow>[] = [
    {
      id: 'code',
      header: 'Ticket',
      width: 132,
      accessor: (r) => r.code,
      cell: (r) => (
        <a href={openHref(r)} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); go({ t: r.id }); } }} className="font-mono font-semibold text-ods-navy hover:underline">
          {r.code}
        </a>
      ),
    },
    { id: 'subject', header: 'Subject', width: 260, accessor: (r) => r.subject, cell: (r) => <span className="truncate font-medium" title={r.subject}>{r.subject}</span> },
    { id: 'customer', header: 'Customer', width: 170, accessor: (r) => r.customer },
    { id: 'category', header: 'Category', width: 116, accessor: (r) => r.category, cell: (r) => <StatusPill tone={categoryTone(r.category)}>{human(r.category)}</StatusPill> },
    { id: 'priority', header: 'Priority', width: 96, accessor: (r) => r.priority, cell: (r) => <StatusPill tone={priorityTone(r.priority)}>{human(r.priority)}</StatusPill> },
    { id: 'status', header: 'Status', width: 150, accessor: (r) => r.status, cell: (r) => <StatusPill tone={ticketStatusTone(r.status)}>{human(r.status)}</StatusPill> },
    {
      id: 'sla',
      header: 'Reply target',
      width: 124,
      accessor: (r) => r.slaDueAt ?? '',
      cell: (r) => {
        const s = slaLabel(r.slaDueAt, r.status, nowMs);
        return <span className={s.bad ? 'font-semibold text-ods-danger' : 'text-ods-slate'}>{s.text}</span>;
      },
    },
    { id: 'assignee', header: 'Assignee', width: 140, accessor: (r) => r.assignee ?? '', cell: (r) => (r.assignee ? <span className="truncate">{r.assignee}{r.assignedToMe ? ' (you)' : ''}</span> : <span className="text-ods-slate">Unassigned</span>) },
    {
      id: 'order',
      header: 'Linked order',
      width: 160,
      accessor: (r) => r.orderCode ?? '',
      cell: (r) => (r.orderId && r.orderCode ? <a href={`/office/orders/${r.orderId}`} className="font-mono text-ods-info underline">{r.orderCode}</a> : <span className="text-ods-slate">—</span>),
    },
    { id: 'updated', header: 'Updated', width: 100, accessor: (r) => r.updatedAt, cell: (r) => formatDate(r.updatedAt, { short: true }) },
  ];

  const rowActions = (r: TicketRow): ContextMenuItem[] => [
    { id: 'open', label: 'Open', icon: FolderOpen, onSelect: () => go({ t: r.id }) },
    { id: 'tab', label: 'Open in new tab', icon: ExternalLink, onSelect: () => ws.openTab(openHref(r), { title: r.code }) },
    ...(r.orderId ? [{ id: 'order', label: `Open order ${r.orderCode ?? ''}`.trim(), icon: ExternalLink, onSelect: () => ws.openTab(`/office/orders/${r.orderId}`, { title: r.orderCode ?? 'Order' }) }] : []),
    ...(perms.canEdit && !r.assignedToMe ? [{ id: 'assign', label: 'Assign to me', icon: UserCheck, onSelect: () => void actions.assignToMe(r.id).then(() => !fixture && router.refresh()) }] : []),
    { id: 'copy', label: 'Copy number', icon: Copy, onSelect: () => void navigator.clipboard?.writeText(r.code) },
  ];

  const kpis = data?.kpis;
  const grid = (
    <OctopusDataGrid<TicketRow>
      label="Tickets"
      data-testid="support-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={result.kind === 'loading' || navigating}
      error={data && data.tickets === null ? 'We couldn’t load the tickets. Try again.' : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle={query.q || query.p ? 'No results for these filters' : 'No tickets'}
      emptyDescription="Nothing in this view."
      onClearFilters={() => { setSearch(''); go({ q: '', p: null, t: null }); }}
      headingLevel={2}
      onOpenRow={(r, o) => (o.newTab ? ws.openTab(openHref(r), { title: r.code }) : go({ t: r.id }))}
      rowActions={rowActions}
      search={search}
      onSearchChange={onSearch}
      searchPlaceholder="Search ticket no. or subject"
      manualFiltering
      filters={query.p ? [{ id: 'p', label: `Priority: ${human(query.p)}` }] : []}
      onRemoveFilter={() => go({ p: null, t: null })}
      filterFields={[{ id: 'p', label: 'Priority', options: PRIORITIES.map(human) }]}
      onApplyFilters={(c) => {
        const v = c.find((x) => x.field === 'p')?.value?.toLowerCase();
        go({ p: v && (PRIORITIES as readonly string[]).includes(v) ? v : null, t: null });
      }}
      pagination
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );

  return (
    <div data-testid="support-page" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">{head}</header>
      <KpiStrip
        data-testid="support-kpis"
        label="Support figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          { label: 'Open tickets', value: figure(kpis?.open), hint: kpis?.overdue === null ? 'Couldn’t load' : `${figure(kpis?.overdue)} past reply target` },
          { label: 'Assigned to me', value: figure(kpis?.mine), hint: 'in this view' },
          { label: 'Customer satisfaction', value: kpis?.csat?.avg ? `${kpis.csat.avg} / 5` : '—', hint: kpis?.csat === null ? 'Couldn’t load' : kpis?.csat?.n ? `from ${kpis.csat.n} ratings` : 'no ratings yet' },
          { label: 'Macros', value: figure(kpis?.macros), hint: 'quick replies' },
        ]}
      />
      <Tabs
        data-testid="support-tabs"
        label="Ticket filters"
        value={query.f}
        onChange={(f) => go({ f: f as TicketFilter, t: null })}
        items={TICKET_FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f], testId: `support-tab-${f}`, panel: () => (f === query.f ? <div className="pt-3">{grid}</div> : null) }))}
      />
    </div>
  );
}

function TicketRecord({ t, macros, perms, actions, nowMs, onDone }: { t: TicketDetail; macros: Macro[]; perms: SupportPerms; actions: SupportActions; nowMs: number; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [replyMsg, setReplyMsg] = useResult();
  const [ctlMsg, setCtlMsg] = useResult();
  const [escMsg, setEscMsg] = useResult();
  const [macroMsg, setMacroMsg] = useResult();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [thenStatus, setThenStatus] = useState('');
  const [status, setStatus] = useState(t.status);
  const [priority, setPriority] = useState(t.priority);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sla = slaLabel(t.slaDueAt, t.status, nowMs);

  const run = (p: Promise<Res>, set: (r: Res) => void, after?: () => void) =>
    start(async () => {
      const r = await p;
      set(r);
      if (r.ok) {
        after?.();
        onDone();
      }
    });
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) if (v !== '') f.set(k, v);
    return f;
  };
  const insertMacro = (text: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    setBody(body.slice(0, at) + text + body.slice(el?.selectionEnd ?? at));
    el?.focus();
  };
  const sendReply = () => {
    if (!body.trim()) return setReplyMsg({ ok: false, error: 'Write a reply or note first.' });
    run(actions.reply(t.id, fd({ body: body.trim(), ...(internal ? { internal: 'on' } : {}), status: thenStatus })), setReplyMsg, () => {
      setBody('');
      setInternal(false);
      setThenStatus('');
    });
  };

  const ctx = (label: string, children: React.ReactNode) => (
    <div className="min-w-0 rounded-ods-control bg-ods-canvas p-3">
      <div className="text-ods-small text-ods-slate">{label}</div>
      <div className="min-w-0 break-words font-semibold text-ods-text">{children}</div>
    </div>
  );

  return (
    <div data-testid="ticket-record" className="grid min-w-0 gap-4 ods-desktop:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-ods-small text-ods-slate">{t.code} · opened {formatDate(t.createdAt)} · {human(t.category)}</div>
              <h2 className="m-0 mt-1 text-ods-h2 font-bold text-ods-navy">{t.subject}</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StatusPill tone={priorityTone(t.priority)}>{human(t.priority)}</StatusPill>
              <StatusPill tone={ticketStatusTone(t.status)} data-testid="ticket-status">{human(t.status)}</StatusPill>
            </div>
          </div>
          <div className="mt-3 grid gap-2 ods-tablet:grid-cols-3">
            {ctx('Customer', t.customer ? `${t.customer.name}${t.customer.country ? ` · ${t.customer.country}` : ''} · KYC ${human(t.customer.kycStatus)}` : '—')}
            {ctx(
              'Order',
              t.order ? (
                <>
                  <a href={`/office/orders/${t.order.id}`} className="font-mono text-ods-info underline">{t.order.code}</a>
                  <span className="block text-ods-small font-normal text-ods-slate">{human(t.order.status)}{t.order.supplierCode !== undefined ? ` · supplier ${t.order.supplierCode ?? '—'}` : ''}</span>
                </>
              ) : (
                '—'
              ),
            )}
            {ctx(
              'Reply target',
              <>
                <span className={sla.bad ? 'text-ods-danger' : undefined}>{sla.text}</span>
                <span className="block text-ods-small font-normal text-ods-slate">Assigned {t.assignee ?? '—'}{t.assignedToMe ? ' (you)' : ''}</span>
              </>,
            )}
          </div>
          {t.order?.deliveredAt ? (
            <p className={cx('m-0 mt-3 rounded-ods-control px-3 py-2 text-ods-small font-medium', claimWindowOpen(t.order.claimHiddenUntil, nowMs) ? 'bg-ods-success-tint text-ods-success' : 'bg-ods-danger-tint text-ods-danger')}>
              Claim window (Terms): visible defects until {t.order.claimVisibleUntil ? formatDate(t.order.claimVisibleUntil) : '—'}, hidden defects until {t.order.claimHiddenUntil ? formatDate(t.order.claimHiddenUntil) : '—'}
            </p>
          ) : null}
        </Card>

        {t.warehouse ? (
          <Card title={`Warehouse request · ${t.warehouse.kindLabel}`} headingLevel={3} data-testid="sd-warehouse">
            {t.warehouse.order ? (
              <div className="text-ods-body">
                Order <a href={`/office/warehouse/orders/${t.warehouse.order.code}`} className="font-mono text-ods-info underline">{t.warehouse.order.code}</a>
                {t.warehouse.order.externalRef ? <span className="text-ods-slate"> (client ref {t.warehouse.order.externalRef})</span> : null} · {human(t.warehouse.order.status)} · {t.warehouse.order.warehouseCode}
                <div className="mt-2 flex flex-wrap gap-3 text-ods-small">
                  {t.warehouse.order.packed ? <a href={`/office/warehouse/evidence/${t.warehouse.order.code}`} className="font-semibold text-ods-info underline">Packing record{t.warehouse.order.photos ? ` (${t.warehouse.order.photos} photo${t.warehouse.order.photos === 1 ? '' : 's'})` : ''}</a> : null}
                  {t.warehouse.order.trackingToken ? <a href={`/t/${t.warehouse.order.trackingToken}`} target="_blank" rel="noopener" className="font-semibold text-ods-info underline">Tracking page<span className="sr-only"> (opens in a new tab)</span></a> : null}
                </div>
              </div>
            ) : t.warehouse.asn ? (
              <div className="text-ods-body">Stock notice <a href={`/office/warehouse/receive/${t.warehouse.asn.code}`} className="font-mono text-ods-info underline">{t.warehouse.asn.code}</a> · {human(t.warehouse.asn.status)} · {t.warehouse.asn.warehouseCode}</div>
            ) : t.warehouse.ret ? (
              <div className="text-ods-body">Return <a href={`/office/warehouse/returns?status=all&r=${t.warehouse.ret.code}`} className="font-mono text-ods-info underline">{t.warehouse.ret.code}</a> · {human(t.warehouse.ret.status)}{t.warehouse.ret.decision ? ` · ${human(t.warehouse.ret.decision)}` : ''}</div>
            ) : (
              <p className="m-0 text-ods-small text-ods-slate">No order, stock notice or return was chosen.</p>
            )}
          </Card>
        ) : null}

        {t.dropship ? (
          <Card title={`Dropship order ${t.dropship.externalName ?? t.dropship.orderNumber}`} headingLevel={3} data-testid="sd-dropship">
            <div className="text-ods-body"><span className="font-mono">{t.dropship.orderNumber}</span> · {human(t.dropship.merchantStatus)} · {human(t.dropship.paymentState)} · {t.dropship.total}</div>
            {t.dropship.cases.length ? (
              <ul className="m-0 mt-2 list-none p-0 text-ods-body">
                {t.dropship.cases.map((c) => (
                  <li key={c.code}><a href={`/office/dropship/problems?c=${c.code}`} className="font-mono text-ods-info underline">{c.code}</a> · {c.kind} · {c.status}</li>
                ))}
              </ul>
            ) : <p className="m-0 mt-2 text-ods-small text-ods-slate">No claim or return on this order.</p>}
            <p className="m-0 mt-2 text-ods-small text-ods-slate">Claims, returns and refunds are decided in Dropship › Order problems (refunds above US$1,000 need a second Finance approver).</p>
          </Card>
        ) : null}

        <Card title="Conversation" headingLevel={3} data-testid="ticket-thread">
          {t.messages === null ? (
            <p role="alert" className="m-0 text-ods-small text-ods-danger">We couldn’t load the conversation. Refresh the page to try again.</p>
          ) : !t.messages.length ? (
            <p className="m-0 text-ods-small text-ods-slate">No messages yet.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {t.messages.map((m) => (
                <li
                  key={m.id}
                  data-internal={m.internal ? 'true' : undefined}
                  className={cx('max-w-[85%] rounded-ods-control px-3 py-2', m.internal ? 'ms-auto border border-dashed border-ods-warning/60 bg-ods-warning-tint' : m.isStaff ? 'ms-auto bg-ods-blue-tint' : 'bg-ods-canvas')}
                >
                  <div className={cx('text-ods-small font-semibold', m.internal ? 'text-ods-warning' : m.isStaff ? 'text-ods-info' : 'text-ods-text')}>
                    {m.internal ? 'Internal note · ' : m.isStaff ? 'Support · ' : 'Customer · '}
                    {m.author} · {formatDate(m.createdAt)}
                  </div>
                  <p className="m-0 mt-1 whitespace-pre-line text-ods-body">{m.body}</p>
                  {m.attachments ? <div className="mt-1 text-ods-small text-ods-slate">{m.attachments} attachment{m.attachments === 1 ? '' : 's'}</div> : null}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-4 border-t border-ods-line pt-4" data-testid="ticket-reply">
            {perms.canEdit ? (
              <div className="flex flex-col gap-3">
                {macros.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-ods-small text-ods-slate">Quick replies:</span>
                    {macros.map((m) => (
                      <button key={m.id} type="button" title={m.body} onClick={() => insertMacro(m.body)} className="min-h-7 rounded-full border border-ods-line-strong px-2.5 text-ods-small text-ods-navy hover:border-ods-navy">
                        {m.title}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Field label={internal ? 'Internal note' : 'Reply to the customer'}>
                  <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={internal ? 'bg-ods-warning-tint' : undefined} placeholder="Write a reply to the customer, or an internal note" />
                </Field>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-ods-small text-ods-text">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4" /> Internal note (customer can’t see)
                  </label>
                  <label className="inline-flex items-center gap-2 text-ods-small text-ods-text">
                    Then set status
                    <select value={thenStatus} onChange={(e) => setThenStatus(e.target.value)} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body">
                      {REPLY_STATUSES.map((s) => <option key={s} value={s}>{s ? human(s) : 'Automatic'}</option>)}
                    </select>
                  </label>
                  <Button className="ms-auto" variant={internal ? 'secondary' : 'primary'} onClick={sendReply} loading={pending} loadingText="Sending…" data-testid="send-reply">
                    {internal ? 'Add internal note' : 'Send reply'}
                  </Button>
                </div>
                <ResultLine msg={replyMsg} />
              </div>
            ) : (
              <p className="m-0 text-ods-small text-ods-slate">View only. Replying needs the Support edit permission.</p>
            )}
            <p className="m-0 mt-1 text-ods-small text-ods-slate">Replies go to the customer’s portal and email. Internal notes are never shown to the customer.</p>
          </div>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {perms.canEdit ? (
          <Card title="Ticket" headingLevel={3} data-testid="ticket-controls">
            <div className="flex flex-col gap-3">
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {TICKET_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
                </Select>
              </Field>
              <Button size="sm" variant="secondary" disabled={status === t.status} disabledReason={status === t.status ? 'Choose a different status first.' : undefined} onClick={() => run(actions.setStatus(t.id, fd({ status })), setCtlMsg)}>
                Update status
              </Button>
              <Field label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{human(p)}</option>)}
                </Select>
              </Field>
              <Button size="sm" variant="secondary" disabled={priority === t.priority} disabledReason={priority === t.priority ? 'Choose a different priority first.' : undefined} onClick={() => run(actions.setPriority(t.id, fd({ priority })), setCtlMsg)}>
                Update priority
              </Button>
              <div className="text-ods-small text-ods-slate">Assigned to <b className="text-ods-text">{t.assignee ?? '—'}</b></div>
              {!t.assignedToMe ? (
                <Button size="sm" variant="secondary" iconStart={UserCheck} onClick={() => run(actions.assignToMe(t.id), setCtlMsg)}>
                  Assign to me
                </Button>
              ) : null}
              {t.status !== 'closed' ? (
                <Button size="sm" variant="secondary" onClick={() => run(actions.setStatus(t.id, fd({ status: 'closed' })), setCtlMsg)} data-testid="close-ticket">
                  Close ticket
                </Button>
              ) : null}
              <ResultLine msg={ctlMsg} />
            </div>
          </Card>
        ) : null}

        {perms.canEscalate ? (
          <EscalateCard t={t} onRun={(f) => run(actions.escalate(t.id, t.orgId, t.orderId, f), setEscMsg)} pending={pending} msg={escMsg} />
        ) : null}

        {perms.canEdit ? <MacrosCard macros={macros} onSave={(f) => run(actions.saveMacro(f), setMacroMsg)} pending={pending} msg={macroMsg} /> : null}
      </div>
    </div>
  );
}

function EscalateCard({ t, onRun, pending, msg }: { t: TicketDetail; onRun: (fd: FormData) => void; pending: boolean; msg: { ok: boolean; text: string } | null }) {
  const [kind, setKind] = useState('credit_note');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const submit = () => {
    if (!confirm) return setConfirm(true);
    const f = new FormData();
    f.set('kind', kind);
    f.set('amount', amount);
    f.set('reason', reason);
    setConfirm(false);
    onRun(f);
  };
  return (
    <Card title="Escalate to Finance" headingLevel={3} data-testid="ticket-escalate">
      <p className="m-0 mb-3 text-ods-small text-ods-slate">Refunds and credit notes go to Finance for approval (maker–checker: you cannot approve your own request; amounts over the limit need Admin).</p>
      <div className="flex flex-col gap-3">
        <Field label="Resolution">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="credit_note">Credit note</option>
            <option value="refund">Refund</option>
          </Select>
        </Field>
        <Field label={`Amount (${t.escCurrency})`} required>
          <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 2 cartons crushed in transit, 400 pcs affected" />
        </Field>
        <Button size="sm" onClick={submit} loading={pending} disabled={!amount || !reason.trim()} disabledReason={!amount || !reason.trim() ? 'Enter the amount and the reason.' : undefined}>
          {confirm ? 'Confirm: send to Finance' : 'Send to Finance'}
        </Button>
        {confirm ? <p className="m-0 text-ods-small text-ods-warning">Send this refund / credit note request to Finance? Select the button again to confirm.</p> : null}
        <ResultLine msg={msg} />
      </div>
    </Card>
  );
}

function MacrosCard({ macros, onSave, pending, msg }: { macros: Macro[]; onSave: (fd: FormData) => void; pending: boolean; msg: { ok: boolean; text: string } | null }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <Card title={`Macros (${macros.length})`} headingLevel={3}>
      <details>
        <summary className="cursor-pointer text-ods-small font-semibold text-ods-navy">Manage macros</summary>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-ods-small">
          {macros.map((m) => <li key={m.id}><b>{m.title}</b> — <span className="text-ods-slate">{m.body}</span></li>)}
        </ul>
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Text"><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} /></Field>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              const f = new FormData();
              f.set('title', title);
              f.set('body', body);
              onSave(f);
            }}
          >
            Save macro
          </Button>
          <ResultLine msg={msg} />
        </div>
      </details>
    </Card>
  );
}
