import { Suspense } from 'react';
import { SiteFrame } from '@/components/store-shell';
import { MaintenanceNotice } from '@/components/maintenance-notice';

/** Storefront layout: website shell (design §3) — skip link, white header + navy service bar, navy footer.
 *  Owner 27 Nov: no announcement bar above the logo (StoreAnnouncement and its CMS switch stay, but are not rendered). */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteFrame
      before={
        <>
          {/* Maintenance mode (SPEC §16.3): prominent CMS notice; pages stay browsable. */}
          <Suspense fallback={null}>
            <MaintenanceNotice variant="prominent" />
          </Suspense>
        </>
      }
    >
      {children}
    </SiteFrame>
  );
}
