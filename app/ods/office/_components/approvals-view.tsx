'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import {
  Button, Drawer, EmptyState, ErrorState, Icon, Money, OctopusDataGrid, StatusPill, Textarea, cx, formatDate, type GridColumn,
} from '@octopus/ui';
import type { ApprovalItem, ApprovalSource, OfficeResult } from '@/lib/office/workspace-core';
import { approvalCardState, approvalKindLabel, rejectReasonError, secondApproverText, SELF_APPROVAL_NOTE } from '../_lib/dashboard-core';
import { LocalTime } from './dashboard';

/**
 * ODS T9 · /office/approvals — the ONE approvals home (Part 7.7 money safety, 7.8 phone; boards ERP_States "Second
 * approver needed" + M_ERP_Approvals). Presentational: the page passes the T8-DATA queue (office_approval_queue over
 * staff_approvals + finance_approvals + escrow_hold_approvals + customer_credit_terms) and `decide` =
 * decideApprovalAction (→ staff_approval_decide / TODAY's decide_finance_approval, decide_escrow_hold_approval,
 * decide_customer_credit_terms — the database enforces two-person + step-up). Fixtures pass sample data + a sample decide.
 * Desktop: grid + review drawer. Phone (< 768): cards with Approve / Reject (44 px); Reject needs a reason.
 */

export type DecideInput = { source: ApprovalSource; id: string; approve: boolean; note?: string | null };
export type DecideFn = (input: DecideInput) => Promise<OfficeResult<{ status: 'approved' | 'rejected' }>>;
export type QueueState = 'ok' | 'unavailable' | 'error' | 'no-finance';
export type Readiness = { approvers: number; secondApproverNeeded: boolean; limitMinor: number };
type Notice = { tone: 'success' | 'warning' | 'danger'; text: string; href?: string };

const PREFIX: Record<string, string> = { USD: 'US$', CNY: 'CN¥' };
const prefixOf = (c: string) => PREFIX[c] ?? c;
const refText = (a: ApprovalItem) => a.code ?? (a.refType ? `${a.refType.replace(/_/g, ' ')} ${String(a.refId ?? '').slice(0, 8)}`.trim() : '—');
const amountOf = (a: ApprovalItem) => <Money amount={a.amountMinor / 100} currency={prefixOf(a.currency)} />;

export type ApprovalsViewProps = {
  items: ApprovalItem[];
  status: 'waiting' | 'decided';
  queueState: QueueState;
  readiness: Readiness | null;
  focusId?: string | null;
  /** Today's /admin/approvals (price approvals and limits) is a different queue: linked when the person can open it. */
  showPriceApprovals: boolean;
  /** Admins / staff:edit can open Users and roles from the readiness banner. */
  canManageStaff: boolean;
  decide: DecideFn;
  /** Real page: refresh the server data after a decision and follow the step-up redirect. Fixtures: false. */
  live?: boolean;
  statusLinks: { waiting: string; decided: string };
  initialNotice?: Notice | null;
};

export function ApprovalsView({ items, status, queueState, readiness, focusId, showPriceApprovals, canManageStaff, decide, live, statusLinks, initialNotice }: ApprovalsViewProps) {
  const router = useRouter();
  const [decided, setDecided] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(initialNotice ?? null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerReject, setDrawerReject] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const did = useRef(false);

  const view = items.map((a) => (decided[a.id] ? { ...a, status: decided[a.id]!, canDecide: false } : a));
  const waitingCount = view.filter((a) => a.status === 'waiting').length;
  const drawerItem = view.find((a) => a.id === drawerId) ?? null;

  // deep link ?item=<id> (staff notifications): desktop opens the review drawer, phones scroll to the card
  useEffect(() => {
    if (did.current || !focusId || !items.some((a) => a.id === focusId)) return;
    const desktop = window.matchMedia('(min-width: 48rem)').matches;
    const t = window.setTimeout(() => {
      did.current = true;
      if (desktop) setDrawerId(focusId);
      else {
        setHighlight(focusId);
        const el = document.getElementById(`approval-card-${focusId}`);
        const r = el?.getBoundingClientRect();
        // only scroll when the card is not already fully in view (above the 60 px BottomNav)
        if (el && r && (r.top < 56 || r.bottom > window.innerHeight - 64)) el.scrollIntoView({ block: 'nearest' });
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [focusId, items]);

  const run = async (a: ApprovalItem, approve: boolean, note?: string) => {
    setBusy(a.id);
    let r: OfficeResult<{ status: 'approved' | 'rejected' }>;
    try {
      r = await decide({ source: a.source, id: a.id, approve, note: note ?? null });
    } catch {
      r = { ok: false, error: 'Something went wrong. Try again.' };
    }
    setBusy(null);
    const label = `${approvalKindLabel(a)} ${refText(a)}`;
    if (r.ok) {
      setDecided((m) => ({ ...m, [a.id]: r.data.status }));
      setNotice({ tone: 'success', text: `${label} ${r.data.status === 'approved' ? 'approved' : 'rejected'}.` });
      setDrawerId(null);
      setDrawerReject(false);
      if (live) router.refresh();
      return true;
    }
    if (r.redirect) {
      setNotice({ tone: 'warning', text: r.error, href: r.redirect });
      if (live) router.push(r.redirect);
      return false;
    }
    setNotice({ tone: 'danger', text: r.error });
    return false;
  };

  const columns: GridColumn<ApprovalItem>[] = [
    {
      id: 'kind', header: 'Approval', accessor: (a) => `${approvalKindLabel(a)} ${refText(a)}`, width: 200,
      cell: (a) => (
        <span className="flex min-w-0 flex-col leading-tight" data-testid="approval-row" data-id={a.id}>
          <span className="truncate font-semibold">{approvalKindLabel(a)}</span>
          <span className="truncate font-ods text-ods-small text-ods-slate">{refText(a)}</span>
        </span>
      ),
    },
    { id: 'customer', header: 'Customer', accessor: (a) => a.orgName ?? '', width: 160, cell: (a) => a.orgName ?? <span className="text-ods-slate">—</span> },
    { id: 'amount', header: 'Amount', numeric: true, accessor: (a) => a.amountMinor, width: 120, cell: amountOf },
    { id: 'requested', header: 'Requested by', accessor: (a) => a.requestedByName ?? '', width: 140, cell: (a) => (
      <span className="flex flex-col leading-tight">
        <span className="truncate">{a.requestedByName ?? 'Staff'}</span>
        <span className="text-ods-small text-ods-slate">{a.requestedAt ? <>{formatDate(a.requestedAt, { short: true, now: new Date(a.requestedAt) })} · <LocalTime iso={a.requestedAt} /></> : '—'}</span>
      </span>
    ) },
    { id: 'status', header: 'Status', accessor: (a) => a.status, width: 124, cell: (a) => { const st = approvalCardState(a); return <StatusPill tone={st.tone}>{st.statusLabel}</StatusPill>; } },
    {
      id: 'decision', header: status === 'waiting' ? 'Decision' : 'Decided by', sortable: false, width: 230,
      cell: (a) => {
        const st = approvalCardState(a);
        if (a.status !== 'waiting') return <span className="text-ods-small">{a.decidedByName ?? '—'}{a.decidedAt ? <span className="text-ods-slate"> · {formatDate(a.decidedAt, { short: true, now: new Date(a.decidedAt) })}</span> : null}</span>;
        if (st.note === 'self') return <span className="text-ods-small leading-tight whitespace-normal text-ods-warning" data-testid="self-approval-note">You requested this — another Finance user decides</span>;
        if (st.note === 'not-approver') return <span className="text-ods-small text-ods-slate">A Finance approver decides</span>;
        return (
          <span className="flex gap-2">
            <Button size="sm" onClick={() => void run(a, true)} loading={busy === a.id} data-testid="approve-btn">Approve<span className="sr-only"> {refText(a)}</span></Button>
            <Button size="sm" variant="secondary" onClick={() => { setDrawerId(a.id); setDrawerReject(true); }} data-testid="reject-btn">Reject…<span className="sr-only"> {refText(a)}</span></Button>
          </span>
        );
      },
    },
    { id: 'reason', header: 'Reason', accessor: (a) => a.reason, width: 240, cell: (a) => <span className="line-clamp-2 text-ods-small whitespace-normal">{a.reason}</span> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="approvals-page">
      <div>
        <p className="m-0 hidden text-ods-small text-ods-slate ods-tablet:block">Back Office › Approvals</p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">
          Approvals{status === 'waiting' && queueState === 'ok' ? <span className="font-bold"> · {waitingCount}</span> : null}
        </h1>
        <p className="m-0 mt-0.5 hidden text-ods-small text-ods-slate ods-tablet:block">
          Money actions above the limit need a second person: whoever recorded an action can’t approve it.
        </p>
        <p className="m-0 mt-1 text-ods-small text-ods-slate ods-tablet:hidden">
          The Back Office is built for computers. On phones you can approve, look things up and read; editing opens a “use a computer” note.
        </p>
      </div>

      {readiness?.secondApproverNeeded ? (
        <section className="flex gap-3 rounded-ods-card border border-ods-warning/40 bg-ods-warning-tint p-ods-pad-card" data-testid="second-approver-banner" aria-labelledby="second-approver-h">
          <Icon icon={AlertTriangle} className="mt-0.5 shrink-0 text-ods-warning" />
          <div className="min-w-0">
            <h2 id="second-approver-h" className="m-0 text-ods-body font-bold text-ods-navy">Second approver needed</h2>
            <p className="m-0 mt-0.5 text-ods-small text-ods-text">{secondApproverText(readiness.approvers)}</p>
            {canManageStaff ? (
              <Button href="/admin/staff" variant="link" size="sm" className="mt-1">Open Users and roles</Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {notice ? (
        <div
          role={notice.tone === 'success' ? 'status' : 'alert'}
          data-testid="approval-notice"
          data-tone={notice.tone}
          className={cx(
            'flex items-start gap-2 rounded-ods-control px-3 py-2 text-ods-small',
            notice.tone === 'success' ? 'bg-ods-success-tint text-ods-text' : notice.tone === 'warning' ? 'bg-ods-warning-tint text-ods-text' : 'bg-ods-danger-tint text-ods-text',
          )}
        >
          <Icon icon={notice.tone === 'success' ? CheckCircle2 : notice.tone === 'warning' ? Info : XCircle} className={cx('mt-0.5 shrink-0', notice.tone === 'success' ? 'text-ods-success' : notice.tone === 'warning' ? 'text-ods-warning' : 'text-ods-danger')} />
          <span className="min-w-0 flex-1">
            {notice.text}
            {notice.href ? (
              <>
                {' '}
                <a href={notice.href} className="font-semibold text-ods-blue underline underline-offset-4" data-testid="step-up-link">Enter your 2-step code</a>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      <nav aria-label="Approval status" className="flex flex-wrap items-center gap-2">
        {(['waiting', 'decided'] as const).map((k) => (
          <a
            key={k}
            href={statusLinks[k]}
            aria-current={status === k ? 'page' : undefined}
            data-testid={`approvals-filter-${k}`}
            className={cx(
              'inline-flex min-h-8 items-center rounded-ods-pill border px-3 text-ods-small font-semibold no-underline',
              status === k ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy',
            )}
          >
            {k === 'waiting' ? 'Waiting' : 'Decided'}
          </a>
        ))}
        {showPriceApprovals ? (
          <a href="/admin/approvals" className="ms-auto text-ods-small font-semibold text-ods-blue underline underline-offset-4" data-testid="price-approvals-link">
            Price approvals and limits
          </a>
        ) : null}
      </nav>

      {queueState === 'unavailable' ? (
        <section className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card" data-testid="approvals-unavailable">
          <h2 className="m-0 text-ods-body font-bold text-ods-navy">The approvals inbox is not switched on yet</h2>
          <p className="m-0 mt-1 text-ods-small text-ods-slate">Until it is, decide approvals on today’s Finance screens:</p>
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-3 p-0 text-ods-small">
            <li><a className="text-ods-blue underline underline-offset-4" href="/admin/finance">Finance approvals</a></li>
            <li><a className="text-ods-blue underline underline-offset-4" href="/admin/finance/holds">Held payments</a></li>
            <li><a className="text-ods-blue underline underline-offset-4" href="/admin/finance/credit">Credit terms</a></li>
          </ul>
        </section>
      ) : queueState === 'no-finance' ? (
        <EmptyState title="Money approvals are for Finance" description={showPriceApprovals ? 'Your approvals are price approvals — open “Price approvals and limits”.' : 'Ask an admin if you need Finance access.'} headingLevel={2} />
      ) : queueState === 'error' ? (
        <ErrorState title="We couldn’t load approvals" onRetry={() => router.refresh()} headingLevel={2} />
      ) : (
        <>
          {/* desktop: grid */}
          <div className="hidden min-w-0 ods-tablet:block">
            <OctopusDataGrid<ApprovalItem>
              label={status === 'waiting' ? 'Waiting for a decision' : 'Decided'}
              data-testid="approvals-grid"
              rows={view}
              columns={columns}
              getRowId={(a) => a.id}
              rowNumber={(a) => refText(a)}
              emptyTitle={status === 'waiting' ? 'Nothing waiting for approval' : 'No decisions yet'}
              emptyDescription={status === 'waiting' ? 'Money actions above the limit appear here for a second person to decide.' : undefined}
              onOpenRow={(a) => { setDrawerId(a.id); setDrawerReject(false); }}
              onRefresh={live ? () => router.refresh() : undefined}
              pageSizes={[25, 50, 100]}
              defaultPageSize={25}
            />
          </div>
          {/* phone: cards (M_ERP_Approvals) */}
          <div className="flex flex-col gap-3 ods-tablet:hidden" data-testid="approval-cards">
            {view.length === 0 ? (
              <EmptyState title={status === 'waiting' ? 'Nothing waiting for approval' : 'No decisions yet'} headingLevel={2} />
            ) : (
              view.map((a) => <ApprovalCard key={a.id} a={a} busy={busy === a.id} highlight={highlight === a.id} onDecide={run} />)
            )}
          </div>
        </>
      )}

      <Drawer
        open={!!drawerItem}
        onClose={() => { setDrawerId(null); setDrawerReject(false); }}
        title={drawerItem ? `${approvalKindLabel(drawerItem)} · ${refText(drawerItem)}` : 'Approval'}
        description={drawerItem ? <StatusPill tone={approvalCardState(drawerItem).tone}>{approvalCardState(drawerItem).statusLabel}</StatusPill> : null}
        width={460}
        data-testid="approval-drawer"
      >
        {drawerItem ? <ReviewBody a={drawerItem} busy={busy === drawerItem.id} startReject={drawerReject} onDecide={run} /> : <span />}
      </Drawer>
    </div>
  );
}

/* ───────── review drawer body ───────── */

function ReviewBody({ a, busy, startReject, onDecide }: { a: ApprovalItem; busy: boolean; startReject: boolean; onDecide: (a: ApprovalItem, approve: boolean, note?: string) => Promise<boolean> }) {
  const st = approvalCardState(a);
  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-ods-body">
        <dt className="text-ods-slate">Amount</dt>
        <dd className="m-0 font-bold">{amountOf(a)}</dd>
        <dt className="text-ods-slate">Customer</dt>
        <dd className="m-0">{a.orgName ?? '—'}</dd>
        <dt className="text-ods-slate">Reference</dt>
        <dd className="m-0 font-ods">{refText(a)}</dd>
        <dt className="text-ods-slate">Requested by</dt>
        <dd className="m-0">{a.requestedByName ?? 'Staff'}{a.requestedAt ? <span className="text-ods-slate"> · {formatDate(a.requestedAt)} <LocalTime iso={a.requestedAt} /></span> : null}</dd>
        <dt className="text-ods-slate">Reason</dt>
        <dd className="m-0 break-words">{a.reason || '—'}</dd>
        {a.status !== 'waiting' ? (
          <>
            <dt className="text-ods-slate">Decided by</dt>
            <dd className="m-0">{a.decidedByName ?? '—'}{a.decidedAt ? <span className="text-ods-slate"> · {formatDate(a.decidedAt)}</span> : null}</dd>
          </>
        ) : null}
      </dl>
      <Decision a={a} st={st} busy={busy} startReject={startReject} onDecide={onDecide} size="md" />
    </div>
  );
}

/* ───────── phone card ───────── */

function ApprovalCard({ a, busy, highlight, onDecide }: { a: ApprovalItem; busy: boolean; highlight: boolean; onDecide: (a: ApprovalItem, approve: boolean, note?: string) => Promise<boolean> }) {
  const st = approvalCardState(a);
  return (
    <article
      id={`approval-card-${a.id}`}
      data-testid="approval-card"
      data-id={a.id}
      aria-labelledby={`approval-card-${a.id}-h`}
      className={cx('rounded-ods-card border bg-ods-surface p-3 shadow-ods-card', highlight ? 'border-ods-blue ring-2 ring-ods-blue/40' : 'border-ods-line')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-ods-small text-ods-slate">{approvalKindLabel(a)}</span>
        <StatusPill tone={st.tone}>{st.statusLabel}</StatusPill>
      </div>
      <h2 id={`approval-card-${a.id}-h`} className="m-0 mt-1 text-ods-body font-bold text-ods-navy break-words">{refText(a)}</h2>
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-ods-h2 font-bold text-ods-navy">{amountOf(a)}</span>
        <span className="text-ods-small text-ods-slate">
          {a.requestedByName ?? 'Staff'}{a.requestedAt ? <> · <LocalTime iso={a.requestedAt} /></> : null}
        </span>
      </div>
      {a.orgName ? <p className="m-0 mt-0.5 text-ods-small text-ods-slate">{a.orgName}</p> : null}
      <div className="mt-3">
        <Decision a={a} st={st} busy={busy} startReject={false} onDecide={onDecide} size="lg" />
      </div>
    </article>
  );
}

/* ───────── Approve / Reject (reason) — shared by card + drawer ───────── */

function Decision({
  a, st, busy, startReject, onDecide, size,
}: {
  a: ApprovalItem;
  st: ReturnType<typeof approvalCardState>;
  busy: boolean;
  startReject: boolean;
  onDecide: (a: ApprovalItem, approve: boolean, note?: string) => Promise<boolean>;
  size: 'md' | 'lg';
}) {
  const [rejecting, setRejecting] = useState(startReject);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const big = size === 'lg' ? 'min-h-11 h-11 flex-1' : 'flex-1';
  if (a.status !== 'waiting') {
    return a.status === 'rejected' ? <p className="m-0 text-ods-small text-ods-slate">Rejected{a.decidedByName ? ` by ${a.decidedByName}` : ''}.</p> : <p className="m-0 text-ods-small text-ods-slate">Approved{a.decidedByName ? ` by ${a.decidedByName}` : ''}.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {st.note === 'self' ? (
        <p className="m-0 rounded-ods-control bg-ods-warning-tint px-3 py-2 text-ods-small text-ods-text" data-testid="self-approval-note">
          {SELF_APPROVAL_NOTE}
        </p>
      ) : st.note === 'not-approver' ? (
        <p className="m-0 rounded-ods-control bg-ods-canvas px-3 py-2 text-ods-small text-ods-slate">You can view this. A Finance approver decides.</p>
      ) : null}
      {rejecting && st.canAct ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = rejectReasonError(reason);
            setErr(v);
            if (!v) await onDecide(a, false, reason.trim());
          }}
        >
          <label htmlFor={`reason-${a.id}-${size}`} className="text-ods-label font-semibold text-ods-navy">Why is it rejected? <span className="font-normal text-ods-slate">(required)</span></label>
          <Textarea
            id={`reason-${a.id}-${size}`}
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? `reason-${a.id}-${size}-err` : undefined}
            data-testid="reject-reason"
          />
          {err ? <p id={`reason-${a.id}-${size}-err`} className="m-0 text-ods-small text-ods-danger">{err}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" className={big} loading={busy} loadingText="Rejecting" data-testid="reject-confirm">Reject</Button>
            <Button variant="secondary" className={big} onClick={() => { setRejecting(false); setErr(null); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button className={big} disabled={!st.canAct} loading={busy} loadingText="Approving" onClick={() => void onDecide(a, true)} data-testid="approve-btn">
            Approve<span className="sr-only"> {refText(a)}</span>
          </Button>
          <Button
            variant="secondary"
            className={cx(big, st.canAct && 'border-ods-danger/50 text-ods-danger')}
            disabled={!st.canAct}
            onClick={() => setRejecting(true)}
            data-testid="reject-btn"
          >
            Reject<span className="sr-only"> {refText(a)}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
