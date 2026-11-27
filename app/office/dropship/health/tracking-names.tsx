'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsInput } from '@/components/dropship-ui';
import { platformName } from '@/lib/connectors/platforms';
import type { ConnectorHealth } from '@/lib/dropship-c0';
import { saveTrackingNameAction } from './actions';

/** C0 · carrier → store tracking company name (staff). Empty name = "Other" + our branded /t/ link. Buyers never see these names. */
const CARRIER: Record<string, string> = { yunexpress: 'YunExpress', '4px': '4PX' };

export function TrackingNamesEditor({ rows, canEdit }: { rows: ConnectorHealth['tracking_names']; canEdit: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState({ company: '', url: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const noEdit = 'Dropship editors and admins change these';
  return (
    <div data-testid="tracking-names">
      <h3 className="m-0 mb-1 text-[15px] font-semibold text-ink">Tracking company names</h3>
      <p className="m-0 mb-2 text-[13px] text-muted">What we send to the store with the tracking number. Not set = &ldquo;Other&rdquo; with the merchant-branded tracking link.</p>
      <ul className="m-0 p-0 list-none flex flex-col gap-3 text-[14px]">
        {rows.map((r) => {
          const key = `${r.carrier}:${r.platform}`;
          return (
            <li key={key} className="flex flex-col gap-1.5" data-testid={`tracking-name-${r.carrier}-${r.platform}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{CARRIER[r.carrier] ?? r.carrier} → {platformName(r.platform)}</span>
                {r.company_name ? <DsBadge tone="ok">{r.company_name}</DsBadge> : <DsBadge tone="warn">Not set</DsBadge>}
                {r.url_template ? <span className="text-[12px] text-muted break-all">{r.url_template}</span> : <span className="text-[12px] text-muted">our tracking link</span>}
                {edit !== key && <DsButton variant="link" disabled={!canEdit} disabledReason={canEdit ? undefined : noEdit}
                  onClick={() => { setEdit(key); setMsg(null); setF({ company: r.company_name ?? '', url: r.url_template ?? '' }); }}>Edit<span className="sr-only"> {CARRIER[r.carrier]} {platformName(r.platform)}</span></DsButton>}
              </div>
              {r.note && <p className="m-0 text-[12px] text-muted">{r.note}</p>}
              {edit === key && (
                <div className="grid sm:grid-cols-2 gap-2 items-end">
                  <DsInput label="Company name in the store" value={f.company} maxLength={80} onChange={(e) => setF({ ...f, company: e.target.value })} hint="Exactly as in the platform's list. Empty = Other." data-testid="tracking-name-company" />
                  <DsInput label="Tracking link (optional)" value={f.url} maxLength={300} placeholder="https://…{tracking}" onChange={(e) => setF({ ...f, url: e.target.value })} hint="Empty = our branded /t/ link." />
                  <div className="flex gap-2 sm:col-span-2">
                    <DsButton loading={pending} testId="tracking-name-save" onClick={() => start(async () => {
                      const res = await saveTrackingNameAction({ carrier: r.carrier, platform: r.platform, company: f.company, url: f.url });
                      setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.message });
                      if (res.ok) { setEdit(null); router.refresh(); }
                    })}>Save</DsButton>
                    <DsButton variant="secondary" onClick={() => setEdit(null)}>Cancel</DsButton>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <div role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`} data-testid="tracking-name-msg">{msg.text}</div>}
    </div>
  );
}
