import { Suspense } from 'react';
import { StaffLayoutShell } from '@/components/shell/staff-layout';
import { Loading } from '@/components/admin/ui';

export const metadata = { title: { default: 'Admin', template: '%s · Admin · Octopus B2B' } };

/** Admin area: staff only; every page additionally checks its own permission (ADDON-41 board 06 shell). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8"><Loading /></div>}>
      <StaffLayoutShell next="/admin">{children}</StaffLayoutShell>
    </Suspense>
  );
}
