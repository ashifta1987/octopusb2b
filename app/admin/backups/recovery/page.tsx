import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, EmptyState, Notice } from '@/components/ui';
import { RecoveryCompare, type CompareRow } from '@/components/admin/backups/recovery';
import { MONEY_TABLES, errorText } from '@/components/admin/backups/shared';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Partial restore' };

/** Partial restore: compare records in the recovery schema with live data side by side (SPEC §16.3). */
export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const s = await requireStaff('backups', 'view', '/admin/backups/recovery');
  const sp = await searchParams;
  const sb = await createClient();
  const { data: tables, error } = await sb.rpc('recovery_tables');
  const list = ((tables ?? []) as { table_name: string; row_count: number; restorable: boolean }[]);
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
    <>
      <PageHeader
        eyebrow={<Link href="/admin/backups" className="text-sm text-blue font-semibold">← Backup &amp; restore</Link>}
        title="Partial restore — compare records"
        subtitle="Tables loaded from a backup into the recovery area are compared with the live data. Pick the rows to bring back; every restore is written to the audit log. Money records are never overwritten — corrections go through finance adjustments."
      />
      {error && <div className="mb-4"><Notice tone="red">{errorText(error.message)}</Notice></div>}
      <div className="grid lg:grid-cols-[260px_1fr] gap-6 items-start">
        <Card title="Recovery tables">
          {list.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted">
              Nothing is loaded yet. Create a <b>Restore selected records</b> request on the <Link href="/admin/backups#backups" className="text-blue font-semibold">Backups</Link> page; the restore workflow loads the chosen tables from the backup into the recovery area.
            </div>
          ) : (
            <ul className="pb-3">
              {list.map((t) => (
                <li key={t.table_name}>
                  <Link href={`/admin/backups/recovery?table=${t.table_name}`} aria-current={table?.table_name === t.table_name ? 'page' : undefined}
                    className={cn('flex justify-between gap-2 px-6 py-2 text-sm hover:bg-surface', table?.table_name === t.table_name && 'bg-blue-soft font-semibold')}>
                    <span className="mono">{t.table_name}</span>
                    <span className="text-xs text-muted">{t.row_count}{!t.restorable && ' · view only'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0">
          {!table ? (
            <Card><EmptyState title="Pick a table" body="Choose a table on the left to compare the backup copy with the live records." /></Card>
          ) : cmpError ? (
            <Notice tone="red">{cmpError}</Notice>
          ) : (
            <RecoveryCompare key={table.table_name} table={table.table_name} rows={rows}
              restorable={table.restorable && !money} canRestore={can(s, 'backups', 'approve_restore')}
              reasonDisabled={money ? 'Money records (ledger, payments, orders, invoices) are never overwritten. Use a finance adjustment instead.' : !table.restorable ? 'This table cannot be restored row by row (view only).' : null} />
          )}
        </div>
      </div>
    </>
  );
}
