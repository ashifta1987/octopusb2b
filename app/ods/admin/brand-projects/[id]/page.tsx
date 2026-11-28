// ODS T9 · Back Office › Services › Brand project record (Part 7.6 record pattern). Replaces the T8 re-export of
// app/admin/brand-projects/[id]/page.tsx inside the ODS Back Office frame. Same guard as today
// (requireStaffOrManager(…, ['customers','view'])), same reads (admin_brand_projects + brand_project_history RPCs,
// 10-minute signed logo links with the staff session), same status control (today's BrandStatusControls →
// setBrandProjectStatus → set_brand_project_status) shown in a drawer. Switch off → today's page.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireStaffOrManager } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { brandMoves, type BrandRow } from '@/lib/brand-projects';
import { BrandStatusControls } from '@/app/admin/brand-projects/status-controls';
import { Card } from '@octopus/ui';
import { BrandHeader, BrandHistory, BrandLogos, BrandOverview, BrandRecordView, type HistoryRow } from '../_components/brand-record';
import { BrandStatusDrawer } from '../_components/status-drawer';
import { isBrandRecordTab, type BrandRecordTab } from '../_lib/brand-core';

export const metadata = { title: 'Brand project' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OdsBrandProjectPage(props: Props) {
  return (
    <Suspense fallback={<Card title="Loading the project…" headingLevel={2} loading />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Props) {
  const s = await requireStaffOrManager('/admin/brand-projects', ['customers', 'view']);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const [{ data }, hist] = await Promise.all([sb.rpc('admin_brand_projects', { p_id: id, p_status: null }), sb.rpc('brand_project_history', { p_id: id })]);
  const r = ((data ?? []) as BrandRow[])[0];
  if (!r) notFound(); // not a project, or another account manager's customer (as today)
  const signed: Record<string, string> = {};
  if (r.logo_paths.length) {
    const { data: urls } = await sb.storage.from('brand-logos').createSignedUrls(r.logo_paths, 600);
    (urls ?? []).forEach((u) => {
      if (u.path && u.signedUrl) signed[u.path] = u.signedUrl;
    });
  }
  const history = hist.error ? null : ((hist.data ?? []) as HistoryRow[]);
  const sp = await searchParams;
  const raw = first(sp.tab);
  const tab: BrandRecordTab = isBrandRecordTab(raw) ? raw : 'overview';
  return (
    <BrandRecordView
      tab={tab}
      counts={{ logos: r.logo_paths.length, history: history?.length ?? null }}
      header={
        <BrandHeader
          r={r}
          statusAction={
            <BrandStatusDrawer code={r.ref} paid={r.paid}>
              <BrandStatusControls id={r.id} moves={brandMoves(r, s.isAdmin)} paid={r.paid} isAdmin={s.isAdmin} />
            </BrandStatusDrawer>
          }
        />
      }
      panels={{ overview: <BrandOverview r={r} />, logos: <BrandLogos paths={r.logo_paths} signed={signed} />, history: <BrandHistory history={history} /> }}
    />
  );
}
