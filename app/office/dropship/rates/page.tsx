import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { RatesClient, type RateCard, type RateImport } from './rates-client';

export const metadata = { title: 'Shipping rates · Back office' };

const num = (v: unknown) => (v == null ? null : Number(v));

async function Guarded() {
  const access = await requireFeesRatesDutyStaff('/office/dropship/rates');
  // design v2 StaffRateCards: Support has no access to rate cards
  if (!access.canReadRates) redirect('/forbidden');
  const sb = await createClient();
  const [cardsRes, importsRes] = await Promise.all([
    sb.rpc('list_shipping_rate_cards', { p_include_inactive: true }),
    sb.rpc('list_rate_card_imports'),
  ]);
  if (cardsRes.error) throw new Error(`Could not load rate cards: ${cardsRes.error.message}`);
  if (importsRes.error) throw new Error(`Could not load price-list imports: ${importsRes.error.message}`);
  const cards = ((cardsRes.data ?? []) as RateCard[]).map((r) => ({
    ...r,
    base_cents: Number(r.base_cents),
    per_100g_cents: Number(r.per_100g_cents),
    volumetric_divisor: Number(r.volumetric_divisor),
    remote_area_fee_cents: num(r.remote_area_fee_cents),
    used_count: Number(r.used_count),
  }));
  const imports = (importsRes.data ?? []) as RateImport[];
  return (
    <div className="flex flex-col gap-5" data-testid="staff-rates-page">
      <DsPageHeader
        title="Shipping rates"
        subtitle="Carrier rate cards by country and service. A published card is never edited: publish a new version."
        icon="truck"
        actions={access.canEditRates ? (
          <>
            <a href="#import" className="ds-btn ds-btn-secondary">Import price list</a>
            <a href="#new-card" className="ds-btn ds-btn-primary">New rate card</a>
          </>
        ) : undefined}
      />
      <RatesClient cards={cards} imports={imports} access={{ userId: access.session.userId, canEditRates: access.canEditRates }} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
