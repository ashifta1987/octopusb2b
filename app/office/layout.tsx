import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { OFFICE_NAV } from '@/lib/nav';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

export const metadata = { title: { default: 'Back office', template: '%s · Back office · Octopus B2B' } };

async function OfficeShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/office');
  if (!session.isStaff) redirect('/forbidden');
  return (
    <PortalShell session={session} nav={OFFICE_NAV} roleLabel="Back office" searchPlaceholder="Search orders, RFQs, tickets">
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
