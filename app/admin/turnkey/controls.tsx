'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LEAD_STATUSES, REGIONS } from '@/lib/turnkey/format';
import { goStepUp } from '@/components/admin/client';
import { updateLead, setStaffRegion, setProjectStatus } from './actions';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
function useRun() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<R>) => start(async () => { setErr(null); const r = await fn(); if (goStepUp(r)) return; if (r.ok) router.refresh(); else setErr(r.error); });
  return { pending, err, run };
}

export function LeadControls({ leadId, status, assignedTo, agents }: { leadId: string; status: string; assignedTo: string | null; agents: { id: string; name: string; region: string | null }[] }) {
  const { pending, err, run } = useRun();
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <label className="text-[12px] text-muted">Status
        <select className="input min-h-9 py-0 text-[13px] mt-0.5" defaultValue={status} disabled={pending} aria-label="Lead status"
          onChange={(e) => run(() => updateLead(leadId, { status: e.target.value }))}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-muted">Assignee
        <select className="input min-h-9 py-0 text-[13px] mt-0.5" defaultValue={assignedTo ?? ''} disabled={pending} aria-label="Assign to"
          onChange={(e) => run(() => updateLead(leadId, { assigned_to: e.target.value || null }))}>
          <option value="">Triage pool</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.region ? ` · ${a.region}` : ''}</option>)}
        </select>
      </label>
      {err && <p role="alert" className="col-span-2 text-[12px] text-bad">{err}</p>}
    </div>
  );
}

export function RegionSelect({ userId, region }: { userId: string; region: string | null }) {
  const { pending, err, run } = useRun();
  return (
    <span className="inline-flex flex-col">
      <select className="input min-h-9 py-0 text-[13px] w-auto" defaultValue={region ?? ''} disabled={pending} aria-label="Lead region"
        onChange={(e) => run(() => setStaffRegion(userId, e.target.value))}>
        <option value="">No region</option>
        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {err && <span role="alert" className="text-[12px] text-bad">{err}</span>}
    </span>
  );
}

export function StatusSwitch({ projectId, status }: { projectId: string; status: string }) {
  const { pending, err, run } = useRun();
  return (
    <span className="inline-flex flex-col">
      <select className="input min-h-9 py-0 text-[13px] w-auto" defaultValue={status} disabled={pending} aria-label="Project status"
        onChange={(e) => { const v = e.target.value; if (!window.confirm(`Set this project to "${v}"?`)) { e.target.value = status; return; } run(() => setProjectStatus(projectId, v)); }}>
        <option value="register-interest">register-interest</option><option value="live">live</option><option value="archived">archived</option>
      </select>
      {err && <span role="alert" className="text-[12px] text-bad max-w-[220px]">{err}</span>}
    </span>
  );
}

