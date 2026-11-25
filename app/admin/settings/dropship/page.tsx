import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { PageHeader, Notice } from '@/components/ui';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { DropshipFeaturesClient } from './features-client';

export const metadata = { title: 'Dropship features' };

/**
 * Release 1 · EA-2 — Admin › Dropship features. One switch per merchant feature (site_settings.dropship_features).
 * OFF = hidden from the merchant menu and phone tabs; the route goes back to the dashboard. Audit-logged.
 * Rollback for the early-access launch is the dropship_v2_ui flag, not this list.
 */
async function Content() {
  const s = await requireStaff('staff', 'view', '/admin/settings/dropship');
  const features = await getDropshipFeatures();
  return (
    <div className="max-w-[760px] flex flex-col gap-5">
      <PageHeader title="Dropship features" subtitle="Turn merchant features on as each step ships. Off features are hidden from merchants and their pages go back to the dashboard." />
      {!s.isAdmin && <Notice tone="amber">Only an admin can change these switches.</Notice>}
      <DropshipFeaturesClient initial={features} canEdit={s.isAdmin} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6">Loading…</div>}>
      <Content />
    </Suspense>
  );
}
