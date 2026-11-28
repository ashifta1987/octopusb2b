import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { LinesGrid, QuotesLoading, QuotesPanel } from '@/app/ods/office/rfqs/_components/rfq-grids';
import { FilesPanel, LoadError, MessagesPanel, OverviewPanel, PanelLoading, RfqHeader, RfqRecordView, TimelinePanel, timelineItems } from '@/app/ods/office/rfqs/_components/rfq-record';
import { isRecordTab, quoteFormGate, type RecordTab } from '@/app/ods/office/rfqs/_lib/rfq-core';
import { OfficeScreenFrame } from '../_office-screen-frame';
import { FIXTURE_ROLES, NOW, SAMPLE_SUPPLIER_OPTIONS, SAMPLE_THREAD, sampleQuotes, samplePerms, sampleRecord, type FixtureRole } from '../office-rfqs/sample-data';
import { SampleReplyForm } from './_reply';

export const metadata: Metadata = { title: 'Back Office RFQ record · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-rfq';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = [
  ['default', 'Quote ready (3 lines)'],
  ['new', 'Sent, no quotes'],
  ['single-line', 'One product (no rfq_lines)'],
  ['accepted', 'Accepted → ordered'],
  ['expired', 'Expired'],
  ['loading', 'Loading'],
  ['error', 'Panels failed'],
] as const;
type State = (typeof STATES)[number][0];
const STATUS: Record<State, string> = { default: 'quoted', new: 'submitted', 'single-line': 'quoting', accepted: 'accepted', expired: 'expired', loading: 'quoted', error: 'quoted' };

/**
 * Staging-only fixture (T9): the ODS RFQ record inside the real Back Office frame, SAMPLE data.
 * `?tab=overview|lines|quotes|messages|files|timeline`, `?role=sales|admin|no-supplier-perm`, `?state=…`, `?quote=new` (drawer open).
 */
export default function OfficeRfqFixturePage({ searchParams }: { searchParams: SP }) {
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
  const role = (FIXTURE_ROLES.find(([r]) => r === one(sp.role))?.[0] ?? 'sales') as FixtureRole;
  const state = (STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default') as State;
  const rawTab = one(sp.tab);
  const tab: RecordTab = isRecordTab(rawTab) ? rawTab : 'overview';
  const perms = samplePerms(role);
  const r = sampleRecord(STATUS[state], state === 'single-line' || state === 'new');
  const quotes = state === 'error' ? null : sampleQuotes(perms, r.statusRaw);
  const thread = state === 'error' ? null : state === 'new' ? { messages: [], files: [] } : SAMPLE_THREAD;
  const gate = quoteFormGate(r.statusRaw, perms);
  const loading = state === 'loading';
  const link = (p: Record<string, string>) => `${BASE}?${new URLSearchParams({ role, state, tab, ...p }).toString()}`;
  const lines = r.lines?.rows ?? [];
  const frameRole = role === 'admin' ? 'admin' : 'sales';
  return (
    <OfficeScreenFrame role={frameRole} pathname="/office/rfqs">
      <nav aria-label="Fixture states (sample data)" className="mb-3 grid gap-1.5" data-testid="fixture-states">
        <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
        {(
          [
            ['Role', FIXTURE_ROLES, 'role', role],
            ['State', STATES, 'state', state],
          ] as const
        ).map(([label, list, key, cur]) => (
          <ul key={key} aria-label={label} className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
            <li className="text-ods-small font-semibold text-ods-slate">{label}:</li>
            {(list as readonly (readonly [string, string])[]).map(([id, l]) => (
              <li key={id}>
                <a
                  href={link({ [key]: id })}
                  aria-current={cur === id ? 'page' : undefined}
                  className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${cur === id ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
                >
                  {l}
                </a>
              </li>
            ))}
          </ul>
        ))}
      </nav>
      <RfqRecordView
        key={`${role}:${state}`}
        tab={tab}
        counts={loading ? {} : { lines: lines.length, quotes: quotes?.length ?? null, messages: thread?.messages.length ?? null, files: thread?.files.length ?? null }}
        header={<RfqHeader r={r} canOpenCustomer={perms.canOpenCustomer} canAddQuote={gate.ok} quoteHref={link({ tab: 'quotes', quote: 'new' })} quoteCount={quotes?.length ?? 0} />}
        panels={{
          overview: loading ? <PanelLoading title="Request" /> : <OverviewPanel r={r} />,
          lines: <LinesGrid rows={loading ? [] : lines} fromLines={!!r.lines?.fromLines} currency={r.currency} loading={loading} />,
          quotes: loading ? (
            <QuotesLoading />
          ) : quotes === null ? (
            <LoadError what="the quotes" />
          ) : (
            <QuotesPanel
              quotes={quotes}
              initialOpen={one(sp.quote) === 'new' && gate.ok}
              drawer={{
                rfq: { code: r.code, title: r.title, quantity: r.quantity, unit: r.unit, incoterm: r.incoterm, statusRaw: r.statusRaw },
                gate,
                canSeeSuppliers: perms.canSeeSuppliers,
                suppliers: perms.canSeeSuppliers ? SAMPLE_SUPPLIER_OPTIONS : [],
                currency: 'USD',
                sample: true,
              }}
            />
          ),
          messages: loading ? <PanelLoading title="Messages with the customer" /> : <MessagesPanel thread={thread} canReply={perms.canReply} replyForm={<SampleReplyForm />} />,
          files: loading ? <PanelLoading title="Files" /> : <FilesPanel thread={thread} />,
          timeline: loading ? <PanelLoading title="Timeline" /> : <TimelinePanel items={timelineItems(r, quotes, thread, NOW)} />,
        }}
      />
    </OfficeScreenFrame>
  );
}
