import { Suspense } from 'react';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { FeesClient, type FeeVersion } from './fees-client';
import { MarkupCard, type MarkupPage } from './markup-card';

export const metadata = { title: 'Fees and plans · Back office' };

const num = (v: unknown) => (v == null ? null : Number(v));

async function Guarded() {
  const access = await requireFeesRatesDutyStaff('/office/dropship/fees');
  const sb = await createClient();
  const [feesRes, markupRes] = await Promise.all([sb.rpc('list_fee_versions'), sb.rpc('ds16_markup_page')]);
  if (feesRes.error) throw new Error(`Could not load fee versions: ${feesRes.error.message}`);
  if (markupRes.error) throw new Error(`Could not load the shipping markup: ${markupRes.error.message}`);
  const markup = markupRes.data as MarkupPage;
  const fees = ((feesRes.data ?? []) as FeeVersion[]).map((f) => ({
    ...f,
    pick_pack_first_cents: Number(f.pick_pack_first_cents),
    pick_pack_extra_cents: Number(f.pick_pack_extra_cents),
    packaging_cents: Number(f.packaging_cents),
    storage_per_cbm_day_cents: Number(f.storage_per_cbm_day_cents),
    return_handling_cents: Number(f.return_handling_cents),
    branded_packaging_cents: num(f.branded_packaging_cents),
    weigh_tolerance_pct: num(f.weigh_tolerance_pct),
  }));
  return (
    <div className="flex flex-col gap-5" data-testid="staff-fees-page">
      <DsPageHeader
        title="Fees and plans"
        subtitle="Fees merchants pay, internal charges between divisions, and plan limits. Changes are versioned and need a second approver."
        icon="percent"
        actions={access.canProposeFee ? <a href="#propose" className="ds-btn ds-btn-primary">Propose changes</a> : undefined}
      />
      <MarkupCard page={{ ...markup, pct: markup.pct == null ? null : Number(markup.pct) }} />
      <FeesClient
        fees={fees}
        access={{ userId: access.session.userId, canProposeFee: access.canProposeFee, canApproveFee: access.canApproveFee, readOnly: access.readOnly }}
      />
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
