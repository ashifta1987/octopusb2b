import type { Metadata } from 'next';
import { PoolPageView } from '@/app/ods/shop/pools/_components/pool-page-view';
import { ShopFixtureFrame, ShopFixtureState } from '../shop-services/_fixture-frame';
import { sampleNotifyAction } from '../shop-services/fixture-actions';
import { FIXTURE_NOW, SAMPLE_POOLS } from '../shop-services/_samples';

export const metadata: Metadata = { title: 'Shop · MOQ pool page · ODS fixtures (staging)', robots: { index: false, follow: false } };

const EMAIL = 'anna@example.com';

/** /shop/pools/[code] (Shop_Pools pool details + States-Shop "Pool closed or full") in every state, with sample props. */
export default function ShopPoolFixtures() {
  return (
    <ShopFixtureFrame current="pools" title="MOQ pool page" intro="The /shop/pools/[code] page: open, almost full, below the minimum, already joined, can't join, full and closed. Join pool and Notify me don't write anything here.">
      <ShopFixtureState id="open" label="Open" note="Join form: units from the minimum, product total, deposit from the pool, balance and the 'doesn't fill' note.">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.open} now={FIXTURE_NOW} join={{ kind: 'open' }} email={EMAIL} notifyAction={sampleNotifyAction} demo />
      </ShopFixtureState>
      <ShopFixtureState id="almost-full" label="Almost full">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.almostFull} now={FIXTURE_NOW} join={{ kind: 'open' }} email={EMAIL} notifyAction={sampleNotifyAction} demo />
      </ShopFixtureState>
      <ShopFixtureState id="below-minimum" label="Below the minimum" note="The units can't go under the pool minimum; the reason shows under the stepper.">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.closingSoon} now={FIXTURE_NOW} join={{ kind: 'open' }} email={EMAIL} notifyAction={sampleNotifyAction} demo initialUnits={SAMPLE_POOLS.closingSoon.minPledge} />
      </ShopFixtureState>
      <ShopFixtureState id="mine" label="Your company already joined">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.open} now={FIXTURE_NOW} join={{ kind: 'mine', qty: 100, status: 'paid' }} email={EMAIL} />
      </ShopFixtureState>
      <ShopFixtureState id="blocked" label="Can't join (viewer role)">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.open} now={FIXTURE_NOW} join={{ kind: 'blocked', reason: 'Your role can browse but not send requests. Ask your company owner to make you a buyer.' }} email={EMAIL} />
      </ShopFixtureState>
      <ShopFixtureState id="full" label="Full" note="This pool is full + Notify me (today's pool alerts: an email when the next pool opens).">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.full} now={FIXTURE_NOW} join={{ kind: 'full' }} email={EMAIL} notifyAction={sampleNotifyAction} />
      </ShopFixtureState>
      <ShopFixtureState id="closed" label="Closed without filling">
        <PoolPageView titleLevel={2} pool={SAMPLE_POOLS.closed} now={FIXTURE_NOW} join={{ kind: 'closed' }} email={null} notifyAction={sampleNotifyAction} />
      </ShopFixtureState>
    </ShopFixtureFrame>
  );
}
