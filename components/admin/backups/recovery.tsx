'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/ui';
import { restoreRecords } from '@/app/admin/backups/actions';

export type CompareRow = { id: string; backup: Record<string, unknown>; current: Record<string, unknown> | null; status: 'missing' | 'changed' | 'same' };

const TONE = { missing: 'red', changed: 'amber', same: 'gray' } as const;
const LABEL = { missing: 'Missing in live', changed: 'Changed', same: 'Same' } as const;
const IGNORE = new Set(['updated_at']);

function show(v: unknown) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function title(r: CompareRow) {
  const b = r.backup;
  return String(b.name ?? b.title ?? b.code ?? b.slug ?? b.subject ?? b.email ?? r.id);
}

/** Side-by-side backup vs current with changed fields highlighted; restore selected rows via rpc restore_records. */
export function RecoveryCompare({ table, rows, restorable, canRestore, reasonDisabled }: {
  table: string; rows: CompareRow[]; restorable: boolean; canRestore: boolean; reasonDisabled: string | null;
}) {
  const [filter, setFilter] = useState<'diff' | 'all'>('diff');
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const shown = useMemo(() => (filter === 'diff' ? rows.filter((r) => r.status !== 'same') : rows), [rows, filter]);
  const counts = { missing: rows.filter((r) => r.status === 'missing').length, changed: rows.filter((r) => r.status === 'changed').length, same: rows.filter((r) => r.status === 'same').length };
  const enabled = restorable && canRestore;

  return (
    <section className="card">
      <div className="flex flex-wrap justify-between gap-3 px-5 pt-5 pb-3 items-start">
        <div>
          <h2 className="text-lg font-semibold"><span className="mono">{table}</span></h2>
          <p className="text-[13px] text-muted mt-0.5">{counts.missing} missing in live · {counts.changed} changed · {counts.same} same{rows.length >= 200 ? ' · first 200 rows' : ''}</p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Show rows">
          {(['diff', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={cn('rounded-full border px-4 py-2 text-sm font-semibold', filter === f ? 'bg-navy text-white border-navy' : 'bg-white border-line-2')}>
              {f === 'diff' ? 'Missing & changed' : 'All rows'}
            </button>
          ))}
        </div>
      </div>
      {reasonDisabled && <div className="px-5 pb-3"><p role="status" className="rounded-[10px] border border-warn/40 bg-[#FFF3D6] px-4 py-3 text-sm text-[#8A5A00]">{reasonDisabled}</p></div>}

      {shown.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-muted">{rows.length ? 'Every row matches the live data.' : 'This recovery table is empty.'}</p>
      ) : (
        <ul className="border-t border-line">
          {shown.map((r) => {
            const keys = [...new Set([...Object.keys(r.backup), ...Object.keys(r.current ?? {})])];
            const changed = new Set(keys.filter((k) => !IGNORE.has(k) && r.current && show(r.backup[k]) !== show(r.current[k])));
            const isOpen = open === r.id;
            return (
              <li key={r.id} className="border-b border-line">
                <div className="flex items-center gap-3 px-5 py-3">
                  <input type="checkbox" aria-label={`Select ${title(r)}`} className="w-[18px] h-[18px] accent-[#2A6FD6]" disabled={!enabled || r.status === 'same'}
                    checked={picked.includes(r.id)} onChange={(e) => setPicked((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id)))} />
                  <button type="button" className="flex-1 min-w-0 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                    <span className="font-semibold truncate block">{title(r)}</span>
                    <span className="mono text-xs text-muted">{r.id}{r.status === 'changed' ? ` · ${changed.size} field${changed.size === 1 ? '' : 's'} differ` : ''}</span>
                  </button>
                  <StatusBadge status={r.status} tone={TONE[r.status]} label={LABEL[r.status]} />
                </div>
                {isOpen && (
                  <div className="px-5 pb-4 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-xs">
                      <thead><tr><th className="th w-[180px]">Field</th><th className="th">Backup</th><th className="th">Current (live)</th></tr></thead>
                      <tbody>
                        {keys.map((k) => (
                          <tr key={k} className={cn(changed.has(k) && 'bg-[#FFF8E6]')}>
                            <td className="td mono font-semibold align-top">{k}{changed.has(k) && <span className="sr-only"> (changed)</span>}{changed.has(k) && <span aria-hidden className="text-warn"> ●</span>}</td>
                            <td className="td mono align-top break-all whitespace-pre-wrap">{show(r.backup[k])}</td>
                            <td className="td mono align-top break-all whitespace-pre-wrap">{r.current ? show(r.current[k]) : <i className="text-bad not-italic">missing</i>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-5 py-5">
        <label htmlFor="rr-reason" className="label">Reason (shown in the audit log)</label>
        <input id="rr-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!enabled} placeholder="e.g. Product deleted by mistake on Oct 31" maxLength={500} />
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <button type="button" className="btn btn-primary" disabled={!enabled || !picked.length || pending} onClick={() => {
            if (!reason.trim()) { setMsg({ ok: false, text: 'Please write a reason (shown in the audit log).' }); return; }
            if (!window.confirm(`Restore ${picked.length} row${picked.length === 1 ? '' : 's'} into ${table}? Live values for these rows are replaced by the backup copy.`)) return;
            setMsg(null);
            start(async () => {
              const r = await restoreRecords(table, picked, reason);
              if (!r.ok) {
                if (r.code === 'MFA_REQUIRED') { router.push(`/mfa?next=${encodeURIComponent(`/admin/backups/recovery?table=${table}`)}`); return; }
                setMsg({ ok: false, text: r.error }); return;
              }
              setMsg({ ok: true, text: `${r.count} row${r.count === 1 ? '' : 's'} restored` });
              setPicked([]); setReason('');
              router.refresh();
            });
          }}>{pending ? 'Restoring…' : `Restore selected${picked.length ? ` (${picked.length})` : ''}`}</button>
          {!canRestore && <span className="text-sm text-muted">You need the “approve restore” permission.</span>}
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={cn('text-sm mt-2', msg.ok ? 'text-ok font-semibold' : 'text-bad')}>{msg.ok ? '✓ ' : ''}{msg.text}</p>}
      </div>
    </section>
  );
}
