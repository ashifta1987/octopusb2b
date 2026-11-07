import { Suspense } from 'react';
import { StaffLayoutShell } from '@/components/shell/staff-layout';
import { ShellFallback } from '@/components/backoffice/shell-fallback';

export const metadata = { title: { default: 'Back office', template: '%s · Back office · Octopus B2B' } };

/** Back office (SPEC §4.5): staff only; each page also calls requireStaff(area, action). Same staff shell as Admin (ADDON-41 D2). */
export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <StaffLayoutShell next="/office">{children}</StaffLayoutShell>
    </Suspense>
  );
}
