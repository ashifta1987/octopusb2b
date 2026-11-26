import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate } from '@/lib/format';
import { phaseLabel, tkStatus } from '@/lib/turnkey/format';

export const metadata = { title: 'My turnkey projects' };

type Row = { code: string; title: string; stage: string; status: string; status_reason: string | null; created_at: string; stage_changed_at: string };
type Due = { data: { ref?: string } | null; amount_cents: number; paid_cents: number; status: string | null };

/**
 * Customer portal → My turnkey projects (Turnkey T2, design ClientPortal): the company's projects and their phase.
 * Requests sent with the earlier Turnkey form were moved into projects at "Enquiry"; ones sent as a guest join the
 * company here, matched by this account's verified email (tk_link_legacy_projects).
 * T7 (design "States": empty, error and waiting states): each row says what it is waiting for — your payment (an unpaid
 * Turnkey proforma), or the reason it is on hold / cancelled.
 */
export default function MyTurnkeyPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={0} />}>
      <MyTurnkeyProjects />
    </Suspense>
  );
}

async function MyTurnkeyProjects() {
  const s = await requireCustomer('/account/turnkey');
  const sb = await createClient();
  if (s.org) await sb.rpc('tk_link_legacy_projects', { p_org: s.org.id });
  const [{ data }, { data: dues }] = await Promise.all([
    sb.from('tk_client_projects').select('code, title, stage, status, status_reason, created_at, stage_changed_at').order('created_at', { ascending: false }).limit(200),
    sb.from('documents').select('data, amount_cents, paid_cents, status').eq('doc_type', 'proforma_invoice').eq('data->>service', 'turnkey').in('status', ['awaiting_payment', 'part_paid']).limit(500),
  ]);
  const rows = (data ?? []) as Row[];
  const toPay = new Map<string, number>();
  for (const d of (dues ?? []) as Due[]) {
    const ref = d.data?.ref;
    if (ref && Number(d.paid_cents) < Number(d.amount_cents)) toPay.set(ref, (toPay.get(ref) ?? 0) + 1);
  }
  return (
    <>
      <PageHeader title="My turnkey projects" subtitle="Every project moves through 8 phases. The enquiry is free; each paid phase starts after your payment is confirmed."
        actions={<Link href="/account/turnkey/new" className="btn btn-primary" data-testid="tk-new-project">Start a new project</Link>} />
      <Card>
        <Table head={['Project', 'Phase', 'Status', 'Since', 'Started']}
          empty={<EmptyState title="No turnkey projects yet" body="Pick a project from the catalogue or tell us what you want to open. The enquiry is free."
            action={<Link href="/turnkey/catalogue" className="btn btn-primary btn-sm">Browse Turnkey Projects</Link>} />}>
          {rows.map((r) => (
            <tr key={r.code} data-testid={`tk-row-${r.code}`}>
              <td className="td">
                <Link href={`/account/turnkey/${r.code}`} className="font-semibold hover:text-coral-text">{r.title}</Link>
                <div className="mono text-xs text-muted">{r.code}</div>
              </td>
              <td className="td text-sm">{phaseLabel(r.stage)}</td>
              <td className="td">
                <StatusBadge status={r.status} label={tkStatus(r.status).label} tone={tkStatus(r.status).tone} />
                {(r.status === 'on_hold' || r.status === 'cancelled') && r.status_reason && <div className="text-[12.5px] text-muted mt-1">{r.status_reason}</div>}
                {r.status !== 'cancelled' && toPay.get(r.code) ? (
                  <div className="text-[12.5px] font-semibold text-warn mt-1" data-testid={`tk-row-to-pay-${r.code}`}>Waiting for your payment ({toPay.get(r.code)} to pay)</div>
                ) : null}
              </td>
              <td className="td text-sm">{fmtDate(r.stage_changed_at)}</td>
              <td className="td text-sm text-muted">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
