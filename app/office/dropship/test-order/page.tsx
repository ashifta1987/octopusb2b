import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { DsSkeleton } from '@/components/dropship-ui';
import { isStaging } from '@/lib/core/account';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { TestOrderClient } from './test-order-client';

export const metadata = { title: 'Test order (staging) · Back office' };

/**
 * Release 3 · Step 7/8 — STAGING ONLY. Dropship staff with edit rights create a store order for a merchant through the SAME
 * intake the store webhook will use (ds_test_order_create → ds_order_intake_core, channel "manual", flagged as a test), so
 * Orders, holds, payment and the warehouse handoff can be checked before the Shopify connection exists. 404 on live; the
 * RPC refuses outside staging too.
 */
async function Guarded() {
  if (!isStaging()) notFound();
  await requireDropshipV2Staff(true, '/office/dropship/test-order');
  const sb = await createClient();
  const { data } = await sb.rpc('list_dropship_merchants_staff');
  const merchants = (((data ?? {}) as { merchants?: { org_id: string; org_name: string; dropship_status: string }[] }).merchants ?? [])
    .map((m) => ({ id: m.org_id, name: m.org_name, status: m.dropship_status }));
  return <TestOrderClient merchants={merchants} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
