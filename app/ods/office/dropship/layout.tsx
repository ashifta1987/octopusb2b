import type { ReactNode } from 'react';

/**
 * ODS T8 · Dropshipping staff pages: replaces what today's DropshipStaffShell gave these pages around `children` — the `.ds-v2 app-shell` root
 * their Dropship-kit classes are styled under and the 1240 px column with 20 px gaps — so the same page modules lay out
 * the same way. Its sidebar and top bar are replaced by the ODS frame (the section items are in the frame's section
 * menu, app/ods/office/_lib/section-nav.ts). packages/ui/src/bridge-dropship.css maps the kit to ODS tokens (its sizes
 * read --ods-control-h, so they follow the compact density here and comfortable on the floor screens).
 * No data, no session read.
 */
export default function OdsDropshipStaffLayout({ children }: { children: ReactNode }) {
  return (
    <div data-testid="dropship-staff-shell" className="ds-v2 app-shell">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5">{children}</div>
    </div>
  );
}
