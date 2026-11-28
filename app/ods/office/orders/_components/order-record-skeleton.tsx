import { Skeleton } from '@octopus/ui';

/** Order record loading state: header, stepper and tab panel placeholders (the frame stays). */
export function OrderRecordSkeleton() {
  return (
    <div data-testid="order-record-loading" className="flex flex-col gap-4" aria-busy="true">
      <h1 className="sr-only">Loading order</h1>
      <Skeleton lines={2} label="Loading order" />
      <div className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
        <Skeleton lines={1} label="Loading progress" />
      </div>
      <div className="rounded-ods-card border border-ods-line bg-ods-surface p-4">
        <Skeleton lines={6} label="Loading order details" />
      </div>
    </div>
  );
}
