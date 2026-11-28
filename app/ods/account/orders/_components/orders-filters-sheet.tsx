'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { Button, Sheet, cx } from '@octopus/ui';
import { ORDER_SERVICES, SERVICE_LABEL, ordersHref, type OrderService, type OrdersState } from '../_lib/order-logic';

/** Phones: "Filters (n)" opens a bottom Sheet with the service filter (URL ?service=). Esc / Back close it. */
export function OrdersFiltersSheet({ state, counts, base }: { state: OrdersState; counts: Partial<Record<OrderService, number>>; base: string }) {
  const [open, setOpen] = useState(false);
  const active = state.service === 'all' ? 0 : 1;
  const opts: (OrderService | 'all')[] = ['all', ...ORDER_SERVICES];
  return (
    <>
      <Button variant="secondary" iconStart={SlidersHorizontal} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="orders-filters-button" fullWidth>
        Filters ({active})
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filter orders" testId="orders-filters-sheet">
        <ul role="list" className="m-0 flex list-none flex-col gap-2 p-0">
          {opts.map((svc) => {
            const on = state.service === svc;
            const n = svc === 'all' ? undefined : counts[svc] ?? 0;
            return (
              <li key={svc}>
                <Link
                  href={ordersHref(state, { service: svc }, base)}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(
                    'flex min-h-ods-control items-center justify-between rounded-ods-control border px-4 text-ods-body font-semibold no-underline',
                    on ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong text-ods-navy',
                  )}
                >
                  <span>{svc === 'all' ? 'All services' : SERVICE_LABEL[svc]}</span>
                  {n !== undefined ? <span className="tabular-nums">{n}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
