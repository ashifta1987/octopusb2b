import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader } from '@/components/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { CATEGORY_LABEL, TURNKEY_CATEGORIES, usd, type TurnkeyEquipment, type TurnkeyHub, type TurnkeyPackage, type TurnkeyProject } from '@/lib/turnkey/format';
import { saveProject, savePackage, saveEquipment, deleteEquipment, moveEquipment } from '../actions';

export const metadata = { title: 'Turnkey project' };

/** Admin → Turnkey → project editor: details, starter pick, packages (tiers) and equipment lines. */
export default async function TurnkeyProjectAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('turnkey', 'view', `/admin/turnkey/${id}`);
  const edit = can(s, 'turnkey', 'edit');
  const sb = await createClient();
  const isNew = id === 'new';
  const [{ data: proj }, { data: hubs }, { data: pkgs }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : sb.from('turnkey_projects').select('*').eq('project_id', id).maybeSingle(),
    sb.from('turnkey_hubs').select('*').order('sort_rank'),
    isNew ? Promise.resolve({ data: [] }) : sb.from('turnkey_packages').select('*, turnkey_equipment(*)').eq('project_id', id).order('tier_rank'),
  ]);
  if (!isNew && !proj) notFound();
  const p = proj as TurnkeyProject | null;
  const packages = ((pkgs ?? []) as (TurnkeyPackage & { turnkey_equipment: TurnkeyEquipment[] })[]).map((k) => ({ ...k, equipment: [...(k.turnkey_equipment ?? [])].sort((a, b) => a.sort_order - b.sort_order) }));
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/turnkey?tab=projects" className="text-blue">← Turnkey projects</Link>} title={p?.title ?? 'New turnkey project'}
        actions={p ? <Link href={`/turnkey/${p.project_id}`} target="_blank" className="btn btn-ghost">View page ↗</Link> : undefined} />
      <Card title="Project" className="mb-6">
        <ActionForm action={saveProject} className="px-6 pb-6" submitLabel={isNew ? 'Create project' : 'Save project'} hideSubmit={!edit}>
          <input type="hidden" name="_new" value={isNew ? '1' : '0'} />
          <div className="grid gap-4 sm:grid-cols-2">
            {isNew ? <F edit={edit} label="Project id (URL)" name="project_id" hint="e.g. water-bottling — cannot be changed later" /> : <input type="hidden" name="project_id" value={p!.project_id} />}
            <F edit={edit} label="Title" name="title" value={p?.title} />
            <label className="block"><span className="label">Category</span>
              <select name="category" defaultValue={p?.category ?? 'self-service'} className="input" disabled={!edit}>{TURNKEY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
            <label className="block"><span className="label">Status</span>
              <select name="status" defaultValue={p?.status ?? 'register-interest'} className="input" disabled={!edit}>
                <option value="register-interest">Register interest</option><option value="live">Live (needs an active package)</option><option value="archived">Archived (hidden)</option>
              </select></label>
            <F edit={edit} label="Card text (short reason)" name="short_reason" value={p?.short_reason} wide />
            <F edit={edit} label="Starting budget (USD)" name="starting_budget_usd" value={p?.starting_budget_usd} type="number" hint="Rough planning figure shown as “From $X”" />
            <F edit={edit} label="Budget unit" name="budget_unit" value={p?.budget_unit} hint="Optional: court, room… → “From $22 k/court”" />
            <F edit={edit} label="Lead time (days)" name="lead_time_days" value={p?.lead_time_days} type="number" />
            <F edit={edit} label="Hub label on cards" name="hub_label" value={p?.hub_label} hint="e.g. Zhangjiagang, Multi-hub" />
            <fieldset className="sm:col-span-2"><legend className="label">Factory hubs (Atlas filter)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">{((hubs ?? []) as TurnkeyHub[]).map((h) => (
                <label key={h.hub_id} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="factory_hub_ids" value={h.hub_id} defaultChecked={p?.factory_hub_ids.includes(h.hub_id)} disabled={!edit} />{h.name}</label>
              ))}</div></fieldset>
            <F edit={edit} label="Best markets (comma-separated)" name="best_markets" value={p?.best_markets.join(', ')} wide />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="is_starter_pick" defaultChecked={p?.is_starter_pick} disabled={!edit} /> “Start with these five” pick</label>
            <F edit={edit} label="Starter rank (1–5)" name="starter_rank" value={p?.starter_rank} type="number" />
            <label className="block sm:col-span-2"><span className="label">Overview</span><textarea name="overview_md" defaultValue={p?.overview_md ?? ''} rows={3} className="input py-2" disabled={!edit} /></label>
            <label className="block sm:col-span-2"><span className="label">Hero ticks (one per line, max 6)</span><textarea name="highlights" defaultValue={p?.highlights.join('\n') ?? ''} rows={4} className="input py-2" disabled={!edit} /></label>
            <F edit={edit} label="Hero image URL (https, optional)" name="hero_image_path" value={p?.hero_image_path} wide />
            <F edit={edit} label="Hero image alt text (describes the photo)" name="hero_image_alt" value={p?.hero_image_alt} wide />
            <F edit={edit} label="SEO title" name="seo_title" value={p?.seo_title} />
            <F edit={edit} label="SEO description" name="seo_description" value={p?.seo_description} />
          </div>
        </ActionForm>
      </Card>

      {!isNew && (
        <>
          {packages.map((k) => (
            <Card key={k.package_id} title={`${k.tier_name} · ${usd(k.starting_budget_usd) ?? 'no budget'}${k.is_active ? '' : ' · inactive'}`} className="mb-6">
              <div className="px-6 pb-6 space-y-5">
                <PackageForm k={k} projectId={p!.project_id} edit={edit} />
                <div>
                  <h3 className="font-semibold text-sm mb-2">Equipment ({k.equipment.length}) · total {usd(k.equipment.reduce((a, e) => a + (e.budget_usd ?? 0), 0))}</h3>
                  <ul className="divide-y divide-line border border-line rounded-[10px]">
                    {k.equipment.map((e, i) => (
                      <li key={e.line_id} className="p-3">
                        <ActionForm action={saveEquipment} inline submitLabel="Save" submitClass="btn btn-ghost btn-sm" hideSubmit={!edit} className="grid gap-2 sm:grid-cols-[70px_1.4fr_1.2fr_70px_70px_100px_auto] items-end">
                          <input type="hidden" name="line_id" value={e.line_id} /><input type="hidden" name="package_id" value={k.package_id} />
                          <label className="text-xs text-muted">Tag<input name="group_label" defaultValue={e.group_label ?? ''} className="input min-h-9" disabled={!edit} /></label>
                          <label className="text-xs text-muted">Item<input name="name" defaultValue={e.name} className="input min-h-9" disabled={!edit} /></label>
                          <label className="text-xs text-muted">Spec<input name="spec_md" defaultValue={e.spec_md ?? ''} className="input min-h-9" disabled={!edit} /></label>
                          <label className="text-xs text-muted">Qty<input name="quantity" type="number" min={1} defaultValue={e.quantity} className="input min-h-9" disabled={!edit} /></label>
                          <label className="text-xs text-muted">Unit<input name="unit" defaultValue={e.unit ?? ''} placeholder="×" className="input min-h-9" disabled={!edit} /></label>
                          <label className="text-xs text-muted">Budget $<input name="budget_usd" type="number" defaultValue={e.budget_usd ?? ''} className="input min-h-9" disabled={!edit} /></label>
                        </ActionForm>
                        {edit && (
                          <div className="flex gap-2 mt-2">
                            <RunButton action={moveEquipment.bind(null, e.line_id, -1)} className="btn btn-ghost btn-sm" >{i === 0 ? '·' : '↑ Up'}</RunButton>
                            <RunButton action={moveEquipment.bind(null, e.line_id, 1)} className="btn btn-ghost btn-sm">{i === k.equipment.length - 1 ? '·' : '↓ Down'}</RunButton>
                            <RunButton action={deleteEquipment.bind(null, e.line_id)} className="btn btn-ghost btn-sm text-bad" confirm={`Remove “${e.name}”?`}>Remove</RunButton>
                          </div>
                        )}
                      </li>
                    ))}
                    {!k.equipment.length && <li className="p-3 text-sm text-muted">No equipment lines yet — buyers see “itemised list comes with your quote”.</li>}
                  </ul>
                  {edit && (
                    <ActionForm action={saveEquipment} resetOnSuccess submitLabel="Add item" submitClass="btn btn-primary btn-sm" className="mt-3 grid gap-2 sm:grid-cols-[70px_1.4fr_1.2fr_70px_70px_100px] items-end">
                      <input type="hidden" name="package_id" value={k.package_id} />
                      <label className="text-xs text-muted">Tag<input name="group_label" className="input min-h-9" /></label>
                      <label className="text-xs text-muted">New item<input name="name" className="input min-h-9" /></label>
                      <label className="text-xs text-muted">Spec<input name="spec_md" className="input min-h-9" /></label>
                      <label className="text-xs text-muted">Qty<input name="quantity" type="number" min={1} defaultValue={1} className="input min-h-9" /></label>
                      <label className="text-xs text-muted">Unit<input name="unit" className="input min-h-9" /></label>
                      <label className="text-xs text-muted">Budget $<input name="budget_usd" type="number" className="input min-h-9" /></label>
                    </ActionForm>
                  )}
                </div>
              </div>
            </Card>
          ))}
          {edit && (
            <Card title="Add a package / tier" className="mb-10">
              <div className="px-6 pb-6"><PackageForm projectId={p!.project_id} edit={edit} nextRank={(packages.at(-1)?.tier_rank ?? 0) + 1} /></div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function F({ label, name, value, type = 'text', wide, hint, edit }: { label: string; name: string; value?: string | number | null; type?: string; wide?: boolean; hint?: string; edit: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="label">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ''} className="input" disabled={!edit} />{hint && <span className="text-xs text-muted">{hint}</span>}</label>
  );
}
function N({ label, name, v, edit }: { label: string; name: string; v?: number | null; edit: boolean }) {
  return <label className="block text-sm"><span className="label">{label}</span><input name={name} type="number" defaultValue={v ?? ''} className="input" disabled={!edit} /></label>;
}
function T({ label, name, v, edit }: { label: string; name: string; v?: string | null; edit: boolean }) {
  return <label className="block text-sm"><span className="label">{label}</span><input name={name} defaultValue={v ?? ''} className="input" disabled={!edit} /></label>;
}

function PackageForm({ k, projectId, edit, nextRank }: { k?: TurnkeyPackage; projectId: string; edit: boolean; nextRank?: number }) {
  return (
    <ActionForm action={savePackage} submitLabel={k ? 'Save package' : 'Add package'} hideSubmit={!edit} resetOnSuccess={!k}>
      <input type="hidden" name="package_id" value={k?.package_id ?? ''} /><input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <T edit={edit} label="Tier name" name="tier_name" v={k?.tier_name ?? (nextRank === 1 ? 'Starter' : nextRank === 2 ? 'Standard' : nextRank === 3 ? 'Pro' : '')} />
        <N edit={edit} label="Tier rank" name="tier_rank" v={k?.tier_rank ?? nextRank} />
        <T edit={edit} label="Tab label" name="tier_label" v={k?.tier_label} />
        <N edit={edit} label="Budget (USD)" name="starting_budget_usd" v={k?.starting_budget_usd} />
        <T edit={edit} label="Capacity" name="capacity_label" v={k?.capacity_label} />
        <T edit={edit} label="Space" name="space_label" v={k?.space_label} />
        <T edit={edit} label="Container" name="container_label" v={k?.container_label} />
        <N edit={edit} label="Lead time (days)" name="lead_time_days" v={k?.lead_time_days} />
        <N edit={edit} label="Items" name="items_count" v={k?.items_count} />
        <N edit={edit} label="Monthly revenue low $" name="monthly_revenue_low" v={k?.monthly_revenue_low} />
        <N edit={edit} label="Monthly revenue high $" name="monthly_revenue_high" v={k?.monthly_revenue_high} />
        <N edit={edit} label="Payback low (months)" name="payback_months_low" v={k?.payback_months_low} />
        <N edit={edit} label="Payback high (months)" name="payback_months_high" v={k?.payback_months_high} />
        <label className="block text-sm sm:col-span-2"><span className="label">Budget notes</span><input name="starting_budget_notes" defaultValue={k?.starting_budget_notes ?? ''} className="input" disabled={!edit} /></label>
        <label className="inline-flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" name="is_active" defaultChecked={k ? k.is_active : true} disabled={!edit} /> Active (shown to buyers)</label>
      </div>
    </ActionForm>
  );
}
