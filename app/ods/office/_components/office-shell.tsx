import { Suspense, type ReactNode } from 'react';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { getOfficeFrameData } from '../_lib/frame-data';
import { searchOfficeRecords } from '../_lib/search';
import { OfficeFrame } from './office-frame';

/**
 * ODS T8 · the one Back Office shell for BOTH base paths (app/ods/office/layout.tsx and app/ods/admin/layout.tsx, audit
 * C5). Like today's office/admin layouts, the frame (guard + session reads) and the page stream inside one <Suspense>
 * with a same-size skeleton; every page keeps its own Suspense + requireStaff guard.
 */
export function OdsOfficeShell({ next, children }: { next: '/office' | '/admin'; children: ReactNode }) {
  return (
    <Suspense fallback={<OfficeFrameSkeleton />}>
      <OfficeFrameLoader next={next}>{children}</OfficeFrameLoader>
    </Suspense>
  );
}

async function OfficeFrameLoader({ next, children }: { next: string; children: ReactNode }) {
  const data = await getOfficeFrameData(next);
  return (
    <OfficeFrame data={data} search={searchOfficeRecords} notice={<MaintenanceNotice />}>
      {children}
    </OfficeFrame>
  );
}

/** Same sizes as the frame (48 px top bar, 232 px sidebar, 36 px tab strip) so nothing jumps when it arrives. */
export function OfficeFrameSkeleton() {
  return (
    <div className="ods-office flex min-h-screen flex-col bg-ods-canvas" data-density="compact" aria-busy="true">
      <div className="h-12 bg-ods-navy-dark" />
      <div className="flex flex-1">
        <div className="hidden w-[232px] shrink-0 flex-col gap-2 bg-ods-navy p-2 ods-tablet:flex">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="h-ods-control rounded-ods-control bg-white/5" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="hidden h-ods-tab border-b border-ods-line ods-tablet:block" />
          <div className="p-ods-pad-page">
            <div className="h-6 w-56 rounded-ods-control bg-ods-line" />
            <div className="mt-4 h-40 rounded-ods-card bg-ods-surface" />
            <span className="sr-only" role="status">
              Loading
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
