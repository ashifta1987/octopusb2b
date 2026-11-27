'use client';

import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, ProductCardSkeleton } from '@octopus/ui';
import { ShopCard } from '../../../_components/shop-card';
import type { SourcingCardModel } from '../../../_lib/cards';
import type { LoadSimilarFn } from '../../_lib/types';

/**
 * Similar products (Part 5.4 item 10): loads only when the tab is first opened (Tabs mounts panels lazily and keeps them),
 * through a server action. Own loading / empty / error states.
 */
export function SimilarProducts({ productId, categoryId, load, canAct, demo }: { productId: string; categoryId: string | null; load?: LoadSimilarFn; canAct: boolean; demo?: boolean }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; items: SourcingCardModel[] }>(load ? { status: 'loading' } : { status: 'ready', items: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    load(productId, categoryId)
      .then((r) => alive && setState('error' in r ? { status: 'error' } : { status: 'ready', items: r.items }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [load, productId, categoryId, attempt]);
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (state.status === 'loading') {
    return (
      <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <ProductCardSkeleton silent={i > 0} />
          </li>
        ))}
      </ul>
    );
  }
  if (state.status === 'error') return <ErrorState title="We couldn’t load similar products." onRetry={retry} headingLevel={3} />;
  if (!state.items.length) return <EmptyState title="No similar products yet" description="New products are added every week." headingLevel={3} />;
  return (
    <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3" data-testid="similar-products">
      {state.items.map((m) => (
        <li key={m.id} className="flex min-w-0">
          <ShopCard model={m} canAct={canAct} demo={demo} className="flex h-full w-full min-w-0 flex-col gap-1" />
        </li>
      ))}
    </ul>
  );
}
