import { Breadcrumbs, ErrorState, Button, NamedTabLink } from '@octopus/ui';
import type { ServiceCardModel } from '../../_lib/cards';
import { ShopCard } from '../../_components/shop-card';
import { servicesForView, warehouseHref, type QuoteDefaults, type WarehouseView } from '../_lib/warehouse-logic';
import { WarehouseQuoteDrawer, WarehouseViewSwitch, type WarehouseSubmit } from './warehouse-client';

export type WarehouseViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  view: WarehouseView;
  /** ?quote=<service key> — the quote drawer is open for it. */
  quote: string | null;
  /** All four services (storage, receiving, fulfilment, returns) with the live rates; `rates: []` = "Rates not set yet". */
  services: ServiceCardModel[];
  error?: boolean;
  /** The company already uses Warehouse (3PL). */
  isClient?: boolean;
  defaults: QuoteDefaults;
  warehouses: { code: string; name: string; city: string }[];
  submit: WarehouseSubmit;
};

/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

/**
 * ODS T4 · /shop/warehouse (Part 5.7): Segmented Storage | Fulfilment (?view=), ServiceCards with the rates from the
 * live standard plan (or "Rates not set yet"), Get a quote → the 3PL quote form in a Drawer, prefilled (?quote=).
 */
export function WarehouseServicesView({ view, quote, services, error, isClient, defaults, warehouses, submit, titleLevel }: WarehouseViewProps) {
  const { T, S, card } = levels(titleLevel);
  const keys = servicesForView(view);
  const shown = services.filter((s) => keys.includes(s.id)).map((s) => ({ ...s, href: warehouseHref({ view, quote: s.id }), quoteHref: warehouseHref({ view, quote: s.id }) }));
  const chosen = services.find((s) => s.id === quote) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Warehouse (3PL)' }]} />
      <header className="flex flex-col gap-2">
        <T className="m-0 text-ods-h1 text-ods-navy">Warehouse (3PL)</T>
        <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">We store your stock in our China warehouse and pick, pack and ship every order. Ask for a quote for your volumes.</p>
      </header>
      {isClient ? (
        <p className="m-0 rounded-ods-control border border-ods-line bg-ods-info-tint px-4 py-3 text-ods-body">
          Your company already uses Warehouse (3PL).{' '}
          <NamedTabLink href="/account/warehouse" tab="account" className="font-semibold text-ods-navy underline">
            Open Warehouse in My account
          </NamedTabLink>
        </p>
      ) : null}
      <section aria-labelledby="wh-services" data-testid="warehouse-view" data-view={view} className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <div className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
          <S id="wh-services" className="m-0 text-ods-h2 text-ods-navy">
            {view === 'storage' ? 'Storage services' : 'Fulfilment services'}
          </S>
          <WarehouseViewSwitch view={view} />
        </div>
        {error ? (
          <ErrorState title="We couldn’t load warehouse rates." action={<Button variant="secondary" href={warehouseHref({ view })}>Try again</Button>} />
        ) : (
          <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2">
            {shown.map((m) => (
              <li key={m.id} className="min-w-0">
                <ShopCard model={m} headingLevel={card} />
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-ods-small text-ods-slate">Rates are from our standard plan. Volume and custom plans are quoted for you.</p>
      </section>
      <WarehouseQuoteDrawer view={view} quote={quote} serviceTitle={chosen?.title ?? null} defaults={defaults} warehouses={warehouses} submit={submit} />
    </div>
  );
}
