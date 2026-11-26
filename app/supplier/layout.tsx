import { Suspense } from 'react';
import { getSession, requireRole } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { SUPPLIER_NAV } from '@/lib/nav';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

async function Shell({ children }: { children: React.ReactNode }) {
  await getSession();
  const session = await requireRole('supplier', '/supplier');
  return (
    <PortalShell session={session} nav={SUPPLIER_NAV} roleLabel="Supplier portal" searchPlaceholder="Search your products and orders">
      {children}
    </PortalShell>
  );
}

/** Supplier portal (SPEC §5.8 / §5.9; design SupplierLogin / Products / NewProduct / BulkUpload / Orders). Accounts are made by staff after an application is approved. */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
