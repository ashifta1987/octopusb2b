import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { BackupsView } from '@/app/ods/office/_components/admin-c-backups';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_NOW } from '../office-dashboard/sample-data';
import { SAMPLE_BACKUP_SETTINGS, SAMPLE_BACKUPS, SAMPLE_EXPORTS, SAMPLE_NAMES, SAMPLE_RESTORES } from '../office-staff/sample-data';

export const metadata: Metadata = { title: 'Backup & restore · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [
  ['default', 'Restore waiting for a second approver'],
  ['requester', 'I requested the restore'],
  ['overdue', 'Backup overdue + maintenance ON'],
  ['view-only', 'View only'],
  ['empty', 'No backups yet'],
] as const;
const BASE = '/dev/ui/screens/office-backups';

/**
 * Staging-only fixture (T9 batch 5): /admin/backups — the ODS view around TODAY's backup components with SAMPLE rows.
 * Their buttons call today's guarded actions (refused without a staff session). `requester` = the signed-in sample
 * person is the one who asked for the restore → today's RestoreCard blocks approving (two-person rule).
 */
export default function FixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = STATES.find(([s]) => s === raw)?.[0] ?? 'default';
  const empty = state === 'empty';
  const viewOnly = state === 'view-only';
  const backups = empty ? [] : SAMPLE_BACKUPS;
  const requests = empty ? [] : SAMPLE_RESTORES;
  const selected = requests[0] ?? null;
  return (
    <OfficeScreenFrame pathname="/admin/backups" role="admin">
      <FixtureStates label="Fixture states (sample data)" links={STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <BackupsView
        backups={backups} requests={requests} exports={empty ? [] : SAMPLE_EXPORTS} settings={SAMPLE_BACKUP_SETTINGS}
        maintenance={state === 'overdue' ? { enabled: true, message: 'We are restoring data. Back soon.', retry_after: 900, since: new Date(SAMPLE_NOW - 3_600_000).toISOString() } : {}}
        overdue={state === 'overdue'} selected={selected} mode={selected ? 'existing' : 'none'} wizardBackup={selected ? backups[0] ?? null : null} checks={[]}
        names={SAMPLE_NAMES} backupCodes={Object.fromEntries(backups.map((b) => [b.id, b.code]))} drill={empty ? null : { at: new Date(SAMPLE_NOW - 5 * 86_400_000).toISOString(), status: 'pass', minutes: 12 }}
        active={null} githubConfigured={false} mfaNeeded={false} monthStart="2026-10-01" monthEnd="2026-10-31" now={SAMPLE_NOW} filter="all" initialType="full_staging"
        userId={state === 'requester' ? 'u2' : 'u1'}
        perms={viewOnly ? { backup: false, download: false, requestRestore: false, approveRestore: false, export: false, isAdmin: false } : { backup: true, download: true, requestRestore: true, approveRestore: true, export: true, isAdmin: true }}
      />
    </OfficeScreenFrame>
  );
}
