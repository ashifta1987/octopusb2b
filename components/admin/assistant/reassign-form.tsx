'use client';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { goStepUp } from '@/components/admin/client';
import { reassignAccountManager } from '@/app/admin/customers/actions';

export type StaffCandidate = { id: string; name: string; team: string | null; customers: number; outOfOffice: boolean; roles: string[] };

/** "Reassign" button + dialog: staff picker (load vs cap) and a required reason (SPEC §20.3). */
export function ReassignButton({ orgId, orgName, currentStaffId, candidates, cap, path, className = 'btn btn-ghost btn-sm', label = 'Reassign' }: {
  orgId: string; orgName: string; currentStaffId: string | null; candidates: StaffCandidate[]; cap: number; path: string; className?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = `ra${useId().replace(/:/g, '')}`;
  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(null); setStaff(''); setReason(''); setOpen(true); }}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-navy/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
          <div className="card w-full max-w-md p-6 text-left">
            <h2 id={`${id}-t`} className="text-xl font-semibold">Reassign account manager</h2>
            <p className="text-sm text-muted mt-1">{orgName}</p>
            <label htmlFor={`${id}-s`} className="label mt-4">New account manager *</label>
            <select id={`${id}-s`} className="input" value={staff} onChange={(e) => setStaff(e.target.value)}>
              <option value="">Choose staff…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === currentStaffId}>
                  {c.name}{c.team ? ` · ${c.team}` : ''} · {c.customers}/{cap}{c.customers >= cap ? ' (at cap)' : ''}{c.outOfOffice ? ' · out of office' : ''}{c.id === currentStaffId ? ' · current' : ''}
                </option>
              ))}
            </select>
            {candidates.length === 0 && <p className="text-xs text-bad mt-1">No staff with the Assistant permission or Sourcing agent role.</p>}
            <label htmlFor={`${id}-r`} className="label mt-4">Reason *</label>
            <textarea id={`${id}-r`} className="input min-h-20 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer prefers a German-speaking manager" />
            <p className="text-xs text-muted mt-1">Logged in the audit trail. The customer sees the new name on their account team card.</p>
            {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={pending || !staff || !reason.trim()}
                onClick={() => start(async () => {
                  const r = await reassignAccountManager(orgId, staff, reason, path);
                  if (goStepUp(r)) return;
                  if (!r.ok) { setErr(r.error); return; }
                  setOpen(false); router.refresh();
                })}>
                {pending ? 'Saving…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
