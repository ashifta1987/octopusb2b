import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { money } from '@/lib/format';

/**
 * ADDON-41 board 06 — the staff work queue. Read with the staff member's own session, so row-level security scopes it:
 * the owner sees everything, an account manager only their own customers, finance the transfers to confirm.
 */
export type QueueItem = {
  key: string; customer: string; service: 'sourcing' | 'dropship' | 'warehouse' | 'brand' | 'wallet';
  ref: string; item: string; needed: string; due: string | null; dueLabel: string; late: boolean; age: string;
  href: string; cta: string; primary: boolean; owner: boolean;
};

const ago = (iso: string) => {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 36e5));
  return h < 1 ? 'just now' : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};
const orgName = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? 'Customer';

export async function getWorkQueue(s: Session) {
  const sb = await createClient();
  const isOwner = s.isAdmin;
  const isManager = s.roles.includes('account_manager');
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const seesRequests = can(s, 'requests', 'view') || isManager;

  const [approvals, transfers, rfqs, waiting] = await Promise.all([
    sb.from('approvals').select('id, org_id, service, ref_type, ref_id, amount_cents, margin_pct, reason, approver, assigned_to, created_at, organizations(name)')
      .eq('status', 'pending').order('created_at').limit(100),
    can(s, 'wallet', 'approve')
      ? sb.from('wallet_topups').select('id, org_id, amount_cents, reference, created_at, organizations(name)').eq('status', 'pending').eq('method', 'bank_transfer').order('created_at').limit(100)
      : Promise.resolve({ data: [] as never[] }),
    seesRequests
      ? sb.from('rfqs').select('id, code, title, quantity, unit, status, expires_at, created_at, organizations(name)').in('status', ['submitted', 'assigned']).order('created_at').limit(100)
      : Promise.resolve({ data: [] as never[] }),
    seesRequests
      ? sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('status', 'quoted')
      : Promise.resolve({ count: 0 }),
  ]);

  const items: QueueItem[] = [];
  for (const a of approvals.data ?? []) {
    const mine = (isOwner && a.approver === 'owner') || (a.approver === 'manager' && a.assigned_to === s.userId);
    if (!mine && !isOwner) continue;
    items.push({
      key: `ap-${a.id}`, customer: orgName(a.organizations), service: a.service as QueueItem['service'], ref: a.ref_id as string,
      item: `${String(a.ref_type).replace(/_/g, ' ')} · ${money(Number(a.amount_cents), 'USD')}${a.margin_pct != null ? ` · margin ${a.margin_pct}%` : ''}`,
      needed: a.approver === 'owner' ? (a.reason ? `${a.reason}. Needs the owner.` : 'Above the manager limit or below the minimum margin. Needs the owner.') : (a.reason ?? 'Above the customer limit. Approve or decline.'),
      due: null, dueLabel: 'Waiting', late: false, age: `Waiting ${ago(a.created_at as string)}`,
      href: `/admin/approvals#${a.id}`, cta: mine ? 'Approve or decline' : 'Open approval', primary: true, owner: a.approver === 'owner',
    });
  }
  for (const t of transfers.data ?? []) {
    items.push({
      key: `tt-${t.id}`, customer: orgName(t.organizations), service: 'wallet', ref: t.reference as string,
      item: `Bank transfer · ${money(Number(t.amount_cents), 'USD')} claimed`, needed: 'Check the bank statement, enter the amount received and confirm, or reject with a reason.',
      due: null, dueLabel: 'Today', late: Date.now() - Date.parse(t.created_at as string) > 864e5, age: `Sent ${ago(t.created_at as string)}`,
      href: '/admin/finance/transfers', cta: 'Check transfer', primary: true, owner: false,
    });
  }
  for (const r of rfqs.data ?? []) {
    const due = (r.expires_at as string | null) ?? null;
    items.push({
      key: `rq-${r.id}`, customer: orgName(r.organizations), service: 'sourcing', ref: r.code as string,
      item: `${r.title} · ${Number(r.quantity).toLocaleString('en-US')} ${r.unit}`,
      needed: r.status === 'submitted' ? 'New sourcing request. Assign a sourcing office and start finding suppliers.' : 'Find suppliers and add quotes.',
      due, dueLabel: due ? new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No deadline', late: !!due && Date.parse(due) <= today.getTime(),
      age: `New ${ago(r.created_at as string)}`, href: `/office/rfqs/${r.id}`, cta: 'Open request', primary: false, owner: false,
    });
  }
  items.sort((a, b) => Number(b.late) - Number(a.late) || Number(b.owner && isOwner) - Number(a.owner && isOwner));
  return {
    items,
    stats: {
      open: items.length,
      needOwner: items.filter((i) => i.owner).length,
      waitingCustomer: (waiting as { count: number | null }).count ?? 0,
      dueOrLate: items.filter((i) => i.late).length,
    },
    myApprovals: items.filter((i) => i.key.startsWith('ap-')).length,
  };
}

