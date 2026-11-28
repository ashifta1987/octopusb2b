'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Drawer, Field, Input, KpiStrip, OctopusDataGrid, Select, Tabs, formatDate, type GridColumn } from '@octopus/ui';
import { SUPPLIER_SWITCHES, SUPPLIER_TYPES, archiveConfirmText, human, supplierMatches, switchOn, validateSupplier } from '../../_catalogue/core';
import { KV, Note, NoPermission, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../_catalogue/kit';

export type SupplierRow = {
  id: string; code: string; legal_name: string; country: string; city: string | null; supplier_type: string | null; main_categories: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; verified: boolean; archived_at: string | null; created_at: string;
  identity_status: string | null; switches: Record<string, boolean>; counts: { live: number; total: number; review: number };
};
export type Variant = { id: string; variant_name: string; variant_address: string | null; seen_in: string | null; is_canonical: boolean };
export type DelPreview = { code: string; products: number; products_by_status: Record<string, number>; in_moderation: number; photos: number; skus_released: number; contacts: number; name_variants: number; certificates: number; import_jobs: number; import_runs: number; distributors: number; blockers: string[]; can_delete: boolean };
type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type SuppliersActions = {
  create: (prev: R | null, fd: FormData) => Promise<R>;
  update: (prev: R | null, fd: FormData) => Promise<R>;
  setSwitch: (supplierId: string, key: string, value: boolean) => Promise<R>;
  setArchived: (id: string, archived: boolean) => Promise<R>;
  remove: (prev: R | null, fd: FormData) => Promise<R>;
  setCanonical: (supplierId: string, variantId: string) => Promise<R>;
};
export type SuppliersPerms = { canCreate: boolean; canEdit: boolean; isAdmin: boolean };
export type SuppliersScreenProps = {
  state: 'ok' | 'loading' | 'forbidden';
  rows: SupplierRow[] | null;
  includeArchived: boolean;
  q: string;
  selected: { id: string; variants: Variant[]; delPreview: DelPreview | null } | null;
  creating: boolean;
  countries: [string, string][];
  perms: SuppliersPerms;
  actions: SuppliersActions;
  basePath?: string;
  extraParams?: Record<string, string>;
  fixture?: boolean;
};
const CRUMBS = [{ label: 'Catalogue', href: '/office/products' }, { label: 'Suppliers' }];

/**
 * ODS T9 · Catalogue › Suppliers. Grid (code frozen, contact, products, verified, the five switches) + supplier drawer:
 * Details (today's createSupplier / updateSupplier), Switches (setSwitch), Legal names (setCanonicalName), Archive /
 * restore (setArchived) and Admin-only delete (deleteSupplier with the typed code). Staff only, as today.
 */
export function SuppliersScreen({ state, rows, includeArchived, q: q0, selected, creating, countries, perms, actions, basePath = '/admin/suppliers', extraParams, fixture }: SuppliersScreenProps) {
  const router = useRouter();
  const [nav, startNav] = useTransition();
  const [search, setSearch] = useState(q0);
  const go = (p: Record<string, string | null>) => {
    const u = new URLSearchParams(extraParams);
    const m = { archived: includeArchived ? '1' : null, ...p };
    Object.entries(m).forEach(([k, v]) => v && u.set(k, v));
    startNav(() => router.push(`${basePath}${u.toString() ? `?${u}` : ''}`, { scroll: false }));
  };
  const list = useMemo(() => (rows ?? []).filter((x) => supplierMatches(x, search)), [rows, search]);
  const sel = selected ? (rows ?? []).find((x) => x.id === selected.id) ?? null : null;

  if (state === 'forbidden') return <NoPermission crumbs={CRUMBS} title="Suppliers" what="suppliers (Suppliers view)" />;

  const columns: GridColumn<SupplierRow>[] = [
    { id: 'code', header: 'Code', width: 110, accessor: (x) => x.code, cell: (x) => <button type="button" onClick={() => go({ id: x.id })} className="font-mono font-semibold text-ods-navy hover:underline">{x.code}</button> },
    { id: 'name', header: 'Legal name', width: 240, accessor: (x) => x.legal_name, cell: (x) => <span className="truncate">{x.legal_name}{x.archived_at ? <span className="ms-2"><PillView p={{ label: 'Archived', tone: 'neutral' }} /></span> : null}</span> },
    { id: 'where', header: 'Country · city', width: 140, accessor: (x) => `${x.country} ${x.city ?? ''}`, cell: (x) => <span>{x.country}{x.city ? ` · ${x.city}` : ''}</span> },
    { id: 'contact', header: 'Contact', width: 200, accessor: (x) => x.contact_name ?? '', cell: (x) => <span className="truncate" title={x.contact_email ?? undefined}>{x.contact_name ?? '—'}{x.contact_email ? <span className="block truncate font-mono text-ods-small text-ods-slate">{x.contact_email}</span> : null}</span> },
    { id: 'products', header: 'Products', width: 110, accessor: (x) => x.counts.live, cell: (x) => `${x.counts.live} live / ${x.counts.total}` },
    { id: 'verified', header: 'Verified', width: 110, accessor: (x) => (x.verified ? 1 : 0), cell: (x) => <PillView p={x.verified ? { label: 'Verified', tone: 'success' } : { label: 'Not verified', tone: 'warning' }} /> },
    ...SUPPLIER_SWITCHES.map((s) => ({ id: s.key, header: s.label, width: 110, accessor: (x: SupplierRow) => (switchOn(x.switches, s.key) ? 'On' : 'Off'), cell: (x: SupplierRow) => <span className={switchOn(x.switches, s.key) ? 'text-ods-success' : 'font-semibold text-ods-danger'}>{switchOn(x.switches, s.key) ? 'On' : 'Off'}</span> }) as GridColumn<SupplierRow>),
    { id: 'since', header: 'Since', width: 100, accessor: (x) => x.created_at, cell: (x) => formatDate(x.created_at, { short: true }) },
  ];
  const active = (rows ?? []).filter((x) => !x.archived_at);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="suppliers-page">
      <PageHead
        crumbs={CRUMBS}
        title="Suppliers"
        subtitle="Legal names, contacts and verification are staff-only. Buyers see only “Verified factory · China (region)”."
        actions={perms.canCreate ? <Button iconStart={Plus} onClick={() => go({ new: '1' })} data-testid="add-supplier">Add supplier</Button> : null}
      />
      <KpiStrip
        data-testid="suppliers-kpis"
        label="Supplier figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Active suppliers', value: String(active.length) },
          { label: 'Verified', value: String(active.filter((x) => x.verified).length) },
          { label: 'Listings switched off', value: String(active.filter((x) => !switchOn(x.switches, 'listings_live')).length), hint: 'approval fails while off' },
          { label: 'Legal name to resolve', value: String(active.filter((x) => x.identity_status === 'needs_identity_review').length), hint: 'blocks publishing' },
        ]}
      />
      <label className="flex items-center gap-2 self-start text-ods-small text-ods-text">
        <input type="checkbox" className="size-4" checked={includeArchived} onChange={(e) => go({ archived: e.target.checked ? '1' : null })} /> Include archived
      </label>
      <OctopusDataGrid<SupplierRow>
        label="All suppliers"
        data-testid="suppliers-grid"
        rows={list}
        columns={columns}
        getRowId={(x) => x.id}
        rowNumber={(x) => x.code}
        loading={state === 'loading' || nav}
        error={rows === null && state === 'ok' ? 'We couldn’t load the suppliers. Try again.' : undefined}
        onRetry={() => router.refresh()}
        emptyTitle="No suppliers match"
        headingLevel={2}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        searchPlaceholder="Search code, name, country"
        onOpenRow={(x) => go({ id: x.id })}
        onOpenInDrawer={(x) => go({ id: x.id })}
        rowActions={(x) => [{ id: 'open', label: perms.canEdit ? 'Edit' : 'Open', onSelect: () => go({ id: x.id }) }]}
        pagination
        densityToggle
      />
      {sel && selected ? <SupplierDrawer key={sel.id} x={sel} variants={selected.variants} delPreview={selected.delPreview} countries={countries} perms={perms} actions={actions} onClose={() => go({})} onDone={() => !fixture && router.refresh()} /> : null}
      {creating && perms.canCreate ? <SupplierDrawer key="new" x={null} variants={[]} delPreview={null} countries={countries} perms={perms} actions={actions} onClose={() => go({})} onDone={() => !fixture && router.refresh()} /> : null}
    </div>
  );
}

function SupplierDrawer({ x, variants, delPreview, countries, perms, actions, onClose, onDone }: { x: SupplierRow | null; variants: Variant[]; delPreview: DelPreview | null; countries: [string, string][]; perms: SuppliersPerms; actions: SuppliersActions; onClose: () => void; onDone: () => void }) {
  const isNew = !x;
  const canSave = isNew ? perms.canCreate : perms.canEdit;
  const [tab, setTab] = useState('details');
  const [f, setF] = useState({
    legal_name: x?.legal_name ?? '', country: x?.country ?? '', city: x?.city ?? '', supplier_type: x?.supplier_type ?? 'Manufacturer', main_categories: x?.main_categories ?? '',
    contact_name: x?.contact_name ?? '', contact_email: x?.contact_email ?? '', contact_phone: x?.contact_phone ?? '', verified: !!x?.verified,
  });
  const [err, setErr] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const save = useRun(onDone);
  const sw = useRun(onDone);
  const danger = useRun(onDone);
  const c = useConfirm();
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const submit = () => {
    const bad = validateSupplier(f);
    setErr(bad);
    if (bad || !canSave) return;
    const fd = new FormData();
    if (x) fd.set('id', x.id);
    (['legal_name', 'country', 'city', 'supplier_type', 'main_categories', 'contact_name', 'contact_email', 'contact_phone'] as const).forEach((k) => fd.set(k, String(f[k])));
    if (f.verified) fd.set('verified', 'on');
    save.run(() => (x ? actions.update(null, fd) : actions.create(null, fd)), x ? 'Supplier saved' : 'Supplier created');
  };
  const ro = !canSave;
  const details = (
    <div className="flex flex-col gap-3 pt-2">
      <Field label="Legal name" required><Input value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} disabled={ro} maxLength={200} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" required>
          <Select value={f.country} onChange={(e) => set('country', e.target.value)} disabled={ro}>
            <option value="" disabled>Select…</option>
            {countries.map(([cc, n]) => <option key={cc} value={cc}>{n} ({cc})</option>)}
          </Select>
        </Field>
        <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} disabled={ro} maxLength={80} /></Field>
        <Field label="Type">
          <Select value={f.supplier_type} onChange={(e) => set('supplier_type', e.target.value)} disabled={ro}>{SUPPLIER_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
        </Field>
        <Field label="Main categories"><Input value={f.main_categories} onChange={(e) => set('main_categories', e.target.value)} disabled={ro} maxLength={200} /></Field>
        <Field label="Contact name"><Input value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} disabled={ro} maxLength={120} /></Field>
        <Field label="Contact phone"><Input value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} disabled={ro} maxLength={40} /></Field>
      </div>
      <Field label="Contact email"><Input type="email" value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)} disabled={ro} /></Field>
      <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={f.verified} onChange={(e) => set('verified', e.target.checked)} disabled={ro} /> Verified supplier (badge shown to buyers)</label>
      {err ? <Note tone="danger" role="alert">{err}</Note> : null}
      <RunMsg msg={save.msg} testId="supplier-msg" />
      {ro ? <p className="m-0 text-ods-small text-ods-slate">View only. Editing needs the Suppliers edit permission.</p> : null}
    </div>
  );
  const switches = x ? (
    <div className="flex flex-col gap-2 pt-2" data-testid="supplier-switches">
      {SUPPLIER_SWITCHES.map((s) => {
        const on = switchOn(x.switches, s.key);
        return (
          <div key={s.key} className="flex items-center justify-between gap-3 border-b border-ods-line py-2 last:border-b-0">
            <span className="text-ods-body">{s.label}</span>
            <span className="flex items-center gap-2">
              <PillView p={on ? { label: 'On', tone: 'success' } : { label: 'Off', tone: 'danger' }} />
              <Button size="sm" variant="secondary" disabled={!perms.canEdit || sw.pending} disabledReason={!perms.canEdit ? 'Needs the Suppliers edit permission.' : undefined} onClick={() => sw.run(() => actions.setSwitch(x.id, s.key, !on), `${s.label} ${on ? 'off' : 'on'}`)}>
                {on ? 'Turn off' : 'Turn on'}<span className="sr-only"> {s.label} for {x.code}</span>
              </Button>
            </span>
          </div>
        );
      })}
      <RunMsg msg={sw.msg} />
    </div>
  ) : null;
  const names = x ? (
    <div className="flex flex-col gap-2 pt-2" data-testid="supplier-variants">
      {!variants.length ? <p className="m-0 text-ods-small text-ods-slate">No legal-name variants were collected by bulk imports.</p> : x.identity_status === 'needs_identity_review' ? (
        <Note tone="warning"><b>{variants.length} legal names in use — resolve before the first order ships.</b> None of this supplier’s imported products can be published until you choose the entity that signs contracts.</Note>
      ) : <Note tone="success">Canonical legal name chosen: <b>{x.legal_name}</b></Note>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {variants.map((v) => (
          <li key={v.id} className="flex flex-wrap items-start justify-between gap-2 rounded-ods-control border border-ods-line px-3 py-2 text-ods-small">
            <div className="min-w-0">
              <div className="font-semibold">{v.variant_name} {v.is_canonical ? <PillView p={{ label: 'Canonical', tone: 'success' }} /> : null}</div>
              {v.variant_address ? <div className="text-ods-slate">{v.variant_address}</div> : null}
              <div className="text-ods-slate">Seen in: {String(v.seen_in ?? '').replace(/_/g, ' ')}</div>
            </div>
            {perms.canEdit && !v.is_canonical ? (
              <Button size="sm" variant="secondary" onClick={() => c.open({ title: 'Use this legal name?', text: `Make "${v.variant_name}" the canonical legal name? It becomes the supplier's legal name on contracts and documents.`, confirmLabel: 'Use this name', onYes: () => sw.run(() => actions.setCanonical(x.id, v.id), 'Canonical name chosen') })}>Use this name</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  const dangerPanel = x ? (
    <div className="flex flex-col gap-3 pt-2">
      {perms.canEdit ? (
        <div>
          <Button variant="secondary" loading={danger.pending} onClick={() => c.open({ title: x.archived_at ? `Restore ${x.code}` : `Archive ${x.code}`, text: archiveConfirmText(x.code, !!x.archived_at, x.counts), confirmLabel: x.archived_at ? 'Restore supplier' : 'Archive supplier', destructive: !x.archived_at, onYes: () => danger.run(() => actions.setArchived(x.id, !x.archived_at)) })} data-testid="archive-supplier">
            {x.archived_at ? 'Restore supplier' : 'Archive supplier'}
          </Button>
        </div>
      ) : <p className="m-0 text-ods-small text-ods-slate">Archiving needs the Suppliers edit permission.</p>}
      {delPreview ? (
        <div className="rounded-ods-control border-2 border-ods-danger/40 bg-ods-danger-tint p-3 text-ods-small" data-testid="delete-supplier">
          <h3 className="m-0 font-bold text-ods-danger">Delete {delPreview.code} permanently</h3>
          <p className="m-0 mt-1">Erases the supplier and everything below from the platform. This cannot be undone. The code <b className="font-mono">{delPreview.code}</b> is then given to the next new supplier.</p>
          <ul className="m-0 mt-2 grid list-disc gap-0.5 ps-5">
            <li><b>{delPreview.products}</b> product{delPreview.products === 1 ? '' : 's'}{Object.keys(delPreview.products_by_status ?? {}).length ? ` (${Object.entries(delPreview.products_by_status).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', ')})` : ''}</li>
            <li><b>{delPreview.in_moderation}</b> in moderation · <b>{delPreview.photos}</b> photos · <b>{delPreview.skus_released}</b> product IDs released</li>
            <li><b>{delPreview.contacts}</b> contact(s), <b>{delPreview.name_variants}</b> legal-name variant(s), <b>{delPreview.certificates}</b> certificate(s)</li>
            <li><b>{delPreview.import_jobs + delPreview.import_runs}</b> import(s), <b>{delPreview.distributors}</b> distributor assignment(s)</li>
          </ul>
          {delPreview.can_delete ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={`Type ${delPreview.code} to confirm`}><Input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} className="font-mono" autoComplete="off" placeholder={delPreview.code} /></Field>
              <Button className="bg-ods-danger text-white" disabled={!confirmCode.trim()} disabledReason={!confirmCode.trim() ? 'Type the supplier code first.' : undefined} loading={danger.pending}
                onClick={() => c.open({ title: `Delete ${delPreview.code}`, text: `Permanently delete ${delPreview.code} and its ${delPreview.products} products? This cannot be undone.`, confirmLabel: `Delete ${delPreview.code} permanently`, destructive: true, onYes: () => { const fd = new FormData(); fd.set('id', x.id); fd.set('confirm_code', confirmCode); danger.run(() => actions.remove(null, fd)); } })}>
                Delete permanently
              </Button>
            </div>
          ) : <Note tone="warning"><b>Cannot be deleted:</b> {delPreview.blockers.join(', ')}. Records with buyers or money attached must stay — archive the supplier instead.</Note>}
        </div>
      ) : null}
      <RunMsg msg={danger.msg} />
    </div>
  ) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="supplier-drawer"
      title={x ? `${x.code} · ${x.legal_name}` : 'New supplier'}
      description={x ? <span className="inline-flex flex-wrap items-center gap-2">{x.country}{x.city ? ` · ${x.city}` : ''} · {x.counts.live} live / {x.counts.total} products <PillView p={x.verified ? { label: 'Verified', tone: 'success' } : { label: 'Not verified', tone: 'warning' }} /></span> : 'Staff only — buyers never see these details.'}
      dirty={!save.msg?.ok && canSave && tab === 'details' && (isNew ? f.legal_name !== '' : f.legal_name !== x?.legal_name)}
      onSave={canSave && tab === 'details' ? submit : undefined}
      footer={tab === 'details' && canSave ? <div className="flex gap-2"><Button onClick={submit} loading={save.pending} data-testid="save-supplier">{x ? 'Save supplier' : 'Create supplier'}</Button><Button variant="secondary" onClick={onClose}>Close</Button></div> : undefined}
    >
      {x ? (
        <Tabs label={`${x.code} sections`} value={tab} onChange={setTab} items={[
          { id: 'details', label: 'Details', panel: details },
          { id: 'switches', label: 'Switches', panel: switches },
          { id: 'names', label: 'Legal names', count: variants.length || undefined, panel: names },
          { id: 'archive', label: 'Archive', panel: dangerPanel },
        ]} />
      ) : details}
      {x ? <dl className="m-0 mt-3"><KV k="Since">{formatDate(x.created_at)}</KV><KV k="Identity">{human(x.identity_status ?? 'ok')}</KV></dl> : null}
      {c.node}
    </Drawer>
  );
}
