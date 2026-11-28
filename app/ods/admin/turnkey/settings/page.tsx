// ODS T9 · /admin/turnkey/settings. Replaces the T8 re-export. Same guard (requireStaff('turnkey','view')), same tk_settings
// RPC, same edit rule (can_edit && isAdmin), same forms and actions. Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/format';
import type { TkSettings } from '@/lib/turnkey/reports';
import { Skeleton } from '@octopus/ui';
import { SettingsView } from '../_components/settings-view';

export const metadata = { title: 'Turnkey settings' };

export default function TurnkeySettingsPage() {
  return (
    <Suspense fallback={<Skeleton lines={8} label="Loading settings" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/settings');
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_settings');
  return <SettingsView v={error ? null : ((data ?? null) as TkSettings | null)} isAdmin={s.isAdmin} money={(c) => money(c)} />;
}
