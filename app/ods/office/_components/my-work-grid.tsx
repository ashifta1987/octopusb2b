'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FilterPills, KpiStrip, OctopusDataGrid, StatusPill, Switch, cx, type GridColumn, type GridFilterChip } from '@octopus/ui';
import type { QueueItem } from '@/lib/core/work-queue';
import { workStatus } from '../_lib/dashboard-core';
import { useOfficeWorkspace } from './office-context';

/**
 * ODS T9 · /office/my-work — today's work queue (lib/core/work-queue getWorkQueue, the /admin "Work queue" data) as a
 * full OctopusDataGrid page (Part 3.5 "Dashboard My work panel as a full page"). Filters: service pills + "Needs owner
 * approval" (today's `?s=` / `?owner=1`, kept in the URL with history.replaceState) and the grid's search / columns /
 * sort. Opening a row = today's link (Ctrl/⌘ Enter or Ctrl-click = a background workspace tab).
 */

export const SERVICE_LABELS: Record<QueueItem['service'], string> = {
  sourcing: 'Sourcing',
  dropship: 'Dropshipping',
  warehouse: '3PL warehouse',
  brand: 'Make My Brand',
  wallet: 'Wallet',
};

export type MyWorkStats = { open: number; needOwner: number; waitingCustomer: number; dueOrLate: number };

export function MyWorkGridPage({
  items,
  stats,
  initialService = 'all',
  initialOwner = false,
  error,
  loading,
}: {
  items: QueueItem[];
  stats: MyWorkStats | null;
  initialService?: string;
  initialOwner?: boolean;
  error?: boolean;
  loading?: boolean;
}) {
  const router = useRouter();
  const ws = useOfficeWorkspace();
  const services = useMemo(() => [...new Set(items.map((i) => i.service))], [items]);
  const [svc, setSvc] = useState<string>(services.includes(initialService as QueueItem['service']) ? initialService : 'all');
  const [owner, setOwner] = useState(initialOwner);

  const syncUrl = (nextSvc: string, nextOwner: boolean) => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (nextSvc === 'all') u.searchParams.delete('s');
    else u.searchParams.set('s', nextSvc);
    if (nextOwner) u.searchParams.set('owner', '1');
    else u.searchParams.delete('owner');
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}`);
  };
  const setService = (v: string) => {
    setSvc(v);
    syncUrl(v, owner);
  };
  const setOwnerOnly = (v: boolean) => {
    setOwner(v);
    syncUrl(svc, v);
  };

  const shown = items.filter((i) => (svc === 'all' || i.service === svc) && (!owner || i.owner));
  const chips: GridFilterChip[] = [
    ...(svc !== 'all' ? [{ id: 'service', label: `Service: ${SERVICE_LABELS[svc as QueueItem['service']] ?? svc}` }] : []),
    ...(owner ? [{ id: 'owner', label: 'Needs owner approval' }] : []),
  ];

  const columns: GridColumn<QueueItem>[] = [
    { id: 'customer', header: 'Customer', accessor: (r) => r.customer, width: 180 },
    { id: 'service', header: 'Service', accessor: (r) => SERVICE_LABELS[r.service], width: 130 },
    {
      id: 'item', header: 'Item', accessor: (r) => `${r.ref} ${r.item}`, width: 250,
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-ods text-ods-small font-semibold">{r.ref}</span>
          <span className="truncate text-ods-small text-ods-slate">{r.item}</span>
        </span>
      ),
    },
    { id: 'needed', header: 'What is needed', accessor: (r) => r.needed, cell: (r) => <span className="line-clamp-2 text-ods-small whitespace-normal">{r.needed}</span>, width: 280 },
    { id: 'due', header: 'Due', accessor: (r) => r.due ?? '', width: 120, cell: (r) => <span className={cx(r.late && 'font-semibold text-ods-danger')}>{r.dueLabel}</span> },
    { id: 'age', header: 'Age', accessor: (r) => r.age, width: 130, defaultHidden: false },
    { id: 'status', header: 'Status', accessor: (r) => workStatus(r).label, width: 130, cell: (r) => <StatusPill tone={workStatus(r).tone}>{workStatus(r).label}</StatusPill> },
    {
      id: 'open', header: 'Action', sortable: false, width: 170,
      cell: (r) => (
        <Button href={r.href} size="sm" variant={r.primary ? 'primary' : 'secondary'}>
          {r.cta}
          <span className="sr-only"> · {r.ref}</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="my-work-page">
      <div>
        <p className="m-0 text-ods-small text-ods-slate">Dashboard › My work</p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">My work</h1>
        <p className="m-0 mt-0.5 text-ods-small text-ods-slate">
          Everything your customers need from you, across Sourcing, Dropshipping, 3PL warehouse and Make My Brand. Late and blocked items first.
        </p>
      </div>

      {stats ? (
        <KpiStrip
          variant="strip"
          label="Today"
          data-testid="my-work-stats"
          items={[
            { label: 'Open items', value: stats.open.toLocaleString('en-US') },
            { label: 'Need owner approval', value: stats.needOwner.toLocaleString('en-US') },
            { label: 'Waiting for customer', value: stats.waitingCustomer.toLocaleString('en-US') },
            { label: 'Due today or late', value: <span className={cx(stats.dueOrLate > 0 && 'text-ods-danger')}>{stats.dueOrLate.toLocaleString('en-US')}</span> },
          ]}
        />
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <FilterPills
          mode="single"
          allowEmpty={false}
          label="Service"
          value={[svc]}
          onChange={(ids) => setService(ids[0] ?? 'all')}
          items={[
            { id: 'all', label: 'All', count: items.length },
            ...services.map((k) => ({ id: k, label: SERVICE_LABELS[k], count: items.filter((i) => i.service === k).length })),
          ]}
          className="min-w-0"
          data-testid="my-work-services"
        />
        {stats && stats.needOwner > 0 ? (
          <Switch label="Needs owner approval" checked={owner} onCheckedChange={setOwnerOnly} showState={false} data-testid="my-work-owner" />
        ) : null}
      </div>

      <OctopusDataGrid<QueueItem>
        label="My work"
        data-testid="my-work-grid"
        rows={shown}
        columns={columns}
        getRowId={(r) => r.key}
        rowNumber={(r) => r.ref}
        loading={loading}
        error={error ? 'We couldn’t load your work queue.' : undefined}
        onRetry={() => router.refresh()}
        emptyTitle={items.length ? 'No tasks for these filters' : 'Nothing waiting'}
        emptyDescription={items.length ? undefined : 'New requests, approvals and transfers to confirm appear here.'}
        onClearFilters={chips.length ? () => {
          setSvc('all');
          setOwner(false);
          syncUrl('all', false);
        } : undefined}
        filters={chips}
        onRemoveFilter={(id) => (id === 'service' ? setService('all') : setOwnerOnly(false))}
        onOpenRow={(r, o) => (o.newTab && ws.inFrame ? ws.openTab(r.href, { title: r.ref || r.item, background: true }) : router.push(r.href))}
        onRefresh={() => router.refresh()}
        pageSizes={[25, 50, 100]}
        defaultPageSize={25}
      />
      <p className="m-0 text-ods-small text-ods-slate">
        Items above your amount limit or below the minimum margin go to the owner. The customer sees a price only after it is approved.{' '}
        <a href="/admin" className="text-ods-blue underline underline-offset-4">Today’s work queue page</a>
      </p>
    </div>
  );
}
