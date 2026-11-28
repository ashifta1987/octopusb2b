import type { ReactNode } from 'react';

/**
 * ODS T7 · Dropshipping inside My account (Part 6.6). The pages under this folder re-export TODAY's
 * app/account/dropship/<path>/page modules (same content, states, rules, guards and test ids); the parent ODS My account
 * layout gives them the frame, with Dropshipping as a sidebar group (AccountSidebar sub-items, More sheet on phones).
 *
 * This wrapper replaces what today's DropshipMerchantShell gave the pages around `children` — the `.ds-v2 app-shell`
 * root their kit classes and utilities are styled under, and the 1240 px column with 20 px gaps — so the same modules lay
 * out the same way. Inside the ODS root, packages/ui/src/bridge-dropship.css maps those styles to the ODS comfortable
 * tokens (Inter, ODS blue / navy / lines, ODS radii, amber focus). The merchant shell's own chrome (white sidebar, store
 * box, top bar, phone header and tabs, "Back to my Octopus account") is replaced by the ODS frame.
 * No data, no session read: never blocks the page.
 */
export default function OdsDropshipLayout({ children }: { children: ReactNode }) {
  return (
    <div data-testid="ods-dropship-area" className="ds-v2 app-shell min-h-full">
      <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 p-ods-pad-page">{children}</div>
    </div>
  );
}
