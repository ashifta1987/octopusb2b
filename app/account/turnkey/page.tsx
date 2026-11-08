import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'My turnkey projects' };

/** Customer portal → My turnkey projects (ADDON-31 §7): the user's quote and interest requests.
 *  Matches requests sent while signed in, and ones sent as a guest with the same (verified) account email. */
export default async function MyTurnkeyPage() {
  const s = await requireCustomer('/account/turnkey');
  const email = (s.email ?? '').toLowerCase();
  const filter = email && /^[^@\s,()]+@[^@\s,()]+$/.test(email) ? `buyer_user_id.eq.${s.userId},email.eq.${email}` : `buyer_user_id.eq.${s.userId}`;
  const { data } = await createAdminClient().from('turnkey_leads')
    .select('lead_id, reference, kind, status, created_at, target_open_date, project_id, turnkey_projects(title), turnkey_packages(tier_name)')
    .or(filter).order('created_at', { ascending: false }).limit(100);
  return (
    <>
      <PageHeader title="My turnkey projects" subtitle="Quote requests and register-interest signals you sent from Turnkey Projects."
        actions={<Link href="/turnkey" className="btn btn-primary">Browse Turnkey Projects</Link>} />
      <Card>
        <Table head={['Reference', 'Project', 'Type', 'Status', 'Target opening', 'Sent']}
          empty={<EmptyState title="No turnkey requests yet" body="Open a complete business shipped in one container — gym, laundry, water bottling and more." action={<Link href="/turnkey/atlas" className="btn btn-primary btn-sm">See the Atlas</Link>} />}>
          {(data ?? []).map((l) => {
            const proj = (Array.isArray(l.turnkey_projects) ? l.turnkey_projects[0] : l.turnkey_projects) as { title: string } | null;
            const pkg = (Array.isArray(l.turnkey_packages) ? l.turnkey_packages[0] : l.turnkey_packages) as { tier_name: string } | null;
            return (
              <tr key={l.lead_id as string}>
                <td className="td mono text-sm"><Link href={`/turnkey/confirmation/${l.lead_id}`} className="text-coral-text hover:underline">{l.reference as string}</Link></td>
                <td className="td font-semibold"><Link href={`/turnkey/${l.project_id}`} className="hover:text-coral-text">{proj?.title}</Link>{pkg && <div className="text-xs text-muted">{pkg.tier_name} package</div>}</td>
                <td className="td text-sm">{l.kind === 'quote' ? 'Quote request' : 'Interest'}</td>
                <td className="td"><StatusBadge status={l.status as string} /></td>
                <td className="td text-sm">{l.target_open_date ? fmtDate(l.target_open_date as string) : '—'}</td>
                <td className="td text-sm text-muted">{fmtDate(l.created_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

