'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Settings2 } from 'lucide-react';
import {
  Button, Checkbox, EmptyState, ErrorState, KpiStrip, Modal, Money, Select, Skeleton, StatusPill, cx, formatDate, type KpiItem,
} from '@octopus/ui';
import type { QueueItem } from '@/lib/core/work-queue';
import type { ActivityItem, Fx, KpiFigure, PoolSoon } from '../_lib/dashboard-data';
import {
  chartScale, chartValueText, greetingFor, workStatus, WIDGET_LABELS,
  type AgeingBucketId, type AgeingResult, type ChartUnit, type MoneyWeek, type WidgetId,
} from '../_lib/dashboard-core';
import { useOfficeWorkspace } from './office-context';

/**
 * ODS T9 · /office Dashboard (Part 7.3, board backoffice/ERP_Dashboard) — presentational client pieces. The page
 * (app/ods/office/page.tsx) loads each panel on its own (<Suspense> + settle) and passes plain data; the staging
 * fixture (/dev/ui/screens/office-dashboard) passes SAMPLE data. Compact density (the frame sets it).
 */

const subscribe = () => () => {};
const useLocalHour = () => useSyncExternalStore(subscribe, () => new Date().getHours(), () => null);
const useLocalDate = () =>
  useSyncExternalStore(
    subscribe,
    () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', ''),
    () => null,
  );

const minorToMajor = (minor: number) => minor / 100;

/** Local "18:42" after hydration; the server (and the first paint) shows the UTC time with "UTC". */
export function LocalTime({ iso }: { iso: string }) {
  const local = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    () => null,
  );
  const utc = new Date(iso).toISOString().slice(11, 16);
  return <time dateTime={iso}>{local ?? `${utc} UTC`}</time>;
}

/* ───────── shell: head + Customise + panel grid ───────── */

const SPAN: Record<WidgetId, string> = {
  kpis: 'ods-desktop:col-span-12',
  'my-work': 'ods-desktop:col-span-7',
  money: 'ods-desktop:col-span-5',
  ageing: 'ods-desktop:col-span-4',
  pools: 'ods-desktop:col-span-4',
  activity: 'ods-desktop:col-span-4',
};

export type DashboardShellProps = {
  firstName: string;
  roleLabel: string;
  /** Panels this person may have (dashboardWidgets), in board order. */
  widgets: WidgetId[];
  /** Saved "Customise" choice (ui_prefs.extra.dashboardHidden, or this browser). */
  initialHidden: WidgetId[];
  /** localStorage key for the choice when the server prefs table is not there yet. */
  storageKey: string;
  /** Server save (T8-DATA saveUiPrefsAction); omitted in fixtures → this browser only. */
  onSaveHidden?: (hidden: WidgetId[]) => Promise<{ ok: boolean }>;
  panels: Partial<Record<WidgetId, ReactNode>>;
};

export function DashboardShell({ firstName, roleLabel, widgets, initialHidden, storageKey, onSaveHidden, panels }: DashboardShellProps) {
  const hour = useLocalHour();
  const date = useLocalDate();
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [chosen, setChosen] = useState<WidgetId[] | null>(null);
  const hidden = useMemo<WidgetId[]>(() => {
    if (chosen) return chosen;
    if (initialHidden.length || !stored) return initialHidden;
    try {
      const v = JSON.parse(stored);
      return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as WidgetId[]) : initialHidden;
    } catch {
      return initialHidden;
    }
  }, [chosen, initialHidden, stored]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WidgetId[]>(hidden);
  const [saving, setSaving] = useState(false);
  const shown = widgets.filter((w) => !hidden.includes(w));

  const save = async () => {
    setSaving(true);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* private mode: keep it for this visit */
    }
    if (onSaveHidden) await onSaveHidden(draft).catch(() => ({ ok: false }));
    setChosen(draft);
    setSaving(false);
    setOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="office-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-ods-small text-ods-slate">Dashboard</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">
            {greetingFor(hour)}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate" data-testid="dashboard-subtitle">
            {roleLabel}
            {date ? ` · ${date}` : ''}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconStart={Settings2}
          onClick={() => {
            setDraft(hidden);
            setOpen(true);
          }}
          data-testid="dashboard-customise"
        >
          Customise
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Every panel is hidden" description="Use Customise to show panels again." headingLevel={2} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-12">
          {shown.map((w) => (
            <div key={w} className={cx('min-w-0', SPAN[w])} data-widget={w}>
              {panels[w] ?? null}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Customise your dashboard"
        description="Choose the panels you want to see. Only panels your role can open are listed."
        confirmLabel="Save"
        onConfirm={save}
        loading={saving}
        loadingText="Saving"
        data-testid="dashboard-customise-dialog"
      >
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Panels</legend>
          {widgets.map((w) => (
            <Checkbox
              key={w}
              label={WIDGET_LABELS[w]}
              checked={!draft.includes(w)}
              onCheckedChange={(on) => setDraft((d) => (on ? d.filter((x) => x !== w) : [...d, w]))}
            />
          ))}
        </fieldset>
      </Modal>
    </div>
  );
}

/* ───────── shared panel frame + states ───────── */

function Panel({ title, actions, children, testId, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; testId: string; className?: string }) {
  return (
    <section data-testid={testId} className={cx('min-w-0 rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card', className)} aria-label={typeof title === 'string' ? title : undefined}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-ods-line px-ods-pad-card py-2">
        <h2 className="m-0 text-ods-body font-bold text-ods-navy">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-w-0 p-ods-pad-card">{children}</div>
    </section>
  );
}

/** Skeleton for one panel while it loads (the header stays). */
export function PanelSkeleton({ title, testId, lines = 4 }: { title: string; testId: string; lines?: number }) {
  return (
    <Panel title={title} testId={testId}>
      <Skeleton lines={lines} label={`Loading ${title.toLowerCase()}`} />
    </Panel>
  );
}

/** One panel failed: only this panel shows the error (Try again re-renders the page data). */
export function PanelError({ title, testId }: { title: string; testId: string }) {
  const router = useRouter();
  return (
    <Panel title={title} testId={testId}>
      <div data-state="error">
        <ErrorState title={`We couldn’t load ${title}`} description="The rest of the dashboard still works." onRetry={() => router.refresh()} headingLevel={3} />
      </div>
    </Panel>
  );
}

/* ───────── KPI strip ───────── */

export function KpiPanel({ items, fx, loading }: { items: KpiFigure[]; fx?: Fx; loading?: boolean }) {
  if (loading) return <KpiStrip variant="strip" items={[]} loading label="Key figures" data-testid="kpi-strip" />;
  if (!items.length) {
    return (
      <Panel title="Key figures" testId="kpi-strip">
        <p className="m-0 text-ods-small text-ods-slate">No figures could be loaded right now.</p>
      </Panel>
    );
  }
  const prefix = fx?.prefix ?? 'US$';
  const kpis: KpiItem[] = items.map((k) => ({
    label: k.label,
    value: (
      <a href={k.href ?? '#'} className="text-inherit no-underline hover:underline" data-kpi={k.id}>
        {k.minor != null ? <Money amount={minorToMajor(k.minor)} currency={prefix} /> : (k.count ?? 0).toLocaleString('en-US')}
      </a>
    ),
    hint: k.hintMinor != null ? (
      <>
        <Money amount={minorToMajor(k.hintMinor)} currency={prefix} /> {k.hint}
      </>
    ) : (
      k.hint
    ),
  }));
  return <KpiStrip variant="strip" items={kpis} label="Key figures" data-testid="kpi-strip" />;
}

/* ───────── My work ───────── */

export function MyWorkPanel({ items, total, seeAllHref = '/office/my-work' }: { items: QueueItem[]; total: number; seeAllHref?: string }) {
  const ws = useOfficeWorkspace();
  const [sel, setSel] = useState<string[]>([]);
  const rows = items.slice(0, 6);
  const chosen = rows.filter((r) => sel.includes(r.key));
  return (
    <Panel
      title={`My work · ${total}`}
      testId="my-work-grid"
      actions={
        <Button href={seeAllHref} variant="link" size="sm">
          See all
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing waiting" description="New requests, approvals and transfers to confirm appear here." />
      ) : (
        <>
          {chosen.length ? (
            <div role="group" aria-label="Selected tasks" className="mb-2 flex flex-wrap items-center gap-2 rounded-ods-control bg-ods-navy px-3 py-1.5 text-ods-small text-white">
              <span aria-live="polite">{chosen.length} selected</span>
              <Button size="sm" variant="on-navy" onClick={() => chosen.forEach((r) => ws.openTab(r.href, { title: r.ref || r.item, background: true }))} disabled={!ws.inFrame} disabledReason={ws.inFrame ? undefined : 'Works inside the Back Office'}>
                Open in tabs
              </Button>
              <Button size="sm" variant="on-navy" onClick={() => setSel([])}>
                Clear
              </Button>
            </div>
          ) : null}
          <div className="-mx-ods-pad-card overflow-x-auto">
            <table className="w-full border-collapse text-ods-table">
              <caption className="sr-only">My work, the first {rows.length} of {total} tasks</caption>
              <thead>
                <tr className="text-start text-ods-label text-ods-slate">
                  <th scope="col" className="w-10 px-2 py-1 text-start font-semibold"><span className="sr-only">Select</span></th>
                  <th scope="col" className="px-2 py-1 text-start font-semibold">Task</th>
                  <th scope="col" className="hidden px-2 py-1 text-start font-semibold ods-tablet:table-cell">Due</th>
                  <th scope="col" className="hidden px-2 py-1 text-start font-semibold ods-tablet:table-cell">Status</th>
                  <th scope="col" className="px-2 py-1 text-end font-semibold"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = workStatus(r);
                  const id = `mw-${r.key}`;
                  return (
                    <tr key={r.key} className="border-t border-ods-line align-middle" data-testid="my-work-row">
                      <td className="px-2 py-1.5">
                        <input
                          id={id}
                          type="checkbox"
                          className="size-4 accent-[var(--color-ods-blue)]"
                          checked={sel.includes(r.key)}
                          onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.key] : s.filter((k) => k !== r.key)))}
                          aria-label={`Select ${r.item}`}
                        />
                      </td>
                      <td className="min-w-0 px-2 py-1.5">
                        <div className="font-semibold text-ods-navy">{r.item}</div>
                        <div className="text-ods-small text-ods-slate">
                          {[r.ref, r.customer].filter(Boolean).join(' · ')}
                          <span className="ods-tablet:hidden"> · {r.dueLabel}</span>
                        </div>
                        <StatusPill tone={st.tone} className="mt-1 ods-tablet:hidden">{st.label}</StatusPill>
                      </td>
                      <td className={cx('hidden px-2 py-1.5 whitespace-nowrap ods-tablet:table-cell', r.late && 'font-semibold text-ods-danger')}>{r.dueLabel}</td>
                      <td className="hidden px-2 py-1.5 ods-tablet:table-cell">
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      </td>
                      <td className="px-2 py-1.5 text-end">
                        <Button href={r.href} size="sm" variant="secondary">
                          Open<span className="sr-only"> {r.ref || r.item}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ───────── Money in and out ───────── */

export function MoneyChart({ weeks, fx }: { weeks: MoneyWeek[]; fx: Fx }) {
  const [unit, setUnit] = useState<ChartUnit>('thousands');
  const [table, setTable] = useState(false);
  const { ticks, bars } = chartScale(weeks);
  const totalIn = weeks.reduce((a, w) => a + w.inMinor, 0);
  const totalOut = weeks.reduce((a, w) => a + w.outMinor, 0);
  const empty = totalIn === 0 && totalOut === 0;
  const prefix = fx.prefix;
  const summary = `Last 8 weeks: money in ${chartValueText(totalIn / 100, 'units', prefix)}, money out ${chartValueText(totalOut / 100, 'units', prefix)}.`;
  return (
    <Panel
      title="Money in and out · last 8 weeks"
      testId="money-chart"
      actions={
        <label className="flex items-center gap-2 text-ods-small text-ods-slate">
          <span className="sr-only">Unit</span>
          <Select value={unit} onChange={(e) => setUnit(e.target.value as ChartUnit)} className="w-40" data-testid="money-chart-unit">
            <option value="thousands">{prefix} thousands</option>
            <option value="units">{prefix}</option>
          </Select>
        </label>
      }
    >
      <figure className="m-0" aria-labelledby="money-chart-cap">
        <figcaption id="money-chart-cap" className="sr-only">
          {summary} Bank account movements; the table below lists every week.
        </figcaption>
        {empty ? (
          <p className="m-0 py-6 text-center text-ods-small text-ods-slate">No money moved through the bank accounts in the last 8 weeks.</p>
        ) : (
          <div className="flex gap-2" aria-hidden="true">
            <div className="flex h-40 flex-col-reverse justify-between text-end text-[11px] text-ods-slate tabular-nums">
              {ticks.map((t) => (
                <span key={t} className="leading-none">{chartValueText(t, unit, '')}</span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative flex h-40 items-end justify-between gap-1 border-b border-ods-line-strong">
                {weeks.map((w, i) => (
                  <div key={w.start} className="flex h-full flex-1 items-end justify-center gap-0.5">
                    <span className="w-2.5 rounded-t-[2px] bg-ods-blue ods-tablet:w-3.5" style={{ height: `${bars[i]!.inPct}%` }} title={`Week of ${w.label}: in ${chartValueText(w.inMinor / 100, unit, prefix)}`} />
                    <span className="w-2.5 rounded-t-[2px] bg-ods-teal ods-tablet:w-3.5" style={{ height: `${bars[i]!.outPct}%` }} title={`Week of ${w.label}: out ${chartValueText(w.outMinor / 100, unit, prefix)}`} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between gap-1 text-[11px] text-ods-slate">
                {weeks.map((w) => (
                  <span key={w.start} className="flex-1 text-center whitespace-nowrap">{w.label}</span>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <ul className="m-0 flex list-none gap-4 p-0 text-ods-small text-ods-text" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-ods-blue" />Money in</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-ods-teal" />Money out</li>
          </ul>
          <Button variant="link" size="sm" aria-expanded={table} aria-controls="money-chart-table" onClick={() => setTable((t) => !t)}>
            {table ? 'Hide table' : 'Show as table'}
          </Button>
        </div>
        <div id="money-chart-table" className={table ? 'mt-2 overflow-x-auto' : 'sr-only'}>
          <table className="w-full border-collapse text-ods-table" data-testid="money-chart-table">
            <caption className="sr-only">Money in and out per week ({fx.currency})</caption>
            <thead>
              <tr className="text-ods-label text-ods-slate">
                <th scope="col" className="px-2 py-1 text-start font-semibold">Week of</th>
                <th scope="col" className="px-2 py-1 text-end font-semibold">Money in ({prefix})</th>
                <th scope="col" className="px-2 py-1 text-end font-semibold">Money out ({prefix})</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start} className="border-t border-ods-line">
                  <th scope="row" className="px-2 py-1 text-start font-normal">{formatDate(w.start)}</th>
                  <td className="px-2 py-1 text-end"><Money amount={w.inMinor / 100} currency={prefix} /></td>
                  <td className="px-2 py-1 text-end"><Money amount={w.outMinor / 100} currency={prefix} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>
    </Panel>
  );
}

/* ───────── Receivables ageing ───────── */

const AGE_COLOUR: Record<AgeingBucketId, string> = {
  '0_30': 'bg-ods-blue',
  '31_60': 'bg-ods-warning',
  '61_90': 'bg-ods-svc-brand',
  '90_plus': 'bg-ods-danger',
};

export function AgeingPanel({ ageing, fx }: { ageing: AgeingResult; fx: Fx }) {
  const prefix = fx.prefix;
  return (
    <Panel
      title="Receivables ageing"
      testId="ageing"
      actions={
        <Button href="/admin/finance/receivables" variant="link" size="sm">
          Open
        </Button>
      }
    >
      {ageing.totalMinor <= 0 ? (
        <EmptyState title="No open invoices" description="Unpaid invoices appear here by how long they are past due." />
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-ods-canvas" aria-hidden="true">
            {ageing.buckets.map((b) => (b.amountMinor > 0 ? <span key={b.id} className={AGE_COLOUR[b.id]} style={{ width: `${(b.amountMinor / ageing.totalMinor) * 100}%` }} /> : null))}
          </div>
          <table className="mt-3 w-full border-collapse text-ods-table">
            <caption className="sr-only">Receivables by days past due ({fx.currency})</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Days past due</th>
                <th scope="col">Amount</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {ageing.buckets.map((b) => (
                <tr key={b.id} data-bucket={b.id}>
                  <th scope="row" className="py-1.5 text-start font-normal">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className={cx('size-2.5 rounded-[2px]', AGE_COLOUR[b.id])} />
                      {b.label}
                    </span>
                  </th>
                  <td className="py-1.5 text-end font-semibold"><Money amount={b.amountMinor / 100} currency={prefix} /></td>
                  <td className="w-12 py-1.5 text-end text-ods-slate tabular-nums">{b.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mt-2 text-ods-small text-ods-slate">
            Total <Money amount={ageing.totalMinor / 100} currency={prefix} />
            {ageing.notDueMinor > 0 ? <> · 0–30 includes <Money amount={ageing.notDueMinor / 100} currency={prefix} /> not due yet</> : null}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ───────── MOQ pools closing soon ───────── */

export function PoolsPanel({ pools }: { pools: PoolSoon[] }) {
  return (
    <Panel
      title="MOQ pools closing soon"
      testId="pools-closing"
      actions={
        <Button href="/admin/pools" variant="link" size="sm">
          See all
        </Button>
      }
    >
      {pools.length === 0 ? (
        <EmptyState title="No pools closing soon" description="Open pools appear here as their deadline gets close." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {pools.map((p) => (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-ods-body">
                <span className="font-semibold">{p.code}</span> {p.title}
              </span>
              <span className="text-end text-ods-small whitespace-nowrap">
                <span className="sr-only">closes </span>
                {formatDate(p.deadline, { short: true, now: new Date(p.deadline) })}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-ods-line" aria-hidden="true">
                <span className="block h-full rounded-full bg-ods-svc-pools" style={{ width: `${p.pct}%` }} />
              </span>
              <span className="w-10 text-end text-ods-small text-ods-slate tabular-nums">
                <span className="sr-only">{p.filled} of {p.target} filled, </span>
                {p.pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────── Recent activity ───────── */

export function ActivityPanel({ items, auditShown }: { items: ActivityItem[]; auditShown: boolean }) {
  return (
    <Panel title="Recent activity" testId="recent-activity">
      {items.length === 0 ? (
        <EmptyState title="No recent activity" description="Status changes and logged actions appear here." />
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {items.map((a) => (
            <li key={a.key} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-ods-line py-2 last:border-b-0">
              <span className="text-ods-small text-ods-slate tabular-nums">
                <LocalTime iso={a.at} />
              </span>
              <span className="min-w-0 text-ods-body break-words">
                {a.what}
                <span className="text-ods-slate"> · {a.who}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {!auditShown ? <p className="m-0 mt-2 text-ods-small text-ods-slate">Status changes only — the audit log needs the audit permission.</p> : null}
    </Panel>
  );
}
