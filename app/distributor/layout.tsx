import { Suspense } from 'react';
import { requireRole } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { DISTRIBUTOR_NAV } from '@/lib/nav';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

async function Shell({ children }: { children: React.ReactNode }) {
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
