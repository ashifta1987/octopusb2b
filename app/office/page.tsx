import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, EmptyState } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Request time (server components render per request after the session read). */
const nowMs = () => Date.now();

export const metadata = { title: 'Queues' };

function age(d: string) {
  const h = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 36e5));
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}
function dueIn(d: string | null) {
  if (!d) return '—';
  const h = Math.round((new Date(d).getTime() - Date.now()) / 36e5);
  return h < 0 ? `Overdue ${-h} h` : `${h} h left`;
}

type Item = { id: string; href: string; ref: string; title: string; sub: string; at: string; status: string; flag?: boolean };

export default async function OfficeQueues() {
  const s = await requireStaff('dashboard', 'view', '/office');
  const sb = await createClient();
  const soon = new Date(nowMs() + 4 * 36e5).toISOString();
  const [kyc, prods, rfqs, srv, ships, tickets] = await Promise.all([
    can(s, 'customers') ? sb.from('kyc_submissions').select('id, company_name, status, submitted_at, organizations(name, country)', { count: 'exact' }).in('status', ['submitted', 'in_review']).order('submitted_at').limit(6) : null,
    can(s, 'products', 'approve') ? sb.from('products').select('id, title, status, updated_at, suppliers!products_supplier_id_fkey(code)', { count: 'exact' }).in('status', ['submitted', 'in_review']).order('updated_at').limit(6) : null,
    can(s, 'requests') ? sb.from('rfqs').select('id, code, title, quantity, unit, status, created_at, destination_country', { count: 'exact' }).eq('status', 'submitted').order('created_at').limit(6) : null,
    can(s, 'requests') ? sb.from('service_requests').select('id, code, service_code, status, created_at, organizations(name, country)', { count: 'exact' }).in('status', ['requested', 'paid']).order('created_at').limit(6) : null,
    can(s, 'orders') ? sb.from('shipments').select('id, code, tracking_no, status, last_event_at, created_at, orders(code)', { count: 'exact' }).eq('status', 'exception').order('last_event_at').limit(6) : null,
    can(s, 'support') ? sb.from('tickets').select('id, code, subject, priority, status, sla_due_at', { count: 'exact' }).lt('sla_due_at', soon).not('status', 'in', '(resolved,closed)').order('sla_due_at').limit(6) : null,
  ]);

  const queues: { key: string; title: string; href: string; count: number | null; items: Item[]; hint?: string; hide: boolean }[] = [
    {
      key: 'kyc', title: 'KYC to review', href: '/office/kyc', hide: !kyc, count: kyc?.count ?? 0,
      items: (kyc?.data ?? []).map((k) => { const o = one(k.organizations as unknown as { name: string; country: string | null } | null); return { id: k.id, href: `/office/kyc/${k.id}`, ref: o?.country ?? '', title: k.company_name ?? o?.name ?? 'Company', sub: `waiting ${age(k.submitted_at)}`, at: k.submitted_at, status: k.status, flag: nowMs() - new Date(k.submitted_at).getTime() > 48 * 36e5 }; }),
    },
    {
      key: 'prod', title: 'Products to moderate', href: '/office/products', hide: !prods, count: prods?.count ?? 0,
      items: (prods?.data ?? []).map((p) => ({ id: p.id, href: `/office/products?p=${p.id}`, ref: one(p.suppliers as unknown as { code: string } | null)?.code ?? '', title: p.title, sub: `waiting ${age(p.updated_at)}`, at: p.updated_at, status: p.status })),
    },
    {
      key: 'rfq', title: 'RFQs to quote', href: '/office/rfqs', hide: !rfqs, count: rfqs?.count ?? 0,
      items: (rfqs?.data ?? []).map((r) => ({ id: r.id, href: `/office/rfqs/${r.id}`, ref: r.code, title: r.title, sub: `${r.quantity} ${r.unit} · ${r.destination_country ?? '—'} · ${age(r.created_at)}`, at: r.created_at, status: r.status, flag: nowMs() - new Date(r.created_at).getTime() > 48 * 36e5 })),
    },
    {
      key: 'srv', title: 'Service requests', href: '/office/services', hide: !srv, count: srv?.count ?? 0,
      items: (srv?.data ?? []).map((r) => { const o = one(r.organizations as unknown as { name: string; country: string | null } | null); return { id: r.id, href: `/office/services?r=${r.id}`, ref: r.code, title: `${humanize(r.service_code)} · ${o?.name ?? ''}`, sub: `${o?.country ?? ''} · ${age(r.created_at)}`, at: r.created_at, status: r.status }; }),
    },
    {
      key: 'ship', title: 'Shipments with exceptions', href: '/office/shipping', hide: !ships, count: ships?.count ?? 0,
      items: (ships?.data ?? []).map((x) => ({ id: x.id, href: '/office/shipping', ref: x.code, title: `${one(x.orders as unknown as { code: string } | null)?.code ?? ''} · ${x.tracking_no ?? ''}`, sub: `last event ${fmtDate(x.last_event_at ?? x.created_at, true)}`, at: x.created_at, status: x.status, flag: true })),
    },
    {
      key: 'tk', title: 'Tickets near SLA', href: '/office/support', hide: !tickets, count: tickets?.count ?? 0,
      items: (tickets?.data ?? []).map((t) => ({ id: t.id, href: `/office/support?t=${t.id}`, ref: t.code, title: t.subject, sub: `${humanize(t.priority)} · ${dueIn(t.sla_due_at)}`, at: t.sla_due_at ?? '', status: t.status, flag: !!t.sla_due_at && new Date(t.sla_due_at).getTime() < nowMs() })),
    },
  ];
  const visible = queues.filter((q) => !q.hide);

  return (
    <>
      <PageHeader title="Today's queues" subtitle="Work the oldest items first. Anything over 48 h or past its SLA is flagged." />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {visible.map((q) => {
          const flagged = q.items.filter((i) => i.flag).length;
          return (
            <Link key={q.key} href={q.href} className={cn('card p-5 hover:border-blue', flagged > 0 && 'border-bad/50')}>
              <div className="text-sm text-muted">{q.title}</div>
              <div className="mt-2 font-display text-[28px] font-bold leading-tight text-navy">{q.count ?? 0}</div>
              <div className={cn('mt-1 text-sm', flagged ? 'text-bad font-semibold' : 'text-muted')}>{flagged ? `${flagged} flagged` : q.items[0] ? `Oldest ${age(q.items[0].at || new Date().toISOString())}` : 'All clear'}</div>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {visible.map((q) => (
          <Card key={q.key} title={q.title} action={<Link href={q.href} className="text-sm font-semibold text-blue">Open queue →</Link>}>
            {q.items.length === 0 ? <EmptyState title="Nothing waiting" body="This queue is clear." /> : (
              <ul className="divide-y divide-line border-t border-line">
                {q.items.map((i) => (
                  <li key={i.id}>
                    <Link href={i.href} className="flex items-center gap-3 px-6 py-3 hover:bg-surface">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{i.title}</div>
                        <div className={cn('text-sm', i.flag ? 'text-bad' : 'text-muted')}>{i.flag && <span className="sr-only">Flagged: </span>}{i.sub}</div>
                      </div>
                      {i.ref && <span className="mono text-xs text-muted">{i.ref}</span>}
                      <StatusBadge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
