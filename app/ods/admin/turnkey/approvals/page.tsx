// ODS T9 · /admin/turnkey/approvals (Fee approvals). Replaces the T8 re-export. Same guard (requireStaff('turnkey','view') and
// admins only → /forbidden), same RPCs (tk_list_fee_approvals 30, tk_list_inspection_fee_approvals, tk_list_trip_fee_approvals),
// same decision components (two-person: the proposer can't approve; the database refuses too).
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import { Skeleton } from '@octopus/ui';
import { ApprovalsView, type FeeApprovalRow, type InspApprovalRow, type TripApprovalRow } from '../_components/approvals-view';

export const metadata = { title: 'Turnkey fee approvals' };

export default function TurnkeyApprovalsPage() {
  return (
    <Suspense fallback={<Skeleton lines={8} label="Loading fee approvals" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/approvals');
  if (!s.isAdmin) redirect('/forbidden');
  const sb = await createClient();
  const [{ data, error }, { data: insp }, { data: trip }] = await Promise.all([sb.rpc('tk_list_fee_approvals', { p_decided_limit: 30 }), sb.rpc('tk_list_inspection_fee_approvals'), sb.rpc('tk_list_trip_fee_approvals')]);
  const trips = ((trip ?? []) as TripApprovalRow[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starting_cents: Number(r.starting_cents) }));
  const inspRows = ((insp ?? []) as InspApprovalRow[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starting_cents: r.starting_cents == null ? null : Number(r.starting_cents) }));
  const rows = ((data ?? []) as FeeApprovalRow[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starting_cents: r.starting_cents == null ? null : Number(r.starting_cents), active_cents: r.active_cents == null ? null : Number(r.active_cents) }));
  return <ApprovalsView userId={s.userId} rows={rows} insp={inspRows} trips={trips} error={!!error} money={(c, cur) => money(c, cur)} />;
}
