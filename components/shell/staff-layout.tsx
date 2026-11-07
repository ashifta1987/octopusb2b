import { getSession } from '@/lib/auth';
import { staffLayoutGuard } from '@/lib/staff/guard';
import { OFFICE_NAV } from '@/lib/nav';
import { moderationPendingCount } from '@/lib/moderation-count';
import { getWorkQueue } from '@/lib/core/work-queue';
import { StaffShell } from './staff-shell';

/** Shared by /admin and /office (ADDON-41 D2): one staff shell; work-queue counts in the side menu. */
export async function StaffLayoutShell({ next, children }: { next: string; children: React.ReactNode }) {
  const session = await staffLayoutGuard(await getSession(), next);
  const [moderation, q] = await Promise.all([moderationPendingCount(), getWorkQueue(session).catch(() => null)]);
  const counts = {
    queue: q?.stats.open ?? 0,
    approvals: q?.myApprovals ?? 0,
    transfers: q?.items.filter((i) => i.key.startsWith('tt-')).length ?? 0,
  };
  return <StaffShell session={session} nav={OFFICE_NAV} counts={counts} moderation={moderation}>{children}</StaffShell>;
}
