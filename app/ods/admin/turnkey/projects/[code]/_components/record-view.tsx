/**
 * ODS T9 · Turnkey project record frame (Part 7.6 record pattern): header, Stepper over the 8 phases, sticky underline tabs
 * (?tab=) with one panel per tab. Server-safe; panels are ReactNodes (Suspense-wrapped loaders on the real page, sample
 * panels in fixtures) so every tab loads and fails on its own.
 */
import type { ReactNode } from 'react';
import { Breadcrumbs, Stepper, Tabs } from '@octopus/ui';
import { fmtDate } from '@/lib/format';
import { phaseLabel, tkStatus } from '@/lib/turnkey/format';
import { PROJECT_TABS, PROJECT_TAB_LABEL, phaseSteps, type ProjectTab } from '../../../_lib/turnkey-logic';
import { TkPill } from '../../../_components/tk-ui';
import { RecordNotices } from './record-panels';
import type { RecordBase } from './record-types';

export function RecordView({ b, tab, panels, counts }: { b: RecordBase; tab: ProjectTab; panels: Record<ProjectTab, ReactNode>; counts?: Partial<Record<ProjectTab, number>> }) {
  const p = b.p;
  const st = tkStatus(p.status);
  const { steps, current } = phaseSteps(p.stage, p.status, b.stages, (d) => fmtDate(d));
  const manager = b.contact?.usual_name ?? b.managerName;
  return (
    <div className="grid min-w-0 gap-3" data-testid="tk-record">
      <header className="grid gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 shadow-ods-card" data-testid="tk-record-header">
        <Breadcrumbs items={[{ label: 'Turnkey', href: '/admin/turnkey' }, { label: 'Client projects', href: '/admin/turnkey/projects' }, { label: p.code }]} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{p.title}</h1>
          <TkPill label={st.label} tone={st.tone} testId="tk-record-status" />
          <span className="text-ods-small text-ods-slate"><span className="font-mono">{p.code}</span> · {phaseLabel(p.stage)} · started {fmtDate(p.created_at)}</span>
        </div>
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-ods-small text-ods-slate">
          <span>Client <b className="text-ods-navy">{b.company?.name ?? 'Not linked yet'}</b></span>
          <span>Account manager <b className="text-ods-navy">{manager ?? 'Not set'}</b>{b.contact?.on_cover ? ' (cover now)' : ''}</span>
        </p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Turnkey phases">
          <Stepper steps={steps} current={current} label="Turnkey phases" data-testid="tk-record-stepper" className="min-w-[640px] ods-tablet:min-w-0" orientation="horizontal" />
        </div>
        <RecordNotices b={b} />
      </header>
      <Tabs
        key={tab}
        label="Project record"
        param="tab"
        defaultValue={tab}
        sticky
        data-testid="tk-record-tabs"
        panelClassName="pt-3"
        items={PROJECT_TABS.map((id) => ({ id, label: PROJECT_TAB_LABEL[id], count: counts?.[id], panel: panels[id], testId: `tk-tab-${id}` }))}
      />
    </div>
  );
}
