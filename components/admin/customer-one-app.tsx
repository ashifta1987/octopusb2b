import { createClient } from '@/lib/supabase/server';
import { Card, Notice } from '@/components/ui';
import { ActionForm } from '@/components/backoffice/action-form';
import { money, fmtDate } from '@/lib/format';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { setService, saveCustomerLimits } from '@/app/admin/one-app-actions';

const SERVICES: [string, string][] = [['sourcing', 'Sourcing'], ['dropship', 'Dropshipping'], ['warehouse', '3PL warehouse'], ['brand', 'Make My Brand']];

/** ADDON-41 41-B — on the customer page: services switched on, wallet reference/balance, and the customer limits set by the account manager. */
export async function CustomerOneApp({ orgId, session }: { orgId: string; session: Session }) {
  const sb = await createClient();
  const [{ data: org }, { data: svcs }, { data: lim }, { data: am }, { data: ceiling }, { data: holds }] = await Promise.all([
    sb.from('organizations').select('wallet_reference').eq('id', orgId).maybeSingle(),
    sb.from('company_services').select('service, status, plan, started_at, updated_at').eq('org_id', orgId),
    sb.from('customer_limits').select('max_order_cents, max_month_cents, min_margin_pct, set_at').eq('org_id', orgId).maybeSingle(),
    sb.from('account_managers').select('staff_user_id').eq('org_id', orgId).maybeSingle(),
    sb.from('manager_limits').select('max_amount_cents, min_margin_pct').eq('manager_user_id', session.userId).maybeSingle(),
    sb.from('wallet_holds').select('amount_cents').eq('org_id', orgId).eq('status', 'open'),
  ]);
  const st = new Map((svcs ?? []).map((r) => [r.service as string, r]));
  const isMine = am?.staff_user_id === session.userId;
  const canServices = can(session, 'customers', 'edit') || isMine;
  const canLimits = session.isAdmin || isMine;
  const onHold = (holds ?? []).reduce((a, h) => a + Number(h.amount_cents), 0);
  const dollars = (c: number | null | undefined) => (c == null ? '' : (Number(c) / 100).toFixed(2));

  return (
    <div className="grid gap-6 lg:grid-cols-2 mt-6 items-start" data-testid="customer-one-app">
      <Card title="Services">
        <div className="px-6 pb-6 space-y-3">
          <p className="text-sm text-muted">Wallet reference <b className="mono text-ink">{org?.wallet_reference as string}</b>{onHold ? ` · ${money(onHold, 'USD')} on hold` : ''}</p>
          {SERVICES.map(([k, label]) => {
            const r = st.get(k);
            return (
              <ActionForm key={k} action={setService.bind(null, orgId)} submitLabel="Save" submitClass="btn btn-ghost btn-sm min-h-11" className="rounded-[10px] border border-line p-3 grid grid-cols-[1fr_auto] gap-2 items-end">
                <input type="hidden" name="service" value={k} />
                <div className="grid grid-cols-2 gap-2">
                  <div><label htmlFor={`svc-${k}`} className="label">{label}</label>
                    <select id={`svc-${k}`} name="status" defaultValue={(r?.status as string) ?? 'off'} className="input" disabled={!canServices}>
                      <option value="off">Off</option><option value="trial">Trial</option><option value="on">On</option><option value="paused">Paused</option>
                    </select></div>
                  <div><label htmlFor={`plan-${k}`} className="label">Plan</label><input id={`plan-${k}`} name="plan" defaultValue={(r?.plan as string) ?? ''} className="input" disabled={!canServices} placeholder="e.g. Growth" /></div>
                </div>
                <div className="text-xs text-muted pb-3">{r?.updated_at ? `Changed ${fmtDate(r.updated_at as string)}` : 'Never set'}</div>
              </ActionForm>
            );
          })}
          {!canServices && <p className="text-sm text-muted">Only the customer&apos;s account manager or a customer admin can switch services.</p>}
        </div>
      </Card>
      <Card title="Customer limits">
        <div className="px-6 pb-6 space-y-3">
          <p className="text-sm text-muted">Inside these limits prices are approved automatically. Above them they come to the account manager; above the manager&apos;s own limit, to the owner.</p>
          {!session.isAdmin && isMine && (ceiling ? <p className="text-sm">Your own limit: <b>{money(Number(ceiling.max_amount_cents), 'USD')}</b>, minimum margin <b>{ceiling.min_margin_pct}%</b>.</p>
            : <Notice tone="amber">The owner has not set your own limit yet, so you cannot set this customer&apos;s limits.</Notice>)}
          <ActionForm action={saveCustomerLimits.bind(null, orgId)} submitLabel="Save limits" submitClass="btn btn-primary min-h-11" className="grid gap-3 sm:grid-cols-3"
            confirm="Save these customer limits? The change is written to the audit log.">
            <div><label htmlFor="cl-order" className="label">Per order (US$)</label><input id="cl-order" name="max_order" inputMode="decimal" className="input" defaultValue={dollars(lim?.max_order_cents as number | null)} disabled={!canLimits} /></div>
            <div><label htmlFor="cl-month" className="label">Per month (US$)</label><input id="cl-month" name="max_month" inputMode="decimal" className="input" defaultValue={dollars(lim?.max_month_cents as number | null)} disabled={!canLimits} /></div>
            <div><label htmlFor="cl-margin" className="label">Minimum margin (%)</label><input id="cl-margin" name="min_margin" inputMode="decimal" className="input" defaultValue={(lim?.min_margin_pct as number | null) ?? ''} disabled={!canLimits} /></div>
          </ActionForm>
          {lim?.set_at && <p className="text-xs text-muted">Last changed {fmtDate(lim.set_at as string, true)}</p>}
        </div>
      </Card>
    </div>
  );
}
