import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import { staffLayoutGuard } from '@/lib/staff/guard';
import { PortalShell } from '@/components/portal-shell';
import { OFFICE_NAV } from '@/lib/nav';
import { moderationPendingCount } from '@/lib/moderation-count';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

export const metadata = { title: { default: 'Back office', template: '%s · Back office · Octopus B2B' } };

async function OfficeShell({ children }: { children: React.ReactNode }) {
  const session = await staffLayoutGuard(await getSession(), '/office');
  const moderation = await moderationPendingCount();   // red count next to "Moderation"
  return (
    <PortalShell session={session} nav={OFFICE_NAV} moderation={moderation} roleLabel="Back office" searchPlaceholder="Search orders, RFQs, tickets">
      {children}
    </PortalShell>
  );
}

/** Back office (SPEC §4.5): staff only; each page also calls requireStaff(area, action). */
export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <OfficeShell>{children}</OfficeShell>
    </Suspense>
  );
}
