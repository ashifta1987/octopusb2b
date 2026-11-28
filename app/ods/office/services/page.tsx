// ODS T9 · Service requests (Part 7.6 list + drawer). Replaces the T8 re-export of app/office/services/page.tsx.
// Same guard (requireStaff('requests','view')), same division scope, same query + filters (?f, ?type, ?r), same buttons
// (requests:edit) calling today's transitionService unchanged. Owner = assigned_to (hidden column, read with the service
// role after the guard through withHiddenColumns, as today's pages do). Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { one } from '@/components/backoffice/server-utils';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { getDivisionScope } from '@/lib/divisions/scope';
import { transitionService } from '@/app/office/actions';
import { SERVICE_FILTERS, detailsList, detailsSummary, serviceTab, type ServiceRow } from './_lib/services-core';
import { ServicesQueue } from './_components/services-queue';
import { SalesPageHead } from '../_components/sales-bits';

export const metadata = { title: 'Service requests' };

type SP = Promise<{ f?: string; r?: string; type?: string }>;

export default function OfficeServicesPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead
        crumbs={[{ label: 'Sales' }, { label: 'Service requests' }]}
        title="Service requests"
        subtitle="Samples, QC, certification, 3PL, dropship and sourcing requests. Move each through its workflow; rejecting a wallet-paid request refunds the fee."
      />
      <Suspense fallback={<ServicesQueue rows={[]} tab="open" type={null} types={[]} canEdit={false} transition={transitionService} base="/office/services" loading sample />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('requests', 'view', '/office/services');
  const scope = await getDivisionScope(s);
  const { f, r: highlight, type } = await searchParams;
  const tab = serviceTab(f);
  const sb = await createClient();
  let q = sb.from('service_requests')
    .select('id, code, service_code, status, details, fee_minor, currency, paid_via, created_at, updated_at, organizations(name, country, city), products(title), services(name)')
    .in('status', SERVICE_FILTERS[tab]).order('created_at').limit(200);
  if (type) q = q.eq('service_code', type);
  if (!scope.all) q = q.eq('division_id', scope.division.id);
  const [{ data, error }, { data: services }] = await Promise.all([q, sb.from('services').select('code, name').order('sort')]);
  const withOwner = await withHiddenColumns<Record<string, unknown>, { assigned_to: string | null }>('service_requests', (data ?? []) as Record<string, unknown>[], 'assigned_to').catch(() => null);
  const ownerOf = new Map((withOwner ?? []).map((x) => [x.id as string, x.assigned_to]));
  const ids = [...new Set([...ownerOf.values()].filter(Boolean))] as string[];
  const { data: ppl } = ids.length ? await sb.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] };
  const person = new Map((ppl ?? []).map((p) => [p.id as string, ((p.full_name as string | null) || (p.email as string | null) || 'Staff') as string]));

  const rows: ServiceRow[] = (data ?? []).map((x) => {
    const o = one(x.organizations as unknown as { name: string; country: string | null; city: string | null } | null);
    const details = x.details as Record<string, unknown> | null;
    const owner = ownerOf.get(x.id as string);
    return {
      id: x.id as string,
      code: x.code as string,
      serviceCode: x.service_code as string,
      type: one(x.services as unknown as { name: string } | null)?.name ?? (x.service_code as string),
      customer: o?.name ?? null,
      place: [o?.city, o?.country].filter(Boolean).join(', '),
      product: one(x.products as unknown as { title: string } | null)?.title ?? null,
      summary: detailsSummary(details),
      details: detailsList(details),
      feeMinor: Number(x.fee_minor ?? 0),
      currency: (x.currency as string | null) ?? 'USD',
      paidVia: (x.paid_via as string | null) ?? null,
      status: x.status as string,
      createdAt: x.created_at as string,
      updatedAt: (x.updated_at as string | null) ?? null,
      owner: owner ? person.get(owner) ?? 'Staff' : null,
    };
  });
  return (
    <ServicesQueue
      rows={rows}
      tab={tab}
      type={type ?? null}
      types={(services ?? []).map((t) => ({ code: t.code as string, name: t.name as string }))}
      canEdit={can(s, 'requests', 'edit')}
      transition={transitionService}
      base="/office/services"
      highlight={highlight ?? null}
      error={!!error}
    />
  );
}
