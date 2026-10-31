import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Money } from '@/components/ui';
import { ReasonButton, RunButton } from '@/components/backoffice/action-form';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize } from '@/lib/format';
import { transitionService } from '../actions';

export const metadata = { title: 'Service requests' };

// mirrors transition_service_request()
const NEXT: Record<string, string[]> = {
  requested: ['paid', 'rejected'], paid: ['accepted', 'rejected'], accepted: ['in_progress'], in_progress: ['report_ready', 'completed'],
  report_ready: ['completed'], rejected: ['refunded'],
};
const FILTERS: Record<string, string[]> = {
  open: ['requested', 'paid', 'accepted', 'in_progress', 'report_ready'], done: ['completed'], rejected: ['rejected', 'refunded'],
};

export default async function OfficeServices({ searchParams }: { searchParams: Promise<{ f?: string; r?: string; type?: string }> }) {
  const s = await requireStaff('requests', 'view', '/office/services');
  const { f = 'open', r: highlight, type } = await searchParams;
  const sb = await createClient();
  let q = sb.from('service_requests')
    .select('id, code, service_code, status, details, fee_usd_cents, paid_via, created_at, updated_at, organizations(name, country, city), products(title), services(name)')
    .in('status', FILTERS[f] ?? FILTERS.open).order('created_at').limit(200);
  if (type) q = q.eq('service_code', type);
  const [{ data }, { data: services }] = await Promise.all([q, sb.from('services').select('code, name').order('sort')]);
  const canEdit = can(s, 'requests', 'edit');

  return (
    <>
      <PageHeader title="Service requests" subtitle="Samples, QC, certification, 3PL, dropship and sourcing requests. Move each through its workflow; rejecting a wallet-paid request refunds the fee." />
      <form className="flex flex-wrap gap-2 mb-4 items-center" role="search">
        {Object.keys(FILTERS).map((k) => <Link key={k} href={`/office/services?f=${k}${type ? `&type=${type}` : ''}`} aria-current={f === k ? 'page' : undefined} className={`btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}`}>{humanize(k)}</Link>)}
        <input type="hidden" name="f" value={f} />
        <label htmlFor="sv-type" className="sr-only">Service type</label>
        <select id="sv-type" name="type" defaultValue={type ?? ''} className="input w-auto min-h-9 text-sm ml-auto">
          <option value="">All types</option>
          {(services ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm">Apply</button>
      </form>
      <Card>
        <Table head={['Ref', 'Type', 'Customer', 'Details', 'Fee', 'Created', 'Status', 'Actions']} empty={<EmptyState title="No service requests here" />}>
          {(data ?? []).map((r) => {
            const o = one(r.organizations as unknown as { name: string; country: string | null; city: string | null } | null);
            const details = r.details as Record<string, unknown>;
            const summary = Object.entries(details ?? {}).filter(([, v]) => v != null && v !== '').slice(0, 4).map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
            return (
              <tr key={r.id} className={r.id === highlight ? 'bg-blue-soft' : undefined}>
                <td className="td mono text-sm">{r.code}</td>
                <td className="td"><span className="text-xs font-semibold rounded-full bg-blue-soft text-[#1E4F9C] px-2 py-1">{one(r.services as unknown as { name: string } | null)?.name ?? r.service_code}</span></td>
                <td className="td text-sm"><div className="font-semibold">{o?.name ?? '—'}</div><div className="text-xs text-muted">{[o?.city, o?.country].filter(Boolean).join(', ')}</div></td>
                <td className="td text-sm max-w-[320px]">{one(r.products as unknown as { title: string } | null)?.title && <div className="font-medium">{one(r.products as unknown as { title: string } | null)?.title}</div>}<div className="text-xs text-muted break-words">{summary || '—'}</div></td>
                <td className="td"><Money cents={r.fee_usd_cents} /><div className="text-xs text-muted">{r.paid_via}</div></td>
                <td className="td text-sm">{fmtDate(r.created_at)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td">
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      {(NEXT[r.status] ?? []).map((to) => to === 'rejected'
                        ? <ReasonButton key={to} action={transitionService.bind(null, r.id, to)} label="Reject" title={`Reject ${r.code}`} placeholder={r.paid_via === 'wallet' ? 'Reason (fee is refunded to the wallet)' : 'Reason'} className="btn btn-ghost btn-sm text-bad" danger confirmLabel="Reject" />
                        : <RunButton key={to} className={to === 'completed' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} action={transitionService.bind(null, r.id, to, '')}
                          confirm={to === 'paid' ? `Mark ${r.code} as paid (invoice settled)?` : to === 'refunded' ? `Mark ${r.code} as refunded?` : undefined}>{humanize(to)}</RunButton>)}
                      {!(NEXT[r.status] ?? []).length && <span className="text-xs text-muted">No actions</span>}
                    </div>
                  ) : <span className="text-xs text-muted">View only</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
