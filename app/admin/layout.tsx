import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PortalShell } from '@/components/portal-shell';
import { OFFICE_NAV } from '@/lib/nav';
import { Loading } from '@/components/admin/ui';

export const metadata = { title: { default: 'Admin', template: '%s · Admin · Octopus B2B' } };

async function AdminShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');
  if (!session.isStaff) redirect('/forbidden');
  return (
    <PortalShell session={session} nav={OFFICE_NAV} roleLabel="Admin" searchPlaceholder="Search orders, customers, suppliers">
      {children}
    </PortalShell>
  );
}

/** Admin area: staff only; every page additionally calls requireStaff(area, action). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8"><Loading /></div>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
