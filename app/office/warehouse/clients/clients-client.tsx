'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsChip, DsEmptyState, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtDate } from '@/lib/format';
import { decideAction, saveChecksAction } from './actions';

export type Application = {
  id: string; code: string; company: string; contact_name: string; email: string; phone: string | null; country: string | null; sells: string;
  orders_band: string; channels: string[]; stock_route: string; has_batteries: boolean; has_liquids: boolean; preferred_warehouse: string | null;
  status: 'new' | 'in_review' | 'approved' | 'declined'; check_documents: boolean; check_dangerous_goods: boolean; check_terms_sent: boolean;
  plan_code: string | null; decline_reason: string | null; decided_at: string | null; org_id: string | null; created_at: string;
};
export type Client = { org_id: string; plan_code: string; preferred_warehouse: string | null; status: string; created_at: string; organizations: { name: string } | null };

const BAND: Record<string, string> = { under_100: 'Under 100', '100_500': '100–500', '500_2000': '500–2,000', over_2000: 'Over 2,000' };
const ROUTE: Record<string, string> = { octopus_b2b: 'Octopus B2B', make_my_brand: 'Make My Brand', own_supplier: 'Own supplier', mixed: 'Mixed' };
const STATUS: Record<string, [string, 'info' | 'warn' | 'ok' | 'bad']> = { new: ['New', 'info'], in_review: ['In review', 'warn'], approved: ['Approved', 'ok'], declined: ['Declined', 'bad'] };

function Review({ a, plans, canManage, warehouseNames }: { a: Application; plans: { code: string; name: string }[]; canManage: boolean; warehouseNames: Record<string, string> }) {
  const [docs, setDocs] = useState(a.check_documents);
  const [dg, setDg] = useState(a.check_dangerous_goods);
  const [terms, setTerms] = useState(a.check_terms_sent);
  const [plan, setPlan] = useState(a.plan_code ?? '');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const open = a.status === 'new' || a.status === 'in_review';
  const saved = a.check_documents && a.check_dangerous_goods && a.check_terms_sent && Boolean(a.plan_code);
  const dirty = docs !== a.check_documents || dg !== a.check_dangerous_goods || terms !== a.check_terms_sent || plan !== (a.plan_code ?? '');
  const why = !saved ? 'Tick every check, choose a plan and save first' : dirty ? 'Save the checks first' : undefined;
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.();
  });
  return (
    <div className="flex flex-col gap-4" data-testid={`wh-app-${a.code}`}>
      <DsCard title={`${a.code} · ${a.company}`} icon="file" actions={<DsBadge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</DsBadge>}>
        <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 m-0 text-[13.5px]">
          <dt className="text-muted">Contact</dt><dd className="m-0">{a.contact_name} · {a.email}{a.phone ? ` · ${a.phone}` : ''}</dd>
          <dt className="text-muted">Country</dt><dd className="m-0">{a.country ?? '—'}</dd>
          <dt className="text-muted">Sells</dt><dd className="m-0 whitespace-pre-line">{a.sells}</dd>
          <dt className="text-muted">Orders a month</dt><dd className="m-0">{BAND[a.orders_band] ?? a.orders_band}</dd>
          <dt className="text-muted">Channels</dt><dd className="m-0">{a.channels.join(', ') || '—'}</dd>
          <dt className="text-muted">Stock comes from</dt><dd className="m-0">{ROUTE[a.stock_route] ?? a.stock_route}</dd>
          <dt className="text-muted">Dangerous goods</dt><dd className="m-0">{[a.has_batteries && 'Batteries', a.has_liquids && 'Liquids'].filter(Boolean).join(', ') || 'None declared'}</dd>
          <dt className="text-muted">Preferred warehouse</dt><dd className="m-0">{a.preferred_warehouse ? warehouseNames[a.preferred_warehouse] ?? a.preferred_warehouse : 'Default'}</dd>
          <dt className="text-muted">Sent</dt><dd className="m-0">{fmtDate(a.created_at, true)}</dd>
          {a.decline_reason && <><dt className="text-muted">Declined because</dt><dd className="m-0">{a.decline_reason}</dd></>}
          {a.status === 'approved' && <><dt className="text-muted">Portal</dt><dd className="m-0">{a.org_id ? 'Open' : 'Opens when they sign in with this email'}</dd></>}
        </dl>
      </DsCard>
      {open && canManage && (
        <DsCard title="Checks" icon="check" testId="wh-app-checks">
          <div className="flex flex-col gap-1">
            <DsCheckbox label="Company documents checked" checked={docs} onChange={(e) => setDocs(e.target.checked)} />
            <DsCheckbox label={`Dangerous goods checked${a.has_batteries || a.has_liquids ? ' (safety data sheets received)' : ''}`} checked={dg} onChange={(e) => setDg(e.target.checked)} />
            <DsCheckbox label="Terms sent to the client" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <DsSelect label="Rate plan" value={plan} onChange={(e) => setPlan(e.target.value)} containerClassName="max-w-[260px]">
              <option value="">Choose a plan</option>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </DsSelect>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 items-start">
            <DsButton variant="secondary" disabled={pending || !dirty} disabledReason={!dirty ? 'No changes' : undefined} testId="wh-app-save"
              onClick={() => run(saveChecksAction(a.id, { documents: docs, dangerous: dg, terms, plan: plan || null }))}>Save checks</DsButton>
            <DsButton disabled={pending || Boolean(why)} disabledReason={why} testId="wh-app-approve" onClick={() => run(decideAction(a.id, 'approve'))}>Approve</DsButton>
            {declining ? (
              <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(decideAction(a.id, 'decline', reason), () => setDeclining(false)); }}>
                <DsInput label="Why is it declined?" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>Decline</DsButton>
                <DsButton variant="link" onClick={() => setDeclining(false)}>Cancel</DsButton>
              </form>
            ) : <DsButton variant="secondary" disabled={pending} onClick={() => { setDeclining(true); setReason(''); }} testId="wh-app-decline">Decline</DsButton>}
          </div>
        </DsCard>
      )}
      {open && !canManage && <p className="m-0 text-[13px] text-muted">Only warehouse admins review applications.</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-app-msg" className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </div>
  );
}

export function ClientsClient({ apps, clients, plans, canManage, warehouseNames }: {
  apps: Application[]; clients: Client[]; plans: { code: string; name: string }[]; canManage: boolean; warehouseNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<'open' | 'approved' | 'declined'>('open');
  const [sel, setSel] = useState<string | null>(null);
  const list = apps.filter((a) => (filter === 'open' ? a.status === 'new' || a.status === 'in_review' : a.status === filter));
  const current = apps.find((a) => a.id === sel) ?? list[0] ?? null;
  const planName = Object.fromEntries(plans.map((p) => [p.code, p.name]));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter applications">
        {([['open', 'New and in review'], ['approved', 'Approved'], ['declined', 'Declined']] as const).map(([k, l]) => (
          <DsChip key={k} pressed={filter === k} onClick={() => { setFilter(k); setSel(null); }} testId={`wh-app-filter-${k}`}>
            {l} ({apps.filter((a) => (k === 'open' ? a.status === 'new' || a.status === 'in_review' : a.status === k)).length})
          </DsChip>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-5 items-start">
        <DsCard title="Applications" icon="list" noPadding>
          {list.length === 0 ? <div className="p-5"><DsEmptyState icon="file" title="Nothing here" description="New applications from the public Apply page appear here." /></div> : (
            <ul className="list-none m-0 p-0">
              {list.map((a) => (
                <li key={a.id} className="border-b border-divider last:border-0">
                  <button type="button" onClick={() => setSel(a.id)} aria-current={current?.id === a.id ? 'true' : undefined}
                    className={`w-full text-left px-5 py-3 min-h-11 hover:bg-pearl ${current?.id === a.id ? 'bg-tint-2' : ''}`} data-testid={`wh-app-row-${a.code}`}>
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold">{a.company}</span><DsBadge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</DsBadge></div>
                    <div className="text-[12.5px] text-muted"><span className="font-mono">{a.code}</span> · {a.email} · {fmtDate(a.created_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
        <div>{current && <Review key={current.id} a={current} plans={plans} canManage={canManage} warehouseNames={warehouseNames} />}</div>
      </div>
      <DsCard title={`Clients (${clients.length})`} icon="users" noPadding testId="wh-clients">
        {clients.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-muted">No approved clients yet.</p> : (
          <div className="ds-scroll"><table className="ds-tbl min-w-[620px]">
            <thead><tr><th scope="col">Company</th><th scope="col">Plan</th><th scope="col">Preferred warehouse</th><th scope="col">Status</th><th scope="col">Since</th></tr></thead>
            <tbody>{clients.map((c) => (
              <tr key={c.org_id}><td>{c.organizations?.name ?? '—'}</td><td>{planName[c.plan_code] ?? c.plan_code}</td><td>{c.preferred_warehouse ? warehouseNames[c.preferred_warehouse] ?? c.preferred_warehouse : '—'}</td>
                <td><DsBadge tone={c.status === 'active' ? 'ok' : 'warn'}>{c.status === 'active' ? 'Active' : c.status}</DsBadge></td><td>{fmtDate(c.created_at)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </DsCard>
    </div>
  );
}
