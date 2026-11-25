import { Suspense } from 'react';
import { DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireFeesRatesDutyStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { ComplianceClient, type CustomsPolicy, type DataCompleteness, type DutyEntry, type DutyVersion } from './compliance-client';

export const metadata = { title: 'Duty, tax and customs · Back office' };

async function Guarded() {
  const access = await requireFeesRatesDutyStaff('/office/dropship/compliance');
  const sb = await createClient();
  const vRes = await sb.rpc('list_duty_rate_versions');
  if (vRes.error) throw new Error(`Could not load duty versions: ${vRes.error.message}`);
  const versions = (vRes.data ?? []) as DutyVersion[];
  const ids = versions.filter((v) => v.status === 'active' || v.status === 'draft').map((v) => v.id);
  const eRes = ids.length
    ? await sb
        .from('duty_rate_entries')
        .select('id, version_id, country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to, source, status, edited_by')
        .in('version_id', ids)
        .order('country')
        .order('hs_prefix', { nullsFirst: true })
    : { data: [], error: null };
  if (eRes.error) throw new Error(`Could not load duty entries: ${eRes.error.message}`);
  const entries = ((eRes.data ?? []) as DutyEntry[]).map((e) => ({ ...e, de_minimis_cents: Number(e.de_minimis_cents) }));
  const [pRes, cRes] = await Promise.all([sb.rpc('list_customs_policy'), sb.rpc('dropship_data_completeness')]);
  if (pRes.error) throw new Error(`Could not load the customs value policy: ${pRes.error.message}`);
  const policies = (pRes.data ?? []) as CustomsPolicy[];
  const completeness = (cRes.error ? null : cRes.data) as DataCompleteness;
  return (
    <div className="flex flex-col gap-5" data-testid="staff-compliance-page">
      <DsPageHeader
        title="Duty, tax and customs"
        subtitle="Rules that decide duties and declared values. Every change is versioned and published by a second person."
        icon="globe"
      />
      <ComplianceClient
        versions={versions}
        entries={entries}
        policies={policies}
        completeness={completeness}
        access={{ userId: access.session.userId, canEdit: access.canEditDuty, canPublish: access.canPublishDuty, readOnly: access.readOnly }}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
