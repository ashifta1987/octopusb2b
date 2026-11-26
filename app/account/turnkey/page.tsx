import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate } from '@/lib/format';
import { phaseLabel, tkStatus } from '@/lib/turnkey/format';

export const metadata = { title: 'My turnkey projects' };

type Row = { code: string; title: string; stage: string; status: string; created_at: string; stage_changed_at: string };

/**
 * Customer portal → My turnkey projects (Turnkey T2, design ClientPortal): the company's projects and their phase.
 * Requests sent with the earlier Turnkey form were moved into projects at "Enquiry"; ones sent as a guest join the
 * company here, matched by this account's verified email (tk_link_legacy_projects).
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
  const { data } = await sb.from('tk_client_projects').select('code, title, stage, status, created_at, stage_changed_at').order('created_at', { ascending: false }).limit(200);
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title="My turnkey projects" subtitle="Every project moves through 8 phases. The enquiry is free; each paid phase starts after your payment is confirmed."
        actions={<Link href="/account/turnkey/new" className="btn btn-primary" data-testid="tk-new-project">Start a new project</Link>} />
      <Card>
        <Table head={['Project', 'Phase', 'Status', 'Since', 'Started']}
          empty={<EmptyState title="No turnkey projects yet" body="Pick a project from the catalogue or tell us what you want to open. The enquiry is free."
            action={<Link href="/turnkey" className="btn btn-primary btn-sm">Browse Turnkey Projects</Link>} />}>
          {rows.map((r) => (
            <tr key={r.code} data-testid={`tk-row-${r.code}`}>
              <td className="td">
                <Link href={`/account/turnkey/${r.code}`} className="font-semibold hover:text-coral-text">{r.title}</Link>
                <div className="mono text-xs text-muted">{r.code}</div>
              </td>
              <td className="td text-sm">{phaseLabel(r.stage)}</td>
              <td className="td"><StatusBadge status={r.status} label={tkStatus(r.status).label} tone={tkStatus(r.status).tone} /></td>
              <td className="td text-sm">{fmtDate(r.stage_changed_at)}</td>
              <td className="td text-sm text-muted">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
