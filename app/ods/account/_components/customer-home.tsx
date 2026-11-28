import type { ReactNode } from 'react';
import { Skeleton } from '@octopus/ui';

/**
 * ODS T6 · My account Home layout (Part 6.2, boards CustomerHome / M_CustomerHome). Server-safe, slots only — the real
 * page passes <Suspense>-wrapped panels, the fixtures pass panels with sample props.
 * Desktop: greeting; [Waiting for you | Wallet + Browse products]; Your services (or the brand-new 3-step start);
 * [In progress | Your account manager]. Phones: one column in the same order.
 */
export function CustomerHomeLayout({
  greeting, banner, waiting, wallet, browse, services, inProgress, manager,
}: {
  greeting: ReactNode; banner?: ReactNode; waiting: ReactNode; wallet: ReactNode; browse: ReactNode; services: ReactNode; inProgress: ReactNode; manager: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-5 p-ods-pad-page" data-testid="account-home">
      {greeting}
      {banner}
      <div className="grid items-start gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_360px]">
        {waiting}
        <div className="grid min-w-0 gap-5">
          {wallet}
          {browse}
        </div>
      </div>
      {services}
      <div className="grid items-start gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_360px]">
        {inProgress}
        {manager}
      </div>
    </div>
  );
}

export function GreetingSkeleton() {
  return (
    <div aria-hidden className="grid gap-2">
      <Skeleton silent className="h-9 w-72 max-w-full" />
      <Skeleton silent className="h-5 w-56 max-w-full" />
    </div>
  );
}
