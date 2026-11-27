'use client';

import { useSyncExternalStore } from 'react';
import { History } from 'lucide-react';
import { Button, EmptyState } from '@octopus/ui';
import type { SourcingCardModel } from '../_lib/cards';
import { ShopCard } from './shop-card';

const KEY = 'ods-shop-recent-cleared';
const EVT = 'ods-shop-recent-cleared';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(EVT, cb);
  };
}
const read = () => {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * ODS T4 · Recently viewed on /shop (Part 5.2 §5): up to 4 SourcingCards (today's source: product_views via
 * getRecentlyViewedIds) and Clear.
 * Clear is CLIENT-ONLY (documented): there is no server action that deletes product_views rows (writing one would change
 * stored history), so Clear hides the products shown now in this browser (localStorage `ods-shop-recent-cleared` = their
 * ids). Products viewed later appear again. `items === null` = the list couldn't load (a short line, the page goes on).
 */
export function RecentlyViewed({ items, canAct, demo }: { items: SourcingCardModel[] | null | 'loading'; canAct: boolean; demo?: boolean }) {
  const cleared = useSyncExternalStore(subscribe, read, () => '');
  const hidden = new Set(cleared.split(',').filter(Boolean));
  const list = Array.isArray(items) ? items.filter((i) => !hidden.has(i.id)) : [];
  const clear = () => {
    if (!Array.isArray(items)) return;
    try {
      window.localStorage.setItem(KEY, [...hidden, ...items.map((i) => i.id)].slice(-50).join(','));
    } catch {
      /* private mode: nothing to remember */
    }
    window.dispatchEvent(new Event(EVT));
  };
  return (
    <section aria-labelledby="recent-heading" data-testid="recently-viewed" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="recent-heading" className="m-0 text-ods-h2 text-ods-navy">
          Recently viewed
        </h2>
        {list.length ? (
          <Button variant="link" size="sm" onClick={clear} data-testid="recent-clear">
            Clear<span className="sr-only"> recently viewed products</span>
          </Button>
        ) : null}
      </div>
      {items === 'loading' ? (
        <p className="m-0 text-ods-small text-ods-slate" role="status">
          Loading recently viewed products…
        </p>
      ) : items === null ? (
        <p className="m-0 text-ods-small text-ods-slate">We couldn’t load your recently viewed products. They show again on the next visit.</p>
      ) : list.length === 0 ? (
        <div className="rounded-ods-card border border-ods-line bg-ods-surface">
          <EmptyState icon={History} headingLevel={3} title="Nothing here yet" description="Products you open in the shop show here, so you can find them again." />
        </div>
      ) : (
        <ul role="list" className="-mx-1 flex snap-x snap-mandatory gap-ods-gap overflow-x-auto px-1 pb-2 ods-tablet:mx-0 ods-tablet:grid ods-tablet:grid-cols-2 ods-tablet:overflow-visible ods-tablet:px-0 ods-tablet:pb-0 ods-desktop:grid-cols-4">
          {list.slice(0, 4).map((m) => (
            <li key={m.id} className="flex w-[min(80%,300px)] shrink-0 snap-start ods-tablet:w-auto [&>*]:w-full">
              <ShopCard model={m} canAct={canAct} demo={demo} showService />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
