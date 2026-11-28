// ODS T9 · Back Office › Services › Make My Brand projects (Part 7.6 list pattern). Replaces the T8 re-export of
// app/admin/brand-projects/page.tsx inside the ODS Back Office frame. Same guard as today
// (requireStaffOrManager(…, ['customers','view']) — account managers see their own customers through the RPC), same
// division rule (all or MMB), same RPC admin_brand_projects() (read once with every status; tabs filter, ?status= kept).
// Switch off → today's page.
import { Suspense } from 'react';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDivisionScope } from '@/lib/divisions/scope';
import type { BrandRow } from '@/lib/brand-projects';
import { BrandListScreen } from './_components/brand-list';
import { BRAND_PATH, brandCounts, parseBrandTab } from './_lib/brand-core';

export const metadata = { title: 'Brand projects' };

type SP = Promise<Record<string, string | string[] | undefined>>;

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaffOrManager(BRAND_PATH, ['customers', 'view']);
  const scope = await getDivisionScope(s); // divisions step 4: brand projects are all Make My Brand (as today)
  const tab = parseBrandTab(await searchParams);
  const sb = await createClient();
  const { data, error } = await sb.rpc('admin_brand_projects', { p_id: null, p_status: null });
  if (error) return <BrandListScreen tab={tab} result={{ kind: 'error', error: 'We couldn’t load the brand projects. Try again.' }} />;
  const rows = (scope.all || scope.division.code === 'MMB' ? (data ?? []) : []) as BrandRow[];
  return <BrandListScreen tab={tab} result={{ kind: 'ok', rows, counts: brandCounts(rows) }} />;
}

export default function OdsBrandProjectsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<BrandListScreen tab="all" result={{ kind: 'loading' }} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
