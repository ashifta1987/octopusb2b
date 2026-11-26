import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { AsnDetail } from '@/lib/warehouse-inbound';
import { WhHeader } from '../../wh-header';
import { ReceiveClient } from './receive-client';

export const metadata = { title: 'Receive · Warehouse' };

/** Warehouse OS board 5 — handheld receiving: count each line against the notice; a difference needs a second count. */
async function Content({ params }: { params: Promise<{ asn: string }> }) {
  const { asn } = await params;
  const ref = decodeURIComponent(asn);
  const access = await requireWarehouseStaff(`/office/warehouse/receive/${encodeURIComponent(ref)}`);
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_asn_detail', { p_ref: ref });
  if (error) {
    if (/NOT_FOUND/.test(error.message)) notFound();
    throw new Error(`Could not load the stock notice: ${error.message}`);
  }
  const d = data as AsnDetail;
  const wh = access.warehouses.find((w) => w.code === d.asn.warehouse_code);
  return (
    <div className="flex flex-col gap-4" data-testid="wh-receive-page">
      <WhHeader access={access} title={`Receive ${d.asn.code}`} icon="download"
        subtitle={`${d.asn.org_name ?? 'Octopus stock'} · ${wh?.name ?? d.asn.warehouse_code}. Count every line; a difference is recounted by someone else.`} />
      <ReceiveClient detail={d} />
    </div>
  );
}

export default function Page(props: { params: Promise<{ asn: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
