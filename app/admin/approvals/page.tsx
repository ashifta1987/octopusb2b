import { Suspense } from 'react';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, EmptyState, StatusBadge, Notice } from '@/components/ui';
import { ActionForm, ReasonButton } from '@/components/backoffice/action-form';
import { Field } from '@/components/admin/ui';
import { money, fmtDate } from '@/lib/format';
import { decideApproval, saveManagerLimits } from '../one-app-actions';

export const metadata = { title: 'Approvals and limits' };

const APPROVER: Record<string, string> = { auto: 'Automatic', manager: 'Account manager', owner: 'Owner' };

/** ADDON-41 — approvals waiting for me, recent decisions, and approval limits (owner sets each manager's ceiling). */
async function ApprovalsPageContent() {
  const s = await requireStaffOrManager('/admin/approvals', ['approvals', 'view']);
  const sb = await createClient();
  const [pending, recent, limits, managers] = await Promise.all([
    sb.from('approvals').select('id, service, ref_type, ref_id, amount_cents, margin_pct, reason, approver, assigned_to, created_at, organizations(name)').eq('status', 'pending').order('created_at'),
    sb.from('approvals').select('id, service, ref_id, amount_cents, approver, status, decided_at, note, organizations(name)').neq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    sb.from('manager_limits').select('manager_user_id, max_amount_cents, min_margin_pct, set_at'),
    s.isAdmin ? sb.from('user_roles').select('user_id, profiles(full_name, email, office)').eq('role_code', 'account_manager') : Promise.resolve({ data: [] as never[] }),
  ]);
  const name = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? '—';
  const lim = new Map((limits.data ?? []).map((l) => [l.manager_user_id as string, l]));
  const mine = (a: { approver: string; assigned_to: string | null }) => s.isAdmin || (a.approver === 'manager' && a.assigned_to === s.userId);

  return (
    <>
      <PageHeader title="Approvals and limits" subtitle="Inside the customer's limits a price is approved automatically. Above the customer limit it comes to the account manager; above the manager's own limit or below the minimum margin it comes to the owner." />
      <Card title="Waiting for a decision">
        <Table head={['Customer', 'Service', 'Item', 'Amount', 'Margin', 'Approver', 'Waiting', '']} empty={<EmptyState title="Nothing to approve" body="Approvals appear here when a price is above a limit." />}>
          {(pending.data ?? []).map((a) => (
            <tr key={a.id} id={a.id as string} className="scroll-mt-24">
              <td className="td font-semibold">{name(a.organizations)}</td>
              <td className="td capitalize">{a.service}</td>
              <td className="td"><div className="mono text-sm">{a.ref_id}</div><div className="text-xs text-muted">{String(a.ref_type).replace(/_/g, ' ')}{a.reason ? ` · ${a.reason}` : ''}</div></td>
              <td className="td mono">{money(Number(a.amount_cents), 'USD')}</td>
              <td className="td">{a.margin_pct != null ? `${a.margin_pct}%` : '—'}</td>
              <td className="td">{APPROVER[a.approver as string]}</td>
              <td className="td text-sm">{fmtDate(a.created_at as string, true)}</td>
              <td className="td text-right whitespace-nowrap">
                {mine(a as { approver: string; assigned_to: string | null }) ? (
                  <span className="inline-flex gap-2">
                    <ReasonButton action={decideApproval.bind(null, a.id as string, 'declined')} label="Decline" title="Decline" placeholder="Why (shown to the account manager)" className="btn btn-ghost btn-sm text-bad min-h-11" danger confirmLabel="Decline" />
                    <ReasonButton action={decideApproval.bind(null, a.id as string, 'approved')} label="Approve" title="Approve" placeholder="Note (optional)" required={false} className="btn btn-sm bg-ok text-white min-h-11" confirmLabel="Approve" />
                  </span>
                ) : <span className="text-sm text-muted">Waiting for the {a.approver === 'owner' ? 'owner' : 'manager'}</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <section id="limits" className="mt-6 scroll-mt-24">
        <Card title="Approval limits">
          <div className="px-6 pb-6 space-y-4">
            {!s.isAdmin && (lim.get(s.userId) ? (
              <p className="text-[15px]">Your limit: <b>{money(Number(lim.get(s.userId)!.max_amount_cents), 'USD')}</b> per item, minimum margin <b>{lim.get(s.userId)!.min_margin_pct}%</b>. Above it, or below that margin, the owner approves. Set each customer&apos;s limits on the customer page, within yours.</p>
            ) : <Notice tone="amber">The owner has not set your limits yet. Until then every price you prepare goes to the owner.</Notice>)}
            {s.isAdmin && (
              <>
                <Table head={['Account manager', 'Office', 'Amount limit', 'Minimum margin', 'Set']} empty={<EmptyState title="No account managers yet" body="Give a staff member the Account manager role in Staff & roles." />}>
                  {(managers.data ?? []).map((m) => {
                    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string | null; email: string | null; office: string | null } | null;
                    const l = lim.get(m.user_id as string);
                    return (
                      <tr key={m.user_id as string}>
                        <td className="td font-semibold">{p?.full_name ?? p?.email}</td>
                        <td className="td">{p?.office ?? '—'}</td>
                        <td className="td mono">{l ? money(Number(l.max_amount_cents), 'USD') : <StatusBadge status="pending" label="Not set" tone="amber" />}</td>
                        <td className="td">{l ? `${l.min_margin_pct}%` : '—'}</td>
                        <td className="td text-sm">{l ? fmtDate(l.set_at as string) : '—'}</td>
                      </tr>
                    );
                  })}
                </Table>
                {(managers.data ?? []).length > 0 && (
                  <ActionForm action={saveManagerLimits} submitLabel="Save limits" className="grid gap-4 sm:grid-cols-3 items-end" confirm="Save this manager's approval limit? It is written to the audit log.">
                    <Field label="Account manager" htmlFor="ml-manager">
                      <select id="ml-manager" name="manager" className="input" required>
                        {(managers.data ?? []).map((m) => { const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string | null; email: string | null } | null; return <option key={m.user_id as string} value={m.user_id as string}>{p?.full_name ?? p?.email}</option>; })}
                      </select>
                    </Field>
                    <Field label="Amount limit (US$)" htmlFor="ml-amount"><input id="ml-amount" name="max_amount" inputMode="decimal" className="input" required placeholder="e.g. 15000" /></Field>
                    <Field label="Minimum margin (%)" htmlFor="ml-margin"><input id="ml-margin" name="min_margin" inputMode="decimal" className="input" required placeholder="e.g. 15" /></Field>
                  </ActionForm>
                )}
              </>
            )}
          </div>
        </Card>
      </section>

      <Card title="Recent decisions" className="mt-6">
        <Table head={['Customer', 'Service', 'Item', 'Amount', 'Decided by', 'Result', 'When']} empty={<EmptyState title="No decisions yet" body="Approved and declined items appear here." />}>
          {(recent.data ?? []).map((a) => (
            <tr key={a.id}>
              <td className="td">{name(a.organizations)}</td><td className="td capitalize">{a.service}</td><td className="td mono text-sm">{a.ref_id}</td>
              <td className="td mono">{money(Number(a.amount_cents), 'USD')}</td><td className="td">{APPROVER[a.approver as string]}</td>
              <td className="td"><StatusBadge status={a.status as string} />{a.note && <div className="text-xs text-muted mt-1">{a.note}</div>}</td>
              <td className="td text-sm">{a.decided_at ? fmtDate(a.decided_at as string, true) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}>
      <ApprovalsPageContent />
    </Suspense>
  );
}
