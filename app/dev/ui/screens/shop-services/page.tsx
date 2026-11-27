import type { Metadata } from 'next';
import { DropshipView } from '@/app/ods/shop/dropship/_components/dropship-view';
import { WarehouseServicesView } from '@/app/ods/shop/warehouse/_components/warehouse-view';
import { BrandView } from '@/app/ods/shop/brand/_components/brand-view';
import { ShopFixtureFrame, ShopFixtureState } from './_fixture-frame';
import { sampleWarehouseSubmit } from './fixture-actions';
import { SAMPLE_BRAND, SAMPLE_DEFAULTS, SAMPLE_DROPSHIP_ACCESS, SAMPLE_DROPSHIP_NO_ACCESS, SAMPLE_WAREHOUSES, SAMPLE_WAREHOUSE_NO_RATES, SAMPLE_WAREHOUSE_RATES } from './_samples';

export const metadata: Metadata = { title: 'Shop · Dropship, Warehouse, Brand · ODS fixtures (staging)', robots: { index: false, follow: false } };

/** /shop/dropship, /shop/warehouse and /shop/brand (Part 5.7) with sample props. */
export default function ShopServicesFixtures() {
  return (
    <ShopFixtureFrame title="Dropshipping, Warehouse and Make My Brand" intro="The gated dropship grid without and with access, the two warehouse views (with rates and before rates are set) and the brand cards.">
      <ShopFixtureState id="dropship-no-access" label="Dropshipping without access" note="/shop/dropship — names and photos only, never a price; Request access goes to today's activation page.">
        <DropshipView titleLevel={2} hasAccess={false} requestHref="/account/dropship" items={SAMPLE_DROPSHIP_NO_ACCESS} total={SAMPLE_DROPSHIP_NO_ACCESS.length} />
      </ShopFixtureState>
      <ShopFixtureState id="dropship-access" label="Dropshipping with access" note="Your price and the landed cost to the company's country.">
        <DropshipView titleLevel={2} hasAccess requestHref="/account/dropship" countryName="United Arab Emirates" items={SAMPLE_DROPSHIP_ACCESS} total={120} />
      </ShopFixtureState>
      <ShopFixtureState id="warehouse-storage" label="Warehouse: Storage" note="/shop/warehouse — rates from the live standard plan.">
        <WarehouseServicesView titleLevel={2} view="storage" quote={null} services={SAMPLE_WAREHOUSE_RATES} defaults={SAMPLE_DEFAULTS} warehouses={SAMPLE_WAREHOUSES} submit={sampleWarehouseSubmit} />
      </ShopFixtureState>
      <ShopFixtureState id="warehouse-fulfilment" label="Warehouse: Fulfilment, rates not set yet" note="/shop/warehouse?view=fulfilment before the plan has rates.">
        <WarehouseServicesView titleLevel={2} view="fulfilment" quote={null} services={SAMPLE_WAREHOUSE_NO_RATES} defaults={SAMPLE_DEFAULTS} warehouses={SAMPLE_WAREHOUSES} submit={sampleWarehouseSubmit} isClient />
      </ShopFixtureState>
      <ShopFixtureState id="brand" label="Make My Brand" note="/shop/brand — one card per branding method; Brand it opens the start form.">
        <BrandView titleLevel={2} items={SAMPLE_BRAND} />
      </ShopFixtureState>
    </ShopFixtureFrame>
  );
}
