import type { Metadata } from 'next';
import { PoolsListView } from '@/app/ods/shop/pools/_components/pools-list-view';
import { ShopFixtureFrame, ShopFixtureState } from '../shop-services/_fixture-frame';
import { SAMPLE_POOLS, poolCards } from '../shop-services/_samples';

export const metadata: Metadata = { title: 'Shop · MOQ pools list · ODS fixtures (staging)', robots: { index: false, follow: false } };

const counts = { open: 3, 'closing-soon': 1, 'almost-full': 1, filled: 1, mine: 1 } as const;

/** /shop/pools (Shop_Pools list) in every state, with sample props. */
export default function ShopPoolsFixtures() {
  return (
    <ShopFixtureFrame current="pools" title="MOQ pools list" intro="The /shop/pools list (Shop_Pools, M_Shop_Pools): status pills, sort and PoolCards, then the empty and failed states.">
      <ShopFixtureState id="list" label="Open pools" note="/shop/pools — three open pools, sorted by closing soonest.">
        <PoolsListView titleLevel={2} status="open" sort="closing" counts={{ ...counts }} items={poolCards([SAMPLE_POOLS.closingSoon, SAMPLE_POOLS.open, SAMPLE_POOLS.almostFull])} />
      </ShopFixtureState>
      <ShopFixtureState id="filled" label="Filled" note="/shop/pools?status=filled — the pool can't be joined (button disabled with the reason).">
        <PoolsListView titleLevel={2} status="filled" sort="closing" counts={{ ...counts }} items={poolCards([SAMPLE_POOLS.full])} />
      </ShopFixtureState>
      <ShopFixtureState id="empty" label="No open pools" note="/shop/pools with nothing open.">
        <PoolsListView titleLevel={2} status="open" sort="closing" counts={{ open: 0, 'closing-soon': 0, 'almost-full': 0, filled: 0, mine: 0 }} items={[]} />
      </ShopFixtureState>
      <ShopFixtureState id="empty-mine" label="My pools, none joined" note="/shop/pools?status=mine">
        <PoolsListView titleLevel={2} status="mine" sort="closing" counts={{ ...counts, mine: 0 }} items={[]} />
      </ShopFixtureState>
      <ShopFixtureState id="error" label="The list failed to load" note="Only the grid shows the error; the pills stay (the failed list has no count).">
        <PoolsListView titleLevel={2} status="open" sort="closing" counts={{ open: null, 'closing-soon': null, 'almost-full': null, filled: 1, mine: 1 }} items={[]} error retryHref="/dev/ui/screens/shop-pools" />
      </ShopFixtureState>
    </ShopFixtureFrame>
  );
}
