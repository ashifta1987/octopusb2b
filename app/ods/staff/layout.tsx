import type { ReactNode } from 'react';
import { AuthBroadcastListener } from '@octopus/ui';

/**
 * ODS T8 · staff sign-in pages on the ODS theme (/staff, /staff/login, /verify, /forgot, /set-password, /workspace,
 * /account → app/ods/staff/*, lib/ods-routes.ts odsStaffRewritePath). The pages re-export today's modules: the same
 * forms, server actions, 2FA, lockout, IP rule and workspace chooser, unchanged. This wrapper only puts them in the
 * compact ODS scope (`.ods-office.ods-staff-auth`), where packages/ui/src/bridge-office.css maps today's StaffFrame
 * (header, staff-portal card, step bar, forms) to ODS compact tokens: Inter, navy / blue, 32 px controls (44 px on
 * phones), 6 px radius, amber focus. A sign-in / sign-out in another tab refreshes these pages (Part 4.6).
 */
export default function OdsStaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ods-office ods-staff-auth min-h-screen bg-ods-canvas" data-density="compact" data-testid="ods-staff-auth">
      {children}
      <AuthBroadcastListener mode="refresh" />
    </div>
  );
}
