'use client';
// ODS T9
/**
 * ODS T9 · Service requests (Part 7.6: status tabs + filter bar + grid; quick actions in a 460 px drawer).
 * Same filters as today's /office/services (?f=open|done|rejected, ?type=, ?r= opens that request). Every button calls
 * today's `transitionService` unchanged (the DB function transition_service_request decides; a wallet-paid rejection
 * refunds the fee there). Buttons only with requests:edit, as today.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Drawer, Field, FilterPills, Modal, Money, OctopusDataGrid, Select, StatusPill, Textarea, formatDate, type GridColumn } from '@octopus/ui';
import { SERVICE_TABS, serviceActions, serviceStageLabel, serviceStatusName, validateServiceReason, type ServiceAction, type ServiceRow, type ServiceTab } from '../_lib/services-core';
import { InlineNotice, KeyValueList } from '../../_components/sales-bits';

export type ActionOutcome = { ok: boolean; error?: string; message?: string } | void;

export type ServicesQueueProps = {
  rows: ServiceRow[];
  tab: ServiceTab;
  type: string | null;
  types: { code: string; name: string }[];
  canEdit: boolean;
  transition: (id: string, to: string, reason: string) => Promise<ActionOutcome>;
  base: string;
  highlight?: string | null;
  loading?: boolean;
  error?: boolean;
  sample?: boolean;
};

function href(base: string, p: { f?: string; type?: string | null }) {
  const [path, existing] = base.split('?');
  const u = new URLSearchParams(existing ?? '');
  ['f', 'type', 'r'].forEach((k) => u.delete(k));
  if (p.f && p.f !== 'open') u.set('f', p.f);
  if (p.type) u.set('type', p.type);
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

export function ServicesQueue({ rows, tab, type, types, canEdit, transition, base, highlight, loading, error, sample }: ServicesQueueProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(highlight && rows.some((r) => r.id === highlight) ? highlight : null);
  const go = (h: string) => { if (!sample) start(() => router.replace(h)); };
  const current = rows.find((r) => r.id === openId) ?? null;

  const cols: GridColumn<ServiceRow>[] = [
    { id: 'code', header: 'Ref', accessor: (r) => r.code, width: 120, cell: (r) => <span className="font-mono font-semibold text-ods-navy">{r.code}</span> },
    { id: 'type', header: 'Type', accessor: (r) => r.type, width: 170, cell: (r) => <StatusPill tone="info">{r.type}</StatusPill> },
    {
      id: 'customer', header: 'Customer', accessor: (r) => r.customer ?? '', width: 230,
      cell: (r) => <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-semibold">{r.customer ?? '—'}</span>{r.product || r.place ? <span className="truncate text-ods-small text-ods-slate">{r.product ?? r.place}</span> : null}</span>,
    },
    {
      id: 'status', header: 'Status', accessor: (r) => serviceStatusName(r.status), width: 220,
      cell: (r) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><StatusPill status={serviceStatusName(r.status)} /><span className="text-ods-small text-ods-slate">{serviceStageLabel(r.status)}</span></span>,
    },
    { id: 'fee', header: 'Fee', accessor: (r) => r.feeMinor / 100, numeric: true, width: 130, cell: (r) => <Money amount={r.feeMinor / 100} currency={r.currency} /> },
    { id: 'created', header: 'Created', accessor: (r) => r.createdAt, width: 120, cell: (r) => formatDate(r.createdAt) },
    { id: 'owner', header: 'Owner', accessor: (r) => r.owner ?? '', width: 150, cell: (r) => r.owner ?? <span className="text-ods-slate">Unassigned</span> },
  ];
  const filtered = tab !== 'open' || !!type;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterPills
          label="Service request status"
          mode="single"
          allowEmpty={false}
          value={[tab]}
          onChange={(ids) => go(href(base, { f: ids[0], type }))}
          items={SERVICE_TABS.map((t) => ({ id: t.id, label: t.label }))}
          resultText={loading ? 'Loading…' : `${rows.length} shown`}
          data-testid="services-tabs"
        />
        <div className="ms-auto w-full ods-tablet:w-56">
          <Field label="Service type">
            <Select value={type ?? ''} onChange={(e) => go(href(base, { f: tab, type: e.target.value || null }))}>
              <option value="">All types</option>
              {types.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <OctopusDataGrid
        label="Service requests"
        rows={rows}
        columns={cols}
        getRowId={(r) => r.id}
        rowNumber={(r) => r.code}
        loading={loading || pending}
        error={error ? 'We couldn’t load the service requests.' : undefined}
        onRetry={sample ? undefined : () => router.refresh()}
        filters={type ? [{ id: 'type', label: `Type: ${types.find((t) => t.code === type)?.name ?? type}` }] : []}
        onRemoveFilter={() => go(href(base, { f: tab, type: null }))}
        onClearFilters={filtered ? () => go(href(base, {})) : undefined}
        emptyTitle="No service requests here"
        emptyDescription={tab === 'open' ? 'New samples, QC, certification, 3PL, dropship and sourcing requests appear here.' : 'Try another status.'}
        onOpenRow={(r) => setOpenId(r.id)}
        onOpenInDrawer={(r) => setOpenId(r.id)}
        defaultSort={{ id: 'created', desc: false }}
        pagination
        headingLevel={2}
        data-testid="services-grid"
      />
      <ServiceDrawer row={current} canEdit={canEdit} transition={transition} sample={sample} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ServiceDrawer({ row, canEdit, transition, sample, onClose }: { row: ServiceRow | null; canEdit: boolean; transition: ServicesQueueProps['transition']; sample?: boolean; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ServiceAction | null>(null);
  const [pending, start] = useTransition();
  const actions = row ? serviceActions(row, canEdit) : [];
  const run = (a: ServiceAction) => {
    if (!row) return;
    const v = validateServiceReason(a.to, reason);
    if (v) { setErr(v); return; }
    setErr(null); setDone(null);
    start(async () => {
      const r = await transition(row.id, a.to, a.kind === 'reason' ? reason : '');
      setConfirm(null);
      if (r && !r.ok) { setErr(r.error ?? 'Failed'); return; }
      setDone(r?.message ?? `${row.code}: ${serviceStageLabel(a.to)}`); setReason('');
      if (!sample) router.refresh();
    });
  };
  const close = () => { setErr(null); setDone(null); setReason(''); onClose(); };
  const reject = actions.find((a) => a.kind === 'reason');
  return (
    <Drawer
      open={!!row}
      onClose={close}
      width={460}
      title={row ? `${row.code} · ${row.type}` : ''}
      description={row ? `${row.customer ?? 'Customer'}${row.place ? ` · ${row.place}` : ''}` : undefined}
      data-testid="services-drawer"
      footer={row ? (
        canEdit ? (
          actions.length ? (
            <div className="flex flex-wrap justify-end gap-2">
              {actions.filter((a) => a.kind === 'run').map((a) => (
                <Button key={a.to} size="sm" variant={a.primary ? 'primary' : 'secondary'} loading={pending && confirm?.to === a.to} onClick={() => (a.confirm ? setConfirm(a) : run(a))}>{a.label}</Button>
              ))}
              {reject ? <Button size="sm" variant="danger" onClick={() => { const v = validateServiceReason('rejected', reason); if (v) { setErr(v); return; } setConfirm(reject); }}>Reject</Button> : null}
            </div>
          ) : <p className="m-0 text-ods-small text-ods-slate">No actions at this stage.</p>
        ) : <p className="m-0 text-ods-small text-ods-slate">View only. Moving a request needs Requests · edit.</p>
      ) : null}
    >
      {row ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2"><StatusPill status={serviceStatusName(row.status)} /><span className="text-ods-small text-ods-slate">{serviceStageLabel(row.status)}</span></div>
          <KeyValueList columns={1} rows={[
            ['Fee', <span key="fee"><Money amount={row.feeMinor / 100} currency={row.currency} />{row.paidVia ? <span className="text-ods-slate"> · paid via {row.paidVia}</span> : null}</span>],
            ['Product', row.product], ['Owner', row.owner ?? 'Unassigned'], ['Created', formatDate(row.createdAt)], ['Updated', row.updatedAt ? formatDate(row.updatedAt) : null],
          ]} />
          <section aria-labelledby="sv-details">
            <h3 id="sv-details" className="m-0 mb-1 text-ods-body font-semibold text-ods-navy">Details</h3>
            {row.details.length ? <KeyValueList columns={1} rows={row.details} /> : <p className="m-0 text-ods-small text-ods-slate">No details given.</p>}
          </section>
          {reject ? (
            <Field label="Reason to reject" hint={reject.placeholder} error={err && !reason.trim() ? err : undefined}>
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          ) : null}
          {err && reason.trim() ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
          {err && !reject ? <InlineNotice tone="danger" role="alert">{err}</InlineNotice> : null}
          {done ? <InlineNotice tone="success" role="status">{done}</InlineNotice> : null}
        </div>
      ) : null}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'reason' ? `Reject ${row?.code ?? ''}?` : confirm?.confirm ?? ''}
        description={confirm?.kind === 'reason' ? (row?.paidVia === 'wallet' ? 'The fee is refunded to the customer’s wallet.' : 'The customer sees the request as rejected.') : undefined}
        destructive={confirm?.kind === 'reason'}
        confirmLabel={confirm?.kind === 'reason' ? 'Reject request' : confirm ? `Mark ${serviceStageLabel(confirm.to).toLowerCase()}` : ''}
        loading={pending}
        onConfirm={() => confirm && run(confirm)}
      />
    </Drawer>
  );
}
