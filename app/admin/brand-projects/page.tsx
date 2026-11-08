import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, StatusBadge, EmptyState } from '@/components/ui';
import { Loading } from '@/components/admin/ui';
import { fmtDate } from '@/lib/format';
import { BRAND_METHOD, BRAND_PACK, BRAND_STATUS_LABEL, BRAND_STEPS, BRAND_TONE, brandDestination as destination, type BrandRow } from '@/lib/brand-projects';

export const metadata = { title: 'Brand projects' };

/** Admin › Brand projects (bug 2, 8 Nov 2026): every Make My Brand request, newest first, filter by status. */
async function BrandProjects({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffOrManager('/admin/brand-projects', ['customers', 'view']);
  const sp = await searchParams;
  const status = sp.status && (BRAND_STEPS as readonly string[]).concat('closed').includes(sp.status) ? sp.status : null;
  const sb = await createClient();
  const { data, error } = await sb.rpc('admin_brand_projects', { p_id: null, p_status: status });
  if (error) throw new Error(`Could not load brand projects: ${error.message}`);
  const rows = (data ?? []) as BrandRow[];
  const chip = (key: string | null, label: string) => (
    <Link key={label} href={key ? `/admin/brand-projects?status=${key}` : '/admin/brand-projects'} aria-current={status === key ? 'page' : undefined}
      className={`px-4 py-2 rounded-full text-sm font-semibold ${status === key ? 'bg-ink text-white' : 'bg-white border border-line text-ink hover:border-ink'}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Brand projects" subtitle="Make My Brand requests from customers (MB-…). The account manager is the customer's own; change it on the customer record." />
      <nav className="flex flex-wrap gap-2 mb-5" aria-label="Filter by status">{chip(null, 'All')}{[...BRAND_STEPS, 'closed'].map((s) => chip(s, BRAND_STATUS_LABEL[s]))}</nav>
      <Card>
        <Table head={['Number', 'Customer', 'Product', 'Qty', 'Branding · packaging', 'Stock goes to', 'Logos', 'Status', 'Account manager', 'Submitted']}
          empty={<EmptyState title={status ? 'No projects with this status' : 'No brand projects yet'} body="New Make My Brand requests appear here as soon as a customer submits them." />}>
          {rows.map((r) => (
            <tr key={r.id} data-testid="brand-row">
              <td className="td"><Link href={`/admin/brand-projects/${r.id}`} className="mono font-bold text-ink hover:underline whitespace-nowrap">{r.ref}</Link></td>
              <td className="td"><Link href={`/admin/customers/${r.org_id}`} className="hover:underline">{r.company}</Link></td>
              <td className="td text-sm min-w-[200px] max-w-[280px]">{r.product_title ?? (r.product_link ? <span className="break-all">{r.product_link}</span> : '—')}</td>
              <td className="td text-sm">{r.quantity ? r.quantity.toLocaleString('en-US') : '—'}</td>
              <td className="td text-sm">{[BRAND_METHOD[r.method ?? ''], BRAND_PACK[r.packaging ?? '']].filter(Boolean).join(' · ') || '—'}</td>
              <td className="td text-sm">{destination(r)}</td>
              <td className="td text-sm">{r.logo_paths.length || '—'}</td>
              <td className="td"><StatusBadge status={r.status} label={BRAND_STATUS_LABEL[r.status] ?? r.status} tone={BRAND_TONE[r.status]} /></td>
              <td className="td text-sm">{r.manager_name ?? <span className="text-bad font-semibold" data-testid="unassigned">Unassigned</span>}</td>
              <td className="td text-sm text-muted whitespace-nowrap">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return <Suspense fallback={<Loading />}><BrandProjects searchParams={searchParams} /></Suspense>;
}
