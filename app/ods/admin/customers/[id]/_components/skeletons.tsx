import { Skeleton } from '@octopus/ui';

/** ODS T9 · whole-record skeleton (header + tab row + three panels) while the staff session and the customer row load. */
export function RecordSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" data-testid="customer-record-loading">
      <div className="rounded-ods-card border border-ods-line bg-ods-surface p-4"><Skeleton lines={3} label="Loading customer" /></div>
      <div className="h-ods-tab rounded-ods-control bg-ods-canvas" aria-hidden />
      <div className="grid gap-4 ods-desktop:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="rounded-ods-card border border-ods-line bg-ods-surface p-4"><Skeleton lines={5} silent /></div>)}
      </div>
    </div>
  );
}
