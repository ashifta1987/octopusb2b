'use client';

import type { ReactNode } from 'react';
import { Card, DataTable, EmptyState, KpiStrip, StatusPill, formatDate } from '@octopus/ui';
import { CurrencySwitchWizard, ImpactView, LocalDateTimeInput } from '@/components/admin/currency-switch';
import { StepUpNote } from '@/components/admin/step-up';
import { money, CURRENCY_PREFIX } from '@/lib/format';
import { setFxRate, approveSwitch, cancelSwitch } from '@/app/admin/currency/actions';
import { Note, OdsForm, RunAction, WebsiteHead, fieldCls, hintCls, labelCls } from '../../_website/ods-form';
import { SWITCH_LABEL, rateStatus, rateSummary, switchActions, switchTone, type FxRow, type SwitchRow } from '../../_website/website-core';
import type { CurrencyData } from '../_lib/data';

/** TODAY's actions (app/admin/currency/actions): set_fx_rate, approve_currency_switch, cancel_currency_switch (the wizard calls request / preview itself). */
export const CURRENCY_ACTIONS = { setFxRate, approveSwitch, cancelSwitch };
export type CurrencyActions = typeof CURRENCY_ACTIONS;

export type CurrencyScreenProps = {
  data: CurrencyData | null;
  perms: { userId: string; isAdmin: boolean; canApprove: boolean };
  actions?: CurrencyActions;
  /** today's switch wizard (client component with its own request / preview actions); fixtures pass a sample */
  wizard?: ReactNode;
  loading?: boolean;
};

/** ODS T9 · Website › Currency (platform currency, approved rate, maker–checker switch; every write = today's RPC). */
export function CurrencyScreen({ data, perms, actions = CURRENCY_ACTIONS, wizard, loading }: CurrencyScreenProps) {
  const { userId, isAdmin, canApprove } = perms;
  if (!data) {
    return (
      <div data-testid="currency-page" className="flex flex-col gap-4">
        <WebsiteHead title="Currency" subtitle="Platform currency, approved exchange rate and switches." />
        <KpiStrip loading={loading} items={[]} variant="strip" label="Currency figures" />
        <Card loading />
      </div>
    );
  }
  const { approved, upcoming, reference, rate, diff } = rateSummary(data.rates, data.nowIso);
  const open = data.requests.find((r) => r.status === 'pending_approval' || r.status === 'scheduled');
  const name = (id: string | null) => (id ? (data.names[id] ?? 'Staff member') : 'System');
  const rateCols = [
    { id: 'from', header: 'Effective from', primary: true, cell: (r: FxRow) => formatDate(r.effective_from) },
    { id: 'rate', header: 'Rate', numeric: true, cell: (r: FxRow) => <b className="font-mono">{Number(r.rate)}</b> },
    { id: 'source', header: 'Source', cell: (r: FxRow) => <StatusPill tone={r.source === 'manual' ? 'info' : 'neutral'}>{r.source === 'manual' ? 'Manual' : 'Reference'}</StatusPill> },
    { id: 'by', header: 'Set by', cell: (r: FxRow) => (r.source === 'reference' ? 'Daily job' : r.set_by ? name(r.set_by) : 'Seed'), hideOnPhone: true },
    { id: 'note', header: 'Note', cell: (r: FxRow) => r.note ?? '—', hideOnPhone: true },
    {
      id: 'status',
      header: 'Status',
      cell: (r: FxRow) => {
        const s = rateStatus(r, approved?.id ?? null, data.nowIso);
        return s === 'display' ? <span className="text-ods-small text-ods-slate">display only</span> : s === 'in-use' ? <StatusPill tone="success">Approved · in use</StatusPill> : s === 'scheduled' ? <StatusPill tone="info">Scheduled</StatusPill> : <StatusPill tone="neutral">Previous</StatusPill>;
      },
    },
  ];
  const reqCols = [
    { id: 'requested', header: 'Requested', primary: true, cell: (r: SwitchRow) => formatDate(r.created_at) },
    { id: 'switch', header: 'Switch', cell: (r: SwitchRow) => <b className="font-mono">{r.from_currency} → {r.to_currency}</b> },
    { id: 'rate', header: 'Rate', numeric: true, cell: (r: SwitchRow) => <span className="font-mono">{Number(r.rate)}</span> },
    { id: 'wallets', header: 'Wallets', cell: (r: SwitchRow) => (r.wallet_option === 'convert' ? 'Convert' : 'Keep'), hideOnPhone: true },
    { id: 'effective', header: 'Effective', cell: (r: SwitchRow) => (r.applied_at ? `Applied ${formatDate(r.applied_at)}` : formatDate(r.effective_at)) },
    { id: 'status', header: 'Status', cell: (r: SwitchRow) => <StatusPill tone={switchTone(r.status)}>{SWITCH_LABEL[r.status] ?? r.status}</StatusPill> },
    {
      id: 'people',
      header: 'People',
      hideOnPhone: true,
      cell: (r: SwitchRow) => {
        const a = switchActions(r, { userId, isAdmin, canApprove });
        return (
          <div className="text-ods-small">
            <div>
              Requested: {name(r.requested_by)}
              {a.mine ? ' (you)' : ''}
            </div>
            {r.approved_by ? <div>Approved: {name(r.approved_by)}</div> : null}
            {r.note ? <div className="max-w-[220px] text-ods-slate">“{r.note}”</div> : null}
            {r.impact ? (
              <details className="mt-1">
                <summary className="cursor-pointer font-semibold text-ods-info">Impact at request time</summary>
                <div className="mt-2 w-[min(80vw,720px)]">
                  <ImpactView impact={r.impact} to={r.to_currency} serviceNames={data.serviceNames} />
                </div>
              </details>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (r: SwitchRow) => {
        const a = switchActions(r, { userId, isAdmin, canApprove });
        return (
          <span className="flex flex-col items-start gap-2">
            {a.approve ? (
              <RunAction
                variant="primary"
                action={() => actions.approveSwitch(r.id)}
                confirm={{ title: `Approve switching to ${r.to_currency}?`, body: `${Number(r.rate)} CNY/USD · wallets: ${r.wallet_option}. ${r.effective_at <= data.nowIso ? 'It applies immediately.' : `It applies on ${formatDate(r.effective_at)}.`}`, confirmLabel: 'Approve switch' }}
              >
                Approve
              </RunAction>
            ) : null}
            {a.otherMustApprove ? <span className="max-w-[160px] text-ods-small text-ods-slate">Another Finance user must approve.</span> : null}
            {a.cancel ? (
              <RunAction action={(reason) => actions.cancelSwitch(r.id, reason)} prompt={{ title: 'Cancel this currency switch', label: 'Reason for cancelling', confirmLabel: 'Cancel switch' }}>
                Cancel
              </RunAction>
            ) : null}
          </span>
        );
      },
    },
  ];
  return (
    <div data-testid="currency-page" className="flex min-w-0 flex-col gap-4">
      <WebsiteHead
        title="Currency"
        subtitle="Choose the platform currency (US dollar or Chinese yuan), keep the approved exchange rate and switch with Finance approval. Existing quotes, invoices and orders always keep their own currency."
      />
      <StepUpNote />
      <section aria-labelledby="pc-h" className="flex flex-wrap items-center justify-between gap-4 rounded-ods-card bg-ods-navy px-ods-pad-card py-4 text-white" data-testid="platform-currency">
        <div className="min-w-0">
          <h2 id="pc-h" className="text-ods-h2 font-bold text-white">
            Platform currency
          </h2>
          <p className="m-0 mt-1 text-ods-body text-white/85">
            New prices, quotes, invoices, wallet charges and ad budgets use <b className="text-white">{data.current === 'CNY' ? 'Chinese yuan (CNY)' : 'US dollars (USD)'}</b>.
            {open ? (
              <>
                {' '}
                A switch to <b className="text-white">{open.to_currency}</b> is {open.status === 'scheduled' ? `scheduled for ${formatDate(open.effective_at)}` : 'waiting for Finance approval'}.
              </>
            ) : null}
          </p>
        </div>
        <span className="flex items-center gap-3">
          <span aria-hidden className="font-mono text-ods-h1 font-bold">
            {CURRENCY_PREFIX[data.current]}
          </span>
          <span className="rounded-ods-pill bg-white px-3 py-1 font-mono font-semibold text-ods-navy">{data.current}</span>
        </span>
      </section>
      {data.banner ? (
        <Note tone="success">
          Last switch: {data.banner.from} → {data.banner.to} at {data.banner.rate} CNY/USD on {formatDate(data.banner.applied_at)} · wallets {data.banner.wallet_option === 'convert' ? 'converted' : 'kept'}.
        </Note>
      ) : null}
      {!isAdmin ? <Note>Only an Admin can set rates or request a switch. {canApprove ? 'As Finance you approve or cancel requests below.' : ''}</Note> : null}
      <KpiStrip
        data-testid="currency-kpis"
        label="Currency figures"
        variant="strip"
        items={[
          { label: 'Active currency', value: data.current, hint: data.current === 'CNY' ? 'Chinese yuan · CN¥' : 'US dollar · US$' },
          { label: 'Approved rate (CNY per USD)', value: <span className="font-mono">{rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>, hint: approved ? `effective ${formatDate(approved.effective_from)}` : 'seed rate' },
          { label: 'Example', value: <span className="font-mono text-ods-h2">{money(19000, 'USD')} = {money(Math.round(19000 * rate), 'CNY')}</span>, hint: 'at the approved rate' },
          { label: 'Reference rate', value: reference ? <span className="font-mono">{Number(reference.rate)}</span> : '—', hint: reference && diff !== null ? `${formatDate(reference.effective_from)} · ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}% vs approved` : 'daily job not run yet' },
        ]}
      />
      <div className="grid gap-4 ods-desktop:grid-cols-[1fr_1.3fr]">
        <Card headingLevel={2} title="Set new approved rate" description="Billing uses only approved (manual) rates. Reference rates are for comparison only. New documents lock the rate in force when they are created." actions={!isAdmin ? <span className="text-ods-small text-ods-slate">Admin only</span> : undefined}>
          {isAdmin ? (
            <OdsForm
              action={actions.setFxRate}
              submitLabel="Set approved rate"
              resetOnSuccess
              confirm={{ title: 'Set this as the approved billing rate?', body: 'New quotes, invoices and storefront prices use it from the effective time.', confirmLabel: 'Set rate' }}
              label="Set approved rate"
              data-testid="fx-form"
            >
              <div className="grid gap-4 ods-tablet:grid-cols-2">
                <label className={labelCls}>
                  Rate (CNY per 1 USD)
                  <input name="rate" className={`${fieldCls} text-end font-mono`} inputMode="decimal" required placeholder={String(rate)} pattern="[0-9]+([.,][0-9]{1,6})?" />
                </label>
                <div className={labelCls}>
                  <label htmlFor="fx-from">Effective from</label>
                  <LocalDateTimeInput id="fx-from" name="effective_from" isoName="effective_from_iso" />
                  <span className={hintCls}>Leave empty for now, or schedule a future time.</span>
                </div>
                <label className={`${labelCls} ods-tablet:col-span-2`}>
                  Note
                  <input name="note" className={fieldCls} maxLength={200} placeholder="e.g. Monthly review, bank rate 1 Nov" />
                </label>
              </div>
            </OdsForm>
          ) : (
            <p className="m-0 text-ods-small text-ods-slate">
              Current approved rate: <b className="font-mono text-ods-navy">{rate}</b>
            </p>
          )}
          {upcoming ? (
            <p className="m-0 mt-3 text-ods-small">
              Scheduled: <b className="font-mono">{Number(upcoming.rate)}</b> from {formatDate(upcoming.effective_from)}
            </p>
          ) : null}
        </Card>
        <Card headingLevel={2} title="Rate history" description="Manual = approved · Reference = daily comparison">
          {data.rates.length ? (
            // a plain read-only table in a focusable scroll region (no links inside, so the region itself takes focus)
            <div tabIndex={0} role="region" aria-label="Rate history" className="overflow-x-auto rounded-ods-control" data-testid="rate-history">
              <table className="w-full border-separate border-spacing-0 text-ods-table">
                <thead>
                  <tr>
                    {rateCols.map((c) => (
                      <th key={c.id} scope="col" className={`whitespace-nowrap border-b border-ods-line-strong bg-ods-canvas px-2 py-1.5 text-ods-label font-semibold text-ods-slate ${c.numeric ? 'text-end' : 'text-start'}`}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rates.map((r) => (
                    <tr key={r.id}>
                      {rateCols.map((c) => (
                        <td key={c.id} className={`border-b border-ods-line px-2 py-1.5 align-top ${c.numeric ? 'text-end tabular-nums' : ''}`}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No rates yet" />
          )}
        </Card>
      </div>
      <Card headingLevel={2} title="Switch platform currency" actions={!isAdmin ? <span className="text-ods-small text-ods-slate">Admin only</span> : undefined}>
        <p className="m-0 mb-3 text-ods-small text-ods-slate">
          Maker–checker: an Admin requests the switch, a Finance user (not the requester) approves it. At the effective time the setting changes, wallets are converted if chosen, storefront prices are revalidated, a site banner is shown, customers are emailed and the <span className="font-mono">settings.currency_changed</span> webhook is sent.
        </p>
        {isAdmin ? (wizard ?? <CurrencySwitchWizard current={data.current} rate={rate} serviceNames={data.serviceNames} pending={!!open} />) : <Note>Only an Admin can request a currency switch.</Note>}
      </Card>
      <Card headingLevel={2} title="Switch requests" description="Draft → waiting for Finance → scheduled → applied / cancelled" empty={data.requests.length ? undefined : <EmptyState title="No currency switch requests yet" description="Requests appear here with their approval status." />}>
        <DataTable caption="Switch requests" captionHidden columns={reqCols} rows={data.requests} getRowId={(r) => r.id} data-testid="switch-requests" />
        <p className="m-0 mt-2 text-ods-small text-ods-slate">Every request, approval, cancellation and switch is written to the audit log.</p>
      </Card>
    </div>
  );
}
