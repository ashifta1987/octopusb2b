import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OdsOfficeShell } from '../office/_components/office-shell';

/**
 * ODS T8 · Admin (/admin, same shell — audit C5) on the ODS theme (Part 7.1, compact). proxy.ts rewrites /admin/* here (lib/ods-routes.ts
 * odsOfficeRewritePath) after today's staff guards pass; the pages below re-export today's app/admin/* page modules,
 * unchanged, inside the ODS Back Office frame. Same metadata template as today's app/admin/layout.tsx. Staff areas are
 * never indexed. Switch off → today's StaffLayoutShell.
 */
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin · Octopus B2B' },
  robots: { index: false, follow: false, nocache: true },
};

export default function OdsAdminLayout({ children }: { children: ReactNode }) {
  return <OdsOfficeShell next="/admin">{children}</OdsOfficeShell>;
}
