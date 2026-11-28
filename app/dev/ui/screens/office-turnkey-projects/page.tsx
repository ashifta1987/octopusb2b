import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ProjectsView } from '@/app/ods/admin/turnkey/_components/projects-view';
import { projectFilters } from '@/app/ods/admin/turnkey/_lib/turnkey-logic';
import { TurnkeyFixtureFrame } from '../_office-turnkey-frame';
import { FixtureNav, pick } from '../_office-turnkey-fixture-nav';
import { PER_STAGE, PROJECTS, ROLES, roleSession } from '../_office-turnkey-sample';

export const metadata: Metadata = { title: 'Turnkey client projects · ODS screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [['default', 'Default'], ['loading', 'Loading'], ['empty', 'No results'], ['error', 'Error']] as const;
const BASE = '/dev/ui/screens/office-turnkey-projects';

/** Staging-only fixture (T9): /admin/turnkey/projects. ?role= ?state=default|loading|empty|error + today's filter params. */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const role = pick(sp.role, ROLES, 'admin');
  const state = pick(sp.state, STATES, 'default');
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const f = projectFilters({ stage: one('stage'), status: one('status'), q: one('q'), mine: one('mine') });
  const r = roleSession(role);
  let rows = PROJECTS.filter((p) => (!f.stage || p.stage === f.stage) && (f.status === 'all' ? true : f.status === 'active' ? ['open', 'on_hold'].includes(p.status) : p.status === f.status) && (!f.q || `${p.code} ${p.title}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.mine || p.manager === 'Ravi Menon'));
  if (state === 'empty') rows = [];
  return (
    <TurnkeyFixtureFrame pathname="/admin/turnkey/projects" activeId="tk-projects" isAdmin={r.isAdmin} roles={r.roles} permissions={r.permissions}>
      <FixtureNav base={BASE} current={{ role, state }} groups={[{ key: 'role', label: 'Role', options: ROLES }, { key: 'state', label: 'State', options: STATES }]} />
      <ProjectsView isAdmin={r.isAdmin} filters={f} perStage={PER_STAGE} rows={state === 'error' ? null : rows} loading={state === 'loading'} base={`${BASE}?role=${role}&state=${state}`} sample />
    </TurnkeyFixtureFrame>
  );
}
