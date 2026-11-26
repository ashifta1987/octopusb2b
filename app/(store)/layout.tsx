import { Suspense } from 'react';
import { SiteFrame, StoreAnnouncement } from '@/components/store-shell';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { HomeOnly } from '@/components/site/home-only';

/** Storefront layout: website shell (design §3) — skip link, announcement (homepage only), white header + navy service bar, navy footer. */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteFrame
      before={
        <>
          {/* Maintenance mode (SPEC §16.3): prominent CMS notice; pages stay browsable. */}
          <Suspense fallback={null}>
            <MaintenanceNotice variant="prominent" />
          </Suspense>
          {/* cached data only → part of the static shell */}
          <HomeOnly><StoreAnnouncement /></HomeOnly>
        </>
      }
    >
      {children}
    </SiteFrame>
  );
}
