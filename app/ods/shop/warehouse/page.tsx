import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@octopus/ui';
import { getShopViewer } from '@/lib/shop/data';
import { createClient } from '@/lib/supabase/server';
import { serviceOn } from '@/lib/core/account';
import { submitApplicationAction } from '@/app/(store)/3pl/apply/actions';
import { loadSectionItems } from '../_lib/loaders';
import type { ServiceCardModel } from '../_lib/cards';
import { parseQuoteKey, parseWarehouseView } from './_lib/warehouse-logic';
import { WarehouseServicesView } from './_components/warehouse-view';

export const metadata: Metadata = { title: 'Warehouse (3PL)', robots: { index: false, follow: false } };

type SP = Promise<{ view?: string; quote?: string }>;

/**
 * ODS T4 · /shop/warehouse. Rates: loadSectionItems('3pl') → wh_rate_versions (active standard plan, all warehouses;
 * public columns receiving_per_carton_cents, storage_per_pallet_month_cents, pick_pack_first_cents,
 * pick_pack_extra_cents, returns_per_item_cents). Warehouses for the quote form: warehouses (code, name, city; active),
 * the same query as /3pl/apply. Quote = today's submitApplicationAction.
 */
export default function ShopWarehousePage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading warehouse services" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const [sp, viewer] = await Promise.all([searchParams, getShopViewer()]);
  const view = parseWarehouseView(sp.view);
  const quote = parseQuoteKey(sp.quote);
  const sb = await createClient();
  const [items, wh] = await Promise.all([
    loadSectionItems('3pl', { limit: 4 }).then(
      (r) => r.items.filter((m): m is ServiceCardModel => m.kind === '3pl'),
      () => null,
    ),
    sb.from('warehouses').select('code, name, city').eq('status', 'active').order('is_default', { ascending: false }).order('name'),
  ]);
  const s = viewer.session;
  return (
    <WarehouseServicesView
      view={view}
      quote={quote}
      services={items ?? []}
      error={!items}
      isClient={serviceOn(viewer.services.warehouse)}
      defaults={{ company: viewer.org.name, contactName: s.profile?.full_name ?? '', email: s.email ?? '', phone: s.profile?.phone ?? '', country: viewer.org.country ?? '' }}
      warehouses={(wh.data ?? []) as { code: string; name: string; city: string }[]}
      submit={submitApplicationAction}
    />
  );
}
