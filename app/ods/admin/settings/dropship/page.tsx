// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { DropshipFeaturesClient } from '@/app/admin/settings/dropship/features-client';
import { SettingsShell } from '@/app/ods/office/_components/admin-c-company';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';

/**
 * ODS T9 · /admin/settings/dropship. Guard as today: requireStaff('staff','view'); only an admin can change the switches
 * (TODAY's DropshipFeaturesClient + saveDropshipFeaturesAction, audit-logged), inside the ODS page.
 */
export const metadata: Metadata = { title: 'Dropship features' };

export default function OdsDropshipSettingsPage() {
  return (
    <Suspense fallback={<PanelSkeleton title="Dropship features" testId="settings-dropship-page" lines={6} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('staff', 'view', '/admin/settings/dropship');
  const features = await getDropshipFeatures();
  return (
    <SettingsShell crumb="Admin › Dropship features" title="Dropship features" testId="settings-dropship-page"
      sub="Turn merchant features on as each step ships. Off features are hidden from merchants and their pages go back to the dashboard."
      notice={s.isAdmin ? undefined : 'Only an admin can change these switches.'}>
      <div className="max-w-[760px]">
        <DropshipFeaturesClient initial={features} canEdit={s.isAdmin} />
      </div>
    </SettingsShell>
  );
}
