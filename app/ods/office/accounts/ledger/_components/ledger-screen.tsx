'use client';

import { ExternalLink } from 'lucide-react';
import { Drawer, IconButton, Money, formatDate, type GridColumn } from '@octopus/ui';
import { AccountsListScreen, DetailRow, type ListCtx, type ViewActions } from '../../_shared/accounts-list-screen';
import { JournalPanel, type JournalLoader } from '../../_shared/journal-panel';
import { journalViewAction } from '../../_shared/actions';
import { ACCOUNT_KINDS, LEDGER_SPEC, applyListConditions, commonChips, currencyPrefix, debitNormal, refHref, type LedgerRow, type ListQuery, type ListResult } from '../../_shared/accounts-core';

export const LEDGER_PATH = '/office/accounts/ledger';

export type LedgerScreenProps = {
  basePath?: string;
  extraParams?: Record<string, string>;
  query: ListQuery;
  result: ListResult<LedgerRow>;
  accounts: { id: string; label: string; kind: string }[];
  /** today's finance:export → /admin/finance/export?type=journals */
  exportMonth: string | null;
  openRow?: LedgerRow | null;
  viewActions?: ViewActions;
  loadJournal?: JournalLoader;
};

const fig = (minor: number, cur: string) => (minor ? <Money amount={minor / 100} currency={currencyPrefix(cur)} /> : <span className="text-ods-slate">—</span>);

/** ODS T9 · Accounts › Ledger (read-only): ledger lines, filters by account / customer / date, running balance per account. */
export function LedgerScreen({ basePath = LEDGER_PATH, extraParams, query, result, accounts, exportMonth, openRow, viewActions, loadJournal = journalViewAction }: LedgerScreenProps) {
  const account = accounts.find((a) => a.id === query.f.account);
  const columns = (ctx: ListCtx<LedgerRow>): GridColumn<LedgerRow>[] => [
    {
      id: 'journal',
      header: 'Journal',
      width: 130,
      sortable: false,
      accessor: (r) => r.journalNumber,
      cell: (r) => (
        <button type="button" onClick={() => ctx.open(r.id)} className="max-w-full truncate rounded-[4px] font-mono font-semibold text-ods-navy hover:underline">
          {r.journalNumber}
        </button>
      ),
    },
    { id: 'date', header: 'Date', width: 110, accessor: (r) => r.at, cell: (r) => formatDate(r.at, { short: true }) },
    { id: 'account', header: 'Account', width: 200, sortable: false, accessor: (r) => r.accountLabel },
    { id: 'customer', header: 'Customer', width: 150, sortable: false, accessor: (r) => r.customer ?? '' },
    { id: 'memo', header: 'Memo', width: 200, sortable: false, accessor: (r) => r.memo },
    { id: 'debit', header: 'Debit', numeric: true, width: 130, accessor: (r) => r.debitMinor, cell: (r) => fig(r.debitMinor, r.currency) },
    { id: 'credit', header: 'Credit', numeric: true, width: 130, accessor: (r) => r.creditMinor, cell: (r) => fig(r.creditMinor, r.currency) },
    ...(account
      ? [{ id: 'balance', header: `Balance (${debitNormal(account.kind) ? 'Dr' : 'Cr'})`, numeric: true, width: 140, sortable: false, accessor: (r: LedgerRow) => r.balanceMinor, cell: (r: LedgerRow) => (r.balanceMinor === null ? '—' : <Money amount={r.balanceMinor / 100} currency={currencyPrefix(r.currency)} />) }]
      : []),
  ];
  const set = (ctx: ListCtx<LedgerRow>, k: string, v: string) => {
    const f = { ...query.f };
    if (v) f[k] = v;
    else delete f[k];
    ctx.go({ f, page: 0, view: null });
  };
  return (
    <AccountsListScreen<LedgerRow>
      testId="ledger-page"
      title="Ledger"
      subtitle="Double-entry ledger lines, all services"
      pagePath={LEDGER_PATH}
      basePath={basePath}
      extraParams={extraParams}
      spec={LEDGER_SPEC}
      query={query}
      result={result}
      tabs={ACCOUNT_KINDS}
      tabsLabel="Account type"
      noun="the ledger"
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.journalNumber}
      rowActions={(r, ctx) => {
        const href = refHref(r.refType, r.refId);
        return href ? [{ id: 'ref', label: `Open ${r.refType?.replace(/_/g, ' ')}`, icon: ExternalLink, onSelect: () => ctx.openTab(href, r.journalNumber) }] : [];
      }}
      chips={commonChips(query, { account: () => `Account: ${account?.label ?? 'chosen account'}` })}
      filterFields={[{ id: 'customer', label: 'Customer' }, { id: 'date', label: 'Date (YYYY-MM-DD)' }]}
      applyConditions={(q, c) => applyListConditions(q, LEDGER_SPEC, c)}
      filterBar={(ctx) => (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Ledger filters">
          <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
            Account
            <select value={query.f.account ?? ''} onChange={(e) => set(ctx, 'account', e.target.value)} className="h-ods-control w-72 max-w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body font-normal text-ods-text">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
            From
            <input type="date" value={query.f.from ?? ''} onChange={(e) => set(ctx, 'from', e.target.value)} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body font-normal text-ods-text" />
          </label>
          <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
            To
            <input type="date" value={query.f.to ?? ''} onChange={(e) => set(ctx, 'to', e.target.value)} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body font-normal text-ods-text" />
          </label>
          {account ? <p className="m-0 pb-2 text-ods-small text-ods-slate">Balance = the account’s balance after each line, from its first entry.</p> : null}
        </div>
      )}
      exportItems={exportMonth ? [{ id: 'journals', label: `Journals ${exportMonth} (CSV)`, href: `/admin/finance/export?type=journals&month=${exportMonth}`, description: 'Today’s finance export' }] : undefined}
      openRow={openRow}
      builtinViews={[
        { id: 'builtin:all', label: 'All ledger lines', filters: {} },
        { id: 'builtin:revenue', label: 'Revenue lines', filters: { tab: 'revenue' } },
      ]}
      viewActions={viewActions}
      emptyTitle="No ledger lines"
      emptyDescription="Lines appear when money moves (payments, top-ups, refunds, releases)."
      searchPlaceholder="Search journal no. or memo"
      renderDrawer={(row, ctx) =>
        row ? (
          <Drawer
            open
            onClose={ctx.close}
            width={460}
            data-testid="record-drawer"
            title={row.journalNumber}
            description="Ledger journal"
            actions={<IconButton icon={ExternalLink} label="Open in a tab" tooltipSide="bottom" onClick={() => ctx.openTab(`${LEDGER_PATH}?open=j-${row.journalId}`, row.journalNumber)} />}
          >
            {!row.id.startsWith('j-') ? (
              <dl className="m-0 mb-3">
                <DetailRow k="This line">
                  {row.accountLabel} · {row.debitMinor ? `Dr ${(row.debitMinor / 100).toFixed(2)}` : `Cr ${(row.creditMinor / 100).toFixed(2)}`} {row.currency}
                </DetailRow>
                {row.customer ? <DetailRow k="Customer">{row.customer}</DetailRow> : null}
              </dl>
            ) : null}
            <JournalPanel by={{ journalId: row.journalId }} load={loadJournal} onOpen={ctx.openTab} />
          </Drawer>
        ) : null
      }
    />
  );
}
