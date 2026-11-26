'use client';

import Link from 'next/link';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsTableCard } from '@/components/dropship-ui';
import { fmtDate, usd } from '@/lib/format';
import {
  KIND_LABEL, PLAN_LABEL, docStatus, fmtQty, monthLabel, refText, staffRefHref, unbilledText, unitWord,
  type ChargeRef, type InvoiceBoard, type InvoicePreview, type IssuedLine, type PreviewLine,
} from '@/lib/warehouse-w6';
import { issueInvoiceAction } from '../w6-actions';
import { MsgLine, useRun } from '../wh-run';

function Refs({ refs, testId }: { refs: ChargeRef[]; testId: string }) {
  if (!refs.length) return null;
  return (
    <details className="mt-1" data-testid={testId}>
      <summary className="cursor-pointer text-[13px] font-semibold text-[#2A6FD1] min-h-[44px] inline-flex items-center">
        What is behind this line ({refs.length})
      </summary>
      <ul className="m-0 mt-1 pl-4 flex flex-col gap-1 text-[13px]">
        {refs.map((r, i) => {
          const t = refText(r);
          const href = staffRefHref(r);
          return (
            <li key={`${r.type}-${r.id}-${i}`}>
              {href ? <Link href={href} className="underline">{t.label}</Link> : <span>{t.label}</span>}
              <span className="text-[#5B6478]"> · {t.detail}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function LineRow({ l, i }: { l: PreviewLine | IssuedLine; i: number }) {
  const status = 'status' in l ? l.status : 'billable';
  const not = unbilledText(status);
  return (
    <tr data-testid={`wh-inv-line-${i}`} data-kind={l.kind} data-status={status}>
      <td>
        <div className="font-semibold">{KIND_LABEL[l.kind]}</div>
        <div className="text-[13px] text-[#5B6478]">{l.description}</div>
        {l.rate_version != null && <div className="text-[12px] text-[#5B6478]">Rates version {l.rate_version}</div>}
        <Refs refs={l.refs} testId={`wh-inv-refs-${i}`} />
      </td>
      <td className="whitespace-nowrap">{l.qty == null ? '—' : `${fmtQty(l.qty)} ${unitWord(l.unit_label, Number(l.qty))}`}</td>
      <td className="whitespace-nowrap">{l.unit_cents == null ? '—' : usd(Number(l.unit_cents))}</td>
      <td className="whitespace-nowrap font-semibold" data-testid={`wh-inv-amount-${i}`}>
        {not ? <DsBadge tone={status === 'not_set' ? 'warn' : 'neutral'}>{not}</DsBadge> : usd(Number(l.amount_cents))}
      </td>
    </tr>
  );
}

function Preview({ p, month, canIssue }: { p: InvoicePreview; month: string; canIssue: boolean }) {
  const issue = useRun();
  const inv = p.invoice;
  const why = !canIssue ? 'Only Finance can issue invoices.' : !p.month_closed ? 'The month is not over yet (China time).'
    : p.total_cents <= 0 ? 'Nothing to bill this month.' : null;
  const min = p.minimum;
  return (
    <DsCard testId="wh-inv-preview" icon="file" title={`${p.client ?? 'Client'} · ${monthLabel(month)}`}
      subtitle={`${PLAN_LABEL[p.plan] ?? p.plan} plan · ${p.client_status}. Each charge uses the rate version in effect when it happened.`}
      actions={inv ? (
        <span className="flex items-center gap-2" data-testid="wh-inv-issued">
          <span className="mono font-semibold">{inv.number}</span>
          <DsBadge tone={docStatus(inv.status).tone}>{docStatus(inv.status).label}</DsBadge>
        </span>
      ) : (
        <DsButton testId="wh-inv-issue" icon="send" loading={issue.pending} disabled={Boolean(why) || issue.pending} disabledReason={why ?? undefined}
          onClick={() => {
            if (!window.confirm(`Issue the ${monthLabel(month)} invoice of ${usd(p.total_cents)} to ${p.client ?? 'this client'}?`)) return;
            issue.run(() => issueInvoiceAction({ orgId: p.org_id, month }));
          }}>
          Issue invoice
        </DsButton>
      )}>
      <div className="flex flex-col gap-3">
        <MsgLine msg={issue.msg} testId="wh-inv-msg" />
        {inv && (
          <p className="m-0 text-[13px] text-[#5B6478]">
            Issued {fmtDate(inv.issued_at)}{inv.issued_by ? ` by ${inv.issued_by}` : ''} ·
            paid {usd(inv.paid_cents)} of {usd(inv.amount_cents)}{inv.tax_invoice ? ` · tax invoice ${inv.tax_invoice.number}` : ''}. The issued lines are below; the live preview follows.
          </p>
        )}
        {inv && (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Issued invoice lines">
            <table className="ds-tbl" style={{ minWidth: 640 }} data-testid="wh-inv-issued-lines">
              <thead><tr><th scope="col">Issued line</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead>
              <tbody>{inv.lines.map((l, i) => <LineRow key={l.id} l={l} i={1000 + i} />)}</tbody>
            </table>
          </div>
        )}
        {p.lines.length === 0 ? (
          <DsEmptyState icon="file" title="No charges this month" description="Nothing was received, stored, shipped, packed with charged materials or returned for this client in this month." />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Charges">
            <table className="ds-tbl" style={{ minWidth: 640 }}>
              <thead><tr><th scope="col">Charge</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead>
              <tbody>{p.lines.map((l, i) => <LineRow key={i} l={l} i={i} />)}</tbody>
            </table>
          </div>
        )}
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[14px] max-w-[420px] ml-auto">
          <dt>Charges</dt><dd className="m-0 text-right">{usd(p.subtotal_cents)}</dd>
          <dt>Monthly minimum</dt>
          <dd className="m-0 text-right" data-testid="wh-inv-minimum">
            {min.status === 'not_set' ? 'Not set' : `${usd(min.cents)}${min.applies ? '' : ' (does not apply)'}`}
          </dd>
          {p.topup_cents > 0 && <><dt>Top-up to the minimum</dt><dd className="m-0 text-right">{usd(p.topup_cents)}</dd></>}
          <dt className="font-bold">Total</dt><dd className="m-0 text-right font-bold" data-testid="wh-inv-total">{usd(p.total_cents)}</dd>
        </dl>
        {p.unbilled_count > 0 && (
          <p className="m-0 text-[13px] text-[#8A5300]" data-testid="wh-inv-unbilled">
            {p.unbilled_count} line{p.unbilled_count === 1 ? ' is' : 's are'} not charged because the fee is not set or the quantity is not measured. Set the fee in Rates (two people approve it) — it applies from then on, not to this month.
          </p>
        )}
      </div>
    </DsCard>
  );
}

export function InvoicesClient({ board, preview, previewError, month, canIssue }: {
  board: InvoiceBoard; preview: InvoicePreview | null; previewError: string | null; month: string; canIssue: boolean;
}) {
  const ym = month.slice(0, 7);
  return (
    <>
      {!board.month_closed && (
        <p role="status" className="m-0 ds-card text-[14px]" data-testid="wh-inv-open-month">
          {monthLabel(month)} is not over yet: the numbers below are a running preview. Invoices are issued from the first day of the next month (China time).
        </p>
      )}
      <DsTableCard testId="wh-inv-board" title="Clients" icon="users" minWidth={760}
        subtitle="Totals are previews until an invoice is issued. Open a client to see every line and what is behind it."
        headers={['Client', 'Plan', 'Charges', 'Minimum top-up', 'Total', 'Not charged', 'Invoice', '']}>
        {board.clients.length === 0 ? (
          <tr><td colSpan={8}><DsEmptyState icon="users" title="No 3PL clients yet" description="Approved clients appear here (Clients and applications)." /></td></tr>
        ) : board.clients.map((c) => (
          <tr key={c.org_id} data-testid={`wh-inv-row-${c.org_id}`} className={preview?.org_id === c.org_id ? 'bg-[#F2F7FE]' : undefined}>
            <td className="font-semibold">{c.name}</td>
            <td>{PLAN_LABEL[c.plan] ?? c.plan}{c.status !== 'active' ? ` · ${c.status}` : ''}</td>
            <td>{usd(c.subtotal_cents)}</td>
            <td>{c.topup_cents > 0 ? usd(c.topup_cents) : '—'}</td>
            <td className="font-semibold">{usd(c.total_cents)}</td>
            <td>{c.unbilled_count > 0 ? <DsBadge tone="warn">{c.unbilled_count} line{c.unbilled_count === 1 ? '' : 's'}</DsBadge> : '—'}</td>
            <td>{c.invoice ? <span className="whitespace-nowrap"><span className="mono">{c.invoice.number}</span> · {docStatus(c.invoice.status).label}</span> : 'Not issued'}</td>
            <td><Link href={`/office/warehouse/invoices?month=${ym}&org=${c.org_id}`} className="ds-btn ds-btn-secondary" data-testid={`wh-inv-open-${c.org_id}`}>
              Open<span className="sr-only"> {c.name}</span></Link></td>
          </tr>
        ))}
      </DsTableCard>
      {previewError && <p role="alert" className="m-0 ds-card text-[14px] text-[#B42318]">The preview could not be loaded. Reload the page.</p>}
      {preview && <Preview key={`${preview.org_id}-${month}`} p={preview} month={month} canIssue={canIssue && board.can_issue} />}
    </>
  );
}
