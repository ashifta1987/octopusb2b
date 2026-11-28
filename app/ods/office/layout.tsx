import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OdsOfficeShell } from './_components/office-shell';

/**
 * ODS T8 · Back Office (/office) on the ODS theme (Part 7.1, compact). proxy.ts rewrites /office/* here (lib/ods-routes.ts
 * odsOfficeRewritePath) after today's staff guards pass; the pages below re-export today's app/office/* page modules,
 * unchanged, inside the ODS Back Office frame. Same metadata template as today's app/office/layout.tsx. Staff areas are
 * never indexed. Switch off → today's StaffLayoutShell.
 */
export const metadata: Metadata = {
  title: { default: 'Back office', template: '%s · Back office · Octopus B2B' },
  robots: { index: false, follow: false, nocache: true },
};

export default function OdsOfficeLayout({ children }: { children: ReactNode }) {
  return <OdsOfficeShell next="/office">{children}</OdsOfficeShell>;
}
