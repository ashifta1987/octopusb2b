import { can, getSession } from '@/lib/auth';
import { staffLayoutGuard } from '@/lib/staff/guard';
import { OFFICE_NAV } from '@/lib/nav';
import { moderationPendingCount } from '@/lib/moderation-count';
import { getWorkQueue } from '@/lib/core/work-queue';
import { StaffShell } from './staff-shell';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import { isDropshipV2UiEnabled } from '@/lib/dropship';

/** Shared by /admin and /office (ADDON-41 D2): one staff shell; work-queue counts in the side menu. */
export async function StaffLayoutShell({ next, children }: { next: string; children: React.ReactNode }) {
  const session = await staffLayoutGuard(await getSession(), next);
  const sb = await createClient();
  // divisions step 4: the header switcher narrows the work queue counts and the notification bell to one division
  const scope = await getDivisionScope(session);
  // staff notification inbox count (bug 2, 8 Nov 2026): same source and rule as the customer bell — unread = read_at empty
  const unreadQ = sb.rpc('my_notifications', undefined, { count: 'exact', head: true }).is('read_at', null);
  const [moderation, q, unread, dropshipV2Ui, myDivs, warehouseMember] = await Promise.all([
    moderationPendingCount(), getWorkQueue(session, scope).catch(() => null),
    (scope.all ? unreadQ : unreadQ.eq('division_id', scope.division.id)).then((r) => r.count ?? 0, () => 0),
    isDropshipV2UiEnabled(),
    sb.from('division_members').select('division_id, role').eq('user_id', session.userId),
    // Warehouse OS W7: does this person work in a warehouse (admin, warehouse:view or a warehouse role)? Decides the Warehouse
    // OS menu (others only see B2B shipments there) and the Dropship Fulfilment queue / Pack station items.
    sb.rpc('wh_my_warehouses').then((r) => !r.error && Array.isArray(r.data) && r.data.length > 0, () => false),
  ]);
  const dsDivId = scope.options.find((d) => d.code === 'DS')?.id ?? null;
  const canEditDropship =
    session.isAdmin ||
    Boolean(
      dsDivId &&
      (myDivs.data ?? []).some(
        (m) => m.division_id === dsDivId && ['manager', 'staff'].includes(String(m.role)),
      ),
    );
  // EA-1: Shipping rates follow the database rule (step6b_rate_card_read): admin, Finance, orders editors, 3PL viewers,
  // or a member of the 3PL & Shipping or Dropship division. Support alone never sees rate cards.
  const memberCodes = (myDivs.data ?? [])
    .map((m) => scope.options.find((d) => d.id === m.division_id)?.code)
    .filter(Boolean) as string[];
  const canSeeRates =
    session.isAdmin || can(session, 'finance', 'view') || can(session, 'orders', 'edit') || can(session, 'warehouse', 'view') ||
    memberCodes.includes('3PL') || memberCodes.includes('DS');
  const in3pl = memberCodes.includes('3PL');
  const counts = {
    queue: q?.stats.open ?? 0,
    approvals: q?.myApprovals ?? 0,
    transfers: q?.items.filter((i) => i.key.startsWith('tt-')).length ?? 0,
  };
  return <StaffShell session={session} nav={OFFICE_NAV} counts={counts} moderation={moderation} unread={unread} scope={scope} dropshipV2Ui={dropshipV2Ui} canEditDropship={canEditDropship} canSeeRates={canSeeRates} in3pl={in3pl} warehouseMember={warehouseMember}>{children}</StaffShell>;
}
