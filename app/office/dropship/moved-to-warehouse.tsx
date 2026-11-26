import { DsPageHeader, DsNotice, DsLinkButton, type DsIconName } from '@/components/dropship-ui';

/**
 * Warehouse OS · W7 — shown on a retired Dropship fulfilment URL to staff who do not work in a warehouse
 * (no warehouse role, no warehouse:view): the work moved to Warehouse OS; nothing is offered here.
 */
export function MovedToWarehouseOs({ title, icon, what }: { title: string; icon: DsIconName; what: string }) {
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader title={title} subtitle="Moved to Warehouse OS." icon={icon} />
      <DsNotice
        tone="info"
        title="This screen moved to Warehouse OS"
        testId="moved-to-warehouse-os"
        action={
          <DsLinkButton href="/office/dropship" variant="secondary">
            Back to Dropshipping
          </DsLinkButton>
        }
      >
        {what} now happens in Warehouse OS (Orders, Packing station, Dispatch and freight). You need a warehouse role to open
        it: ask a warehouse admin in Warehouse OS › Users and roles.
      </DsNotice>
    </div>
  );
}
