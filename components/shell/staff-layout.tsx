import { getSession } from '@/lib/auth';
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
  const [moderation, q, unread, dropshipV2Ui, myDivs] = await Promise.all([
    moderationPendingCount(), getWorkQueue(session, scope).catch(() => null),
    (scope.all ? unreadQ : unreadQ.eq('division_id', scope.division.id)).then((r) => r.count ?? 0, () => 0),
    isDropshipV2UiEnabled(),
    sb.from('division_members').select('division_id, role').eq('user_id', session.userId),
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
  const counts = {
    queue: q?.stats.open ?? 0,
    approvals: q?.myApprovals ?? 0,
    transfers: q?.items.filter((i) => i.key.startsWith('tt-')).length ?? 0,
  };
  return <StaffShell session={session} nav={OFFICE_NAV} counts={counts} moderation={moderation} unread={unread} scope={scope} dropshipV2Ui={dropshipV2Ui} canEditDropship={canEditDropship}>{children}</StaffShell>;
}
