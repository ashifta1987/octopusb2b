import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { Card, Notice, PageHeader, StatusBadge, Timeline } from '@/components/ui';
import { PageSkeleton } from '@/components/shell/skeletons';
import { fmtDate } from '@/lib/format';
import { countryName } from '@/lib/factory-label';
import { areaLabel, budgetLabel, phaseLabel, tkStatus } from '@/lib/turnkey/format';
import { getTkClientProject } from '@/lib/turnkey/projects';
import { ProjectPhases, eventText } from '@/components/turnkey/project-phases';

export const metadata = { title: 'Turnkey project' };

/**
 * Turnkey T2 — the client's project page (design: ClientPortal + "The 8-step flow"): the 8 phases with their dates, the
 * named account manager, the plan as sent and the project history. Fees, payments, drawings and documents arrive with
 * the next steps (T3+). Nothing about suppliers or Octopus costs is ever shown here.
 */
export default function TurnkeyProjectPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton cards={2} table={false} />}>
      <ProjectDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProjectDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  const { code } = await params;
  const { created } = await searchParams;
  if (!/^TKP-\d{5,}$/.test(code)) notFound();
  await requireCustomer(`/account/turnkey/${code}`);
  const d = await getTkClientProject(code);
  if (!d) notFound();
  const { project: p, stages, events, managerName } = d;
  const st = tkStatus(p.status);
  const place = [p.city, countryName(p.country)].filter(Boolean).join(', ');
  return (
    <>
      <PageHeader eyebrow={<Link href="/account/turnkey" className="text-sm text-muted hover:text-ink">← My turnkey projects</Link>}
        title={p.title} subtitle={`${p.code} · ${phaseLabel(p.stage)}`}
        actions={<StatusBadge status={p.status} label={st.label} tone={st.tone} />} />
      <div className="flex flex-col gap-4 mb-6">
        {created && <Notice tone="green"><span data-testid="tk-created">Enquiry sent. We reply with the consultation fee before any work starts.</span></Notice>}
        {p.status === 'on_hold' && <Notice tone="amber">This project is on hold{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice>}
        {p.status === 'cancelled' && <Notice tone="red">This project was cancelled{p.status_reason ? `: ${p.status_reason}` : '.'}</Notice>}
        {p.status === 'completed' && <Notice tone="green">This project is completed. Thank you for working with us.</Notice>}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] items-start">
        <Card title="Phases">
          <div className="px-6 pb-6"><ProjectPhases stage={p.stage} status={p.status} rows={stages} /></div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Your account manager">
            <p className="px-6 pb-5 m-0 text-[15px]" data-testid="tk-manager">
              {managerName ?? 'We will name your account manager soon. Until then, reply to any message from us or use Help & complaints.'}
            </p>
          </Card>
          <Card title="Your plan">
            <dl className="px-6 pb-5 m-0 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[14px]" data-testid="tk-plan">
              <dt className="text-muted">Where</dt><dd className="m-0">{place || 'Not given'}</dd>
              <dt className="text-muted">Opening</dt><dd className="m-0">{p.target_open_on ? fmtDate(p.target_open_on) : 'Not given'}</dd>
              <dt className="text-muted">Space</dt><dd className="m-0">{areaLabel(p.floor_area_m2)}</dd>
              <dt className="text-muted">Budget</dt><dd className="m-0">{budgetLabel(p.budget_cents)}</dd>
              <dt className="text-muted">Plan</dt><dd className="m-0 whitespace-pre-line">{p.plan ?? 'Not given'}</dd>
            </dl>
          </Card>
          <Card title="History">
            <div className="px-6 pb-6" data-testid="tk-history">
              <Timeline items={events.map((e) => ({ ...eventText(e), at: e.created_at, tone: 'done' as const }))} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
