'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput } from '@/components/dropship-ui';
import { saveLocationAction, setDefaultAction, setLocationStatusAction } from '../actions';

export type Location = {
  code: string; name: string; country: string; province: string | null; city: string; address: string | null; email: string | null;
  phone: string | null; hours: string | null; timezone: string; status: string; is_default: boolean; updated_at: string; units?: number;
};
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { active: 'ok', paused: 'warn', closed: 'bad', legacy: 'neutral' };
const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', closed: 'Closed', legacy: 'Legacy' };

function LocationForm({ loc, onDone, run, pending }: {
  loc: Location | null; onDone: () => void; pending: boolean; run: (p: Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => void;
}) {
  return (
    <form className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="wh-location-form"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(saveLocationAction(fd), onDone); }}>
      <DsInput label="Code" name="code" required defaultValue={loc?.code ?? ''} readOnly={Boolean(loc)} hint="e.g. GZ-01" maxLength={7} />
      <DsInput label="Name" name="name" required defaultValue={loc?.name ?? ''} />
      <DsInput label="City" name="city" required defaultValue={loc?.city ?? ''} />
      <DsInput label="Province" name="province" defaultValue={loc?.province ?? ''} />
      <DsInput label="Street address" name="address" defaultValue={loc?.address ?? ''} containerClassName="md:col-span-2" hint="Shown to clients when they send stock" />
      <DsInput label="Email" name="email" type="email" defaultValue={loc?.email ?? ''} />
      <DsInput label="Phone" name="phone" defaultValue={loc?.phone ?? ''} />
      <DsInput label="Hours" name="hours" defaultValue={loc?.hours ?? ''} hint="e.g. Mon–Sat 08:00–18:00" />
      <DsInput label="Time zone" name="timezone" defaultValue={loc?.timezone ?? 'Asia/Shanghai'} />
      <div className="md:col-span-3 flex gap-2">
        <DsButton type="submit" disabled={pending} testId="wh-location-save">{loc ? 'Save changes' : 'Add location'}</DsButton>
        <DsButton variant="secondary" onClick={onDone}>Cancel</DsButton>
      </div>
    </form>
  );
}

export function LocationsClient({ rows }: { rows: Location[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const [statusFor, setStatusFor] = useState<{ code: string; status: string } | null>(null);
  const [reason, setReason] = useState('');
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.();
  });
  return (
    <div className="flex flex-col gap-5">
      <div><DsButton icon="plus" onClick={() => setEditing('new')} testId="wh-location-new">Add location</DsButton></div>
      {editing && (
        <DsCard title={editing === 'new' ? 'New location' : `Edit ${editing.name}`} icon="store">
          <LocationForm key={editing === 'new' ? 'new' : editing.code} loc={editing === 'new' ? null : editing} onDone={() => setEditing(null)} run={run} pending={pending} />
        </DsCard>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-locations-msg" className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rows.map((l) => (
          <DsCard key={l.code} testId={`wh-location-${l.code}`} icon="store"
            title={<>{l.name} <span className="font-mono text-[13px] text-muted">{l.code}</span></>}
            actions={<><DsBadge tone={TONE[l.status] ?? 'neutral'}>{STATUS[l.status] ?? l.status}</DsBadge>{l.is_default && <DsBadge tone="info">Default</DsBadge>}</>}>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 m-0 text-[13.5px]">
              <dt className="text-muted">City</dt><dd className="m-0">{l.city}{l.province ? `, ${l.province}` : ''}</dd>
              <dt className="text-muted">Address</dt><dd className="m-0">{l.address ?? 'Not set yet'}</dd>
              <dt className="text-muted">Contact</dt><dd className="m-0">{[l.email, l.phone].filter(Boolean).join(' · ') || '—'}</dd>
              <dt className="text-muted">Hours</dt><dd className="m-0">{l.hours ?? 'Not set yet'}</dd>
              <dt className="text-muted">Stock</dt><dd className="m-0">{(l.units ?? 0).toLocaleString('en-US')} units</dd>
            </dl>
            {l.status !== 'closed' && (
              <div className="mt-3 flex flex-wrap gap-2 items-start">
                {l.status !== 'legacy' && <DsButton variant="secondary" onClick={() => setEditing(l)}>Edit</DsButton>}
                {l.status === 'active' && !l.is_default && <DsButton variant="secondary" disabled={pending} onClick={() => run(setDefaultAction(l.code))}>Make default</DsButton>}
                {l.status === 'paused' && <DsButton variant="secondary" disabled={pending} onClick={() => run(setLocationStatusAction(l.code, 'active', ''))}>Re-open</DsButton>}
                {!l.is_default && l.status !== 'legacy' && (statusFor?.code === l.code ? (
                  <form className="flex flex-wrap gap-2 items-end w-full" onSubmit={(e) => { e.preventDefault(); run(setLocationStatusAction(l.code, statusFor.status, reason), () => setStatusFor(null)); }}>
                    <DsInput label={`Why ${statusFor.status === 'paused' ? 'pause' : 'close'} ${l.name}?`} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                    <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>{statusFor.status === 'paused' ? 'Pause' : 'Close'}</DsButton>
                    <DsButton variant="link" onClick={() => setStatusFor(null)}>Cancel</DsButton>
                  </form>
                ) : (
                  <>
                    {l.status === 'active' && <DsButton variant="secondary" onClick={() => { setStatusFor({ code: l.code, status: 'paused' }); setReason(''); }}>Pause</DsButton>}
                    <DsButton variant="secondary" disabled={(l.units ?? 0) > 0} disabledReason={(l.units ?? 0) > 0 ? 'Move the stock out first' : undefined}
                      onClick={() => { setStatusFor({ code: l.code, status: 'closed' }); setReason(''); }}>Close</DsButton>
                  </>
                ))}
                {l.is_default && <span className="text-[12.5px] text-muted self-center">The default warehouse can’t be paused or closed. Make another one the default first.</span>}
              </div>
            )}
          </DsCard>
        ))}
      </div>
    </div>
  );
}
