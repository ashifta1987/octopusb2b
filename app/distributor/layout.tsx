import { Suspense } from 'react';
import { getSession, requireRole } from '@/lib/auth';
import { staffLayoutGuard } from '@/lib/staff/guard';
import { PortalShell } from '@/components/portal-shell';
import { DISTRIBUTOR_NAV } from '@/lib/nav';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

async function Shell({ children }: { children: React.ReactNode }) {
  await staffLayoutGuard(await getSession(), '/distributor');
  const session = await requireRole('distributor', '/distributor');
  return (
    <PortalShell session={session} nav={DISTRIBUTOR_NAV} roleLabel="Distributor" searchPlaceholder="Search products, RFQs, suppliers">
      {children}
    </PortalShell>
  );
}

/** Distributor panel (SPEC §4.3). Admins are allowed too (requireRole). Session reads stream inside Suspense (cacheComponents). */
export default function DistributorLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
