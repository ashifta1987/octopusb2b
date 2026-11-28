/**
 * ODS T9 · Brand project record (Part 7.6 record pattern): header + stepper (today's 6 steps) + sticky tabs
 * Overview · Logo files · History. Server-safe; the status control is today's BrandStatusControls, shown in a drawer
 * (status-drawer.tsx) — passed in as a node so fixtures can pass a sample control.
 */
import type { ReactNode } from 'react';
import { Breadcrumbs, Card, EmptyState, StatusPill, Stepper, Tabs, Timeline, formatDate, formatTime, type TabItem } from '@octopus/ui';
import { COUNTRY_NAMES } from '@/lib/format';
import { BRAND_METHOD, BRAND_PACK, brandDestination, type BrandRow } from '@/lib/brand-projects';
import { brandLabel, brandSteps, brandTone, historyTitle, logoName, type BrandRecordTab } from '../_lib/brand-core';

export type HistoryRow = { at: string; actor: string; from_status: string | null; to_status: string | null; reason: string | null };
const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(7rem,38%)_1fr] text-ods-table">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-ods-line py-2 pe-3 text-ods-slate">{k}</dt>
          <dd className="m-0 min-w-0 break-words border-b border-ods-line py-2 text-ods-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BrandHeader({ r, statusAction }: { r: BrandRow; statusAction: ReactNode }) {
  const steps = brandSteps(r.status, r.closed_from);
  const current = steps.findIndex((s) => s.status === 'current');
  return (
    <header data-testid="brand-header" className="grid gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-4 shadow-ods-card">
      <div className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Brand projects', href: '/admin/brand-projects' }, { label: r.ref }]} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 font-mono text-ods-h1 font-bold text-ods-navy">{r.ref}</h1>
            <StatusPill tone={brandTone(r.status)} data-testid="brand-status">{brandLabel(r.status)}</StatusPill>
            {r.paid ? <StatusPill status="Paid">Payment received</StatusPill> : null}
          </div>
          <p className="m-0 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-ods-small text-ods-slate">
            <span>Customer <a href={`/admin/customers/${r.org_id}`} className="font-semibold text-ods-blue hover:underline">{r.company}</a></span>
            <span>Product <b className="text-ods-navy">{r.product_title ?? r.product_link ?? '—'}</b></span>
            <span>Account manager {r.manager_name ? <b className="text-ods-navy">{r.manager_name}</b> : <b className="text-ods-danger" data-testid="unassigned">Unassigned — set it on the customer record</b>}</span>
            <span>Submitted <b className="text-ods-navy">{when(r.created_at)}</b></span>
            {r.status_changed_at ? <span>Status changed <b className="text-ods-navy">{when(r.status_changed_at)}</b></span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">{statusAction}</div>
      </div>
      <Stepper data-testid="brand-stepper" label="Project progress" current={current < 0 ? steps.length : current} steps={steps} />
      {r.status === 'closed' ? (
        <p className="m-0 text-ods-small font-semibold text-ods-slate" data-testid="brand-closed-note">
          Closed at {brandLabel(r.closed_from ?? 'submitted')}. Only an admin can reopen this project.
        </p>
      ) : null}
    </header>
  );
}

export function BrandRecordView({ header, tab, panels, counts }: { header: ReactNode; tab: BrandRecordTab; panels: Record<BrandRecordTab, ReactNode>; counts: { logos: number; history: number | null } }) {
  const items: TabItem[] = [
    { id: 'overview', label: 'Overview', panel: panels.overview, testId: 'brand-tab-overview' },
    { id: 'logos', label: 'Logo files', count: counts.logos, panel: panels.logos, testId: 'brand-tab-logos' },
    { id: 'history', label: 'History', count: counts.history ?? undefined, panel: panels.history, testId: 'brand-tab-history' },
  ];
  return (
    <div data-testid="brand-record" className="grid min-w-0 gap-3">
      {header}
      <Tabs key={tab} label="Brand project record" items={items} defaultValue={tab} param="tab" sticky data-testid="brand-record-tabs" panelClassName="pt-3" />
    </div>
  );
}

export function BrandOverview({ r }: { r: BrandRow }) {
  return (
    <Card as="section" title="Request" headingLevel={2} data-testid="brand-overview">
      <KeyValues
        rows={[
          ['Customer', <a key="c" href={`/admin/customers/${r.org_id}`} className="font-semibold text-ods-blue hover:underline">{r.company}</a>],
          ['Product', r.product_title ? <a key="p" href={`/p/${r.product_slug}`} target="_blank" rel="noreferrer" className="font-semibold text-ods-blue hover:underline">{r.product_title}</a> : r.product_link ? <span key="l" className="break-all">{r.product_link}</span> : '—'],
          ['Quantity', r.quantity ? `${r.quantity.toLocaleString('en-US')} units` : 'Not given'],
          ['Branding', BRAND_METHOD[r.method ?? ''] ?? '—'],
          ['Packaging', BRAND_PACK[r.packaging ?? ''] ?? '—'],
          ['Colours', r.colours ?? '—'],
          ['Stock goes to', brandDestination(r)],
          ['Markets', r.markets.length ? r.markets.map((m) => COUNTRY_NAMES[m] ?? m).join(', ') : '—'],
          ['Stores', r.stores.length ? r.stores.join(', ') : '—'],
          ['Note from the customer', <span key="n" className="whitespace-pre-line">{r.note ?? '—'}</span>],
        ]}
      />
    </Card>
  );
}

/** Logo files: today's 10-minute signed links (made with the staff session). */
export function BrandLogos({ paths, signed }: { paths: string[]; signed: Record<string, string> }) {
  return (
    <Card as="section" title="Logo files (private)" headingLevel={2} data-testid="brand-logos">
      {paths.length === 0 ? (
        <EmptyState headingLevel={3} title="No logo uploaded" description="The customer can add logos from their Make My Brand request." />
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {paths.map((path) => {
            const url = signed[path];
            return (
              <li key={path}>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" data-testid="logo-link" className="inline-flex min-h-8 items-center rounded-ods-control border border-ods-line-strong px-2.5 text-ods-small font-semibold text-ods-navy hover:border-ods-navy">
                    {logoName(path)}
                  </a>
                ) : (
                  <span className="text-ods-small text-ods-slate">{logoName(path)} (file missing)</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 mt-2 text-ods-small text-ods-slate">Download links work for 10 minutes. Reload the page for a new link.</p>
    </Card>
  );
}

export function BrandHistory({ history }: { history: HistoryRow[] | null }) {
  return (
    <Card as="section" title="History" headingLevel={2} data-testid="history">
      {history === null ? (
        <p className="m-0 text-ods-small text-ods-danger">We couldn’t load the history. Reload the page to try again.</p>
      ) : (
        <Timeline
          label="Project history"
          showTime
          items={history.map((h, i) => ({
            id: `h${i}`,
            title: historyTitle(h),
            date: h.at,
            state: 'done' as const,
            actor: h.actor,
            description: h.reason ? `Internal reason: ${h.reason}` : undefined,
          }))}
        />
      )}
    </Card>
  );
}
