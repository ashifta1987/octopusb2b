import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { EXCEPTION_KINDS, type ExceptionKind, type ExceptionsBoard } from '@/lib/warehouse-w3b';
import { WhHeader } from '../wh-header';
import { ExceptionsClient } from './exceptions-client';

export const metadata = { title: 'Exceptions · Warehouse' };

/**
 * Warehouse OS board 29 — exceptions: one queue of weight, receiving, label, stock, carrier and short-pick problems. Raised
 * automatically when an order stops (short pick, weight override locked) or a lot is blocked at receiving, or reported by hand.
 * A supervisor assigns an owner and records the resolution, then releases the order (or lot) back to the right step.
 */
async function Content({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/exceptions');
  const sp = await searchParams;
  const status = ['open', 'resolved', 'all'].includes(sp.status ?? '') ? sp.status! : 'open';
  const kind = (EXCEPTION_KINDS as readonly string[]).includes(sp.kind ?? '') ? (sp.kind as ExceptionKind) : null;
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_exceptions_board', { p_warehouse: access.current?.code ?? null, p_status: status, p_kind: kind });
  if (error) throw new Error(`Could not load exceptions: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-exceptions-page">
      <WhHeader access={access} title="Exceptions" icon="alert"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · weight, receiving, label, stock and carrier problems. Assign an owner, record the resolution, release the order.`} />
      <ExceptionsClient board={data as ExceptionsBoard} status={status} kind={kind} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
