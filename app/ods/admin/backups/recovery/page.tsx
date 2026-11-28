// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@octopus/ui';
import { RecoveryCompare, type CompareRow } from '@/components/admin/backups/recovery';
import { MONEY_TABLES, errorText } from '@/components/admin/backups/shared';
import { Panel, PanelSkeleton } from '@/app/ods/office/_components/dashboard';

/**
 * ODS T9 · /admin/backups/recovery — partial restore (compare records). Guard as today: requireStaff('backups','view');
 * same recovery_tables / recovery_compare RPCs. Restoring rows = TODAY's RecoveryCompare (restoreRecords:
 * backups:approve_restore, fresh 2FA, reason, audit); money tables are never overwritten (MONEY_TABLES).
 */
export const metadata: Metadata = { title: 'Partial restore' };

type SP = Promise<{ table?: string }>;

export default function OdsRecoveryPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Partial restore" testId="recovery-page" lines={6} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('backups', 'view', '/admin/backups/recovery');
  const sp = await searchParams;
  const sb = await createClient();
  const { data: tables, error } = await sb.rpc('recovery_tables');
  const list = (tables ?? []) as { table_name: string; row_count: number; restorable: boolean }[];
  const table = list.find((t) => t.table_name === sp.table) ?? null;
  let rows: CompareRow[] = [];
  let cmpError: string | null = null;
  if (table) {
    const { data, error: e } = await sb.rpc('recovery_compare', { p_table: table.table_name, p_ids: null, p_limit: 200 });
    if (e) cmpError = errorText(e.message);
    else rows = (data ?? []) as CompareRow[];
  }
  const money = table ? MONEY_TABLES.has(table.table_name) : false;

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="recovery-page">
      <div className="min-w-0 max-w-3xl">
        <p className="m-0 text-ods-small"><Link href="/admin/backups" className="font-semibold text-ods-blue">← Backup &amp; restore</Link></p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Partial restore — compare records</h1>
        <p className="m-0 mt-0.5 text-ods-small text-ods-slate">Tables loaded from a backup into the recovery area are compared with the live data. Pick the rows to bring back; every restore is written to the audit log. Money records are never overwritten — corrections go through finance adjustments.</p>
        <p className="m-0 mt-1 text-ods-small text-ods-slate">Restoring rows asks for your 2FA code again if it is older than 10 minutes.</p>
      </div>
      {error ? <p role="alert" className="m-0 rounded-ods-control bg-ods-danger-tint px-3 py-2 text-ods-small">{errorText(error.message)}</p> : null}
      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title="Recovery tables" testId="recovery-tables">
          {list.length === 0 ? (
            <p className="m-0 text-ods-small text-ods-slate">Nothing is loaded yet. Create a <b>Restore selected records</b> request on the <Link href="/admin/backups#backups" className="font-semibold text-ods-blue">Backups</Link> page; the restore workflow loads the chosen tables from the backup into the recovery area.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {list.map((t) => (
                <li key={t.table_name}>
                  <Link href={`/admin/backups/recovery?table=${t.table_name}`} aria-current={table?.table_name === t.table_name ? 'page' : undefined}
                    className={`flex justify-between gap-2 rounded-ods-control px-2 py-1.5 text-ods-body no-underline ${table?.table_name === t.table_name ? 'bg-ods-blue-tint font-semibold text-ods-navy' : 'text-ods-text hover:bg-ods-canvas'}`}>
                    <span className="font-ods">{t.table_name}</span>
                    <span className="text-ods-small text-ods-slate">{t.row_count}{!t.restorable ? ' · view only' : ''}{MONEY_TABLES.has(t.table_name) ? ' · money' : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="ods-legacy-section min-w-0">
          {!table ? (
            <div className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card"><EmptyState title="Pick a table" description="Choose a table on the left to compare the backup copy with the live records." headingLevel={2} /></div>
          ) : cmpError ? (
            <p role="alert" className="m-0 rounded-ods-control bg-ods-danger-tint px-3 py-2 text-ods-small">{cmpError}</p>
          ) : (
            <RecoveryCompare key={table.table_name} table={table.table_name} rows={rows}
              restorable={table.restorable && !money} canRestore={can(s, 'backups', 'approve_restore')}
              reasonDisabled={money ? 'Money records (ledger, payments, orders, invoices) are never overwritten. Use a finance adjustment instead.' : !table.restorable ? 'This table cannot be restored row by row (view only).' : null} />
          )}
        </div>
      </div>
    </div>
  );
}
