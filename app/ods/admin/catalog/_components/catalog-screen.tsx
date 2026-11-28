'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button, Card, Field, Input, KpiStrip, Select, cx } from '@octopus/ui';
import { slugify } from '@/lib/format';
import { TAG_KINDS, catTree, human, mergeTargets, type CatRow, type TagRow } from '../../_catalogue/core';
import { Note, NoPermission, PageHead, PillView, RunMsg, useConfirm, useRun } from '../../_catalogue/kit';

type Res = { ok: boolean; error?: string; message?: string };
export type CatalogActions = {
  createCategory: (parentId: string | null, name: string) => Promise<Res>;
  updateCategory: (id: string, f: { name: string; hs_code: string | null }) => Promise<Res>;
  moveCategory: (id: string, dir: 'up' | 'down') => Promise<Res>;
  setCategoryActive: (id: string, active: boolean) => Promise<Res>;
  mergeCategory: (from: string, to: string) => Promise<Res>;
  saveTag: (id: string | null, name: string, kind: string) => Promise<Res>;
  deleteTag: (id: string) => Promise<Res>;
};
export type CatalogScreenProps = { state: 'ok' | 'loading' | 'forbidden'; categories: CatRow[]; tags: TagRow[]; canEdit: boolean; actions: CatalogActions; fixture?: boolean };
const CRUMBS = [{ label: 'Catalogue', href: '/office/products' }, { label: 'Categories & tags' }];

/**
 * ODS T9 · Catalogue › Categories & tags. Category tree (4 levels, rolled-up product counts, hidden toggle) + category
 * record (rename, default HS code, move, hide/show, add subcategory, merge) + tags by group. Today's catalog actions
 * unchanged; editing with catalog:edit.
 */
export function CatalogScreen({ state, categories, tags, canEdit, actions, fixture }: CatalogScreenProps) {
  const router = useRouter();
  const q = useRun(() => !fixture && router.refresh());
  const c = useConfirm();
  const t = useMemo(() => catTree(categories), [categories]);
  const [selected, setSelected] = useState<string | null>(categories.find((x) => x.level === 1)?.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(categories.filter((x) => x.level === 1).slice(0, 1).map((x) => x.id)));
  const [showHidden, setShowHidden] = useState(false);
  const [newTop, setNewTop] = useState('');
  if (state === 'forbidden') return <NoPermission crumbs={CRUMBS} title="Categories & tags" what="the catalogue (Catalog view)" />;
  const sel = selected ? t.byId.get(selected) : undefined;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const tree = (parent: string | null, depth: number): React.ReactNode => {
    const list = (t.children.get(parent) ?? []).filter((x) => showHidden || x.active);
    if (!list.length) return null;
    return (
      <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Category tree' : undefined} className="m-0 list-none p-0">
        {list.map((x) => {
          const kids = (t.children.get(x.id) ?? []).filter((k) => showHidden || k.active);
          const isOpen = open.has(x.id);
          return (
            <li key={x.id} role="treeitem" aria-expanded={kids.length ? isOpen : undefined} aria-selected={selected === x.id}>
              <div className={cx('flex items-center gap-2 border-s-[3px] py-1.5 pe-3', selected === x.id ? 'border-ods-blue bg-ods-blue-tint' : 'border-transparent hover:bg-ods-canvas')} style={{ paddingInlineStart: 8 + depth * 18 }}>
                {kids.length ? (
                  <button type="button" className="grid size-6 place-items-center text-ods-slate" aria-label={isOpen ? `Collapse ${x.name}` : `Expand ${x.name}`} onClick={() => toggle(x.id)}>
                    {isOpen ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
                  </button>
                ) : <span className="size-6" aria-hidden />}
                <span className={cx('rounded px-1 font-mono text-[10px] font-bold', x.level === 1 ? 'bg-ods-navy text-white' : 'bg-ods-blue-tint text-ods-info')}>L{x.level}</span>
                <button type="button" className={cx('min-w-0 flex-1 truncate text-start text-ods-body', selected === x.id && 'font-semibold', !x.active && 'text-ods-slate line-through')} onClick={() => setSelected(x.id)}>
                  {x.name}{!x.active ? <span className="sr-only"> (hidden)</span> : null}
                </button>
                <span className="font-mono text-ods-small text-ods-slate">{t.totals.get(x.id) ?? 0}</span>
              </div>
              {isOpen ? tree(x.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };
  const byKind = new Map<string, TagRow[]>();
  for (const tg of tags) byKind.set(tg.kind, [...(byKind.get(tg.kind) ?? []), tg]);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="catalog-page">
      <PageHead crumbs={CRUMBS} title="Categories & tags" subtitle="Build the catalogue structure up to 4 levels deep and manage the tags buyers filter by. Distributors manage the same tree in their panel." />
      <KpiStrip
        label="Catalogue figures"
        variant="strip"
        loading={state === 'loading'}
        items={[
          { label: 'Active categories', value: String(categories.filter((x) => x.active).length) },
          { label: 'Hidden', value: String(categories.filter((x) => !x.active).length) },
          { label: 'Tags', value: String(tags.length) },
          { label: 'Products in the tree', value: String([...(t.children.get(null) ?? [])].reduce((a, x) => a + (t.totals.get(x.id) ?? 0), 0)) },
        ]}
      />
      <RunMsg msg={q.msg} testId="catalog-msg" />
      <div className="grid gap-4 ods-desktop:grid-cols-[400px_minmax(0,1fr)]">
        <Card title="Category tree" headingLevel={2} data-testid="category-tree" actions={<span className="font-mono text-ods-small text-ods-slate">{categories.filter((x) => x.active).length} categories</span>}>
          <div className="max-h-[560px] overflow-y-auto">{tree(null, 0) ?? <p className="m-0 text-ods-small text-ods-slate">No categories yet.</p>}</div>
          <div className="mt-3 flex flex-col gap-2 border-t border-ods-line pt-3">
            <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" className="size-4" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden</label>
            {canEdit ? (
              <div className="flex items-end gap-2">
                <Field label="New top-level category"><Input value={newTop} onChange={(e) => setNewTop(e.target.value)} placeholder="Name" /></Field>
                <Button size="sm" iconStart={Plus} disabled={!newTop.trim() || q.pending} disabledReason={!newTop.trim() ? 'Type a name first.' : undefined} onClick={() => { const n = newTop.trim(); setNewTop(''); q.run(() => actions.createCategory(null, n)); }}>Add</Button>
              </div>
            ) : null}
          </div>
        </Card>
        {sel ? (
          <CategoryDetail
            key={sel.id}
            cat={sel}
            path={t.pathOf(sel.id)}
            total={t.totals.get(sel.id) ?? 0}
            canEdit={canEdit}
            pending={q.pending}
            targets={mergeTargets(categories, sel.id, t.pathOf)}
            pathLabel={(id) => t.pathOf(id).map((p) => p.name).join(' › ')}
            onSave={(f) => q.run(() => actions.updateCategory(sel.id, f))}
            onMove={(d) => q.run(() => actions.moveCategory(sel.id, d))}
            onActive={(a) => (a ? q.run(() => actions.setCategoryActive(sel.id, a)) : c.open({ title: `Hide ${sel.name}`, text: `Hide “${sel.name}” from menus and filters?`, confirmLabel: 'Hide', onYes: () => q.run(() => actions.setCategoryActive(sel.id, false)) }))}
            onAddChild={(n) => { q.run(() => actions.createCategory(sel.id, n)); setOpen((s) => new Set(s).add(sel.id)); }}
            onMerge={(to) => c.open({ title: 'Merge category', text: `Merge “${sel.name}” into “${t.pathOf(to).map((p) => p.name).join(' › ')}”? All ${t.totals.get(sel.id) ?? 0} products move and “${sel.name}” is deactivated.`, confirmLabel: 'Merge', destructive: true, onYes: () => { q.run(() => actions.mergeCategory(sel.id, to)); setSelected(to); } })}
          />
        ) : <Card><p className="m-0 text-ods-slate">Select a category.</p></Card>}
      </div>
      <TagsCard tags={tags} byKind={byKind} canEdit={canEdit} pending={q.pending} onAdd={(n, k) => q.run(() => actions.saveTag(null, n, k))} onSave={(id, n, k) => q.run(() => actions.saveTag(id, n, k))}
        onDelete={(tg) => c.open({ title: `Delete tag ${tg.name}`, text: `Delete tag “${tg.name}”? It will be removed from ${tg.products} products.`, confirmLabel: 'Delete tag', destructive: true, onYes: () => q.run(() => actions.deleteTag(tg.id)) })} />
      {c.node}
    </div>
  );
}

function CategoryDetail({ cat, path, total, canEdit, pending, targets, pathLabel, onSave, onMove, onActive, onAddChild, onMerge }: {
  cat: CatRow; path: CatRow[]; total: number; canEdit: boolean; pending: boolean; targets: CatRow[]; pathLabel: (id: string) => string;
  onSave: (f: { name: string; hs_code: string | null }) => void; onMove: (d: 'up' | 'down') => void; onActive: (a: boolean) => void; onAddChild: (n: string) => void; onMerge: (to: string) => void;
}) {
  const [name, setName] = useState(cat.name);
  const [hs, setHs] = useState(cat.hs_code ?? '');
  const [child, setChild] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  return (
    <Card headingLevel={2} data-testid="category-record">
      <nav aria-label="Category path" className="text-ods-small text-ods-slate">{path.map((p) => p.name).join(' › ')}</nav>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-ods-h2 font-bold text-ods-navy">{cat.name}</h2>
        <PillView p={{ label: `Level ${cat.level} of 4`, tone: 'info' }} />
        <PillView p={{ label: `${total} products`, tone: 'neutral' }} />
        {!cat.active ? <PillView p={{ label: 'Hidden', tone: 'warning' }} /> : null}
      </div>
      <div className="mt-3 grid gap-3 ods-tablet:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="URL slug" readOnly><Input value={[...path.slice(0, -1).map((p) => p.slug), slugify(name)].join('/')} readOnly className="font-mono" /></Field>
        <Field label="Default HS code"><Input value={hs} onChange={(e) => setHs(e.target.value)} disabled={!canEdit} placeholder="e.g. 7318.15" className="font-mono" /></Field>
        <div className="flex items-end">{canEdit ? <Button onClick={() => onSave({ name, hs_code: hs || null })} loading={pending}>Save changes</Button> : null}</div>
      </div>
      {canEdit ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-ods-line pt-3">
            <Button size="sm" variant="secondary" iconStart={ArrowUp} disabled={pending} onClick={() => onMove('up')}>Move up</Button>
            <Button size="sm" variant="secondary" iconStart={ArrowDown} disabled={pending} onClick={() => onMove('down')}>Move down</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onActive(!cat.active)}>{cat.active ? 'Hide (deactivate)' : 'Show (activate)'}</Button>
          </div>
          {cat.level < 4 ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={`New subcategory (level ${cat.level + 1})`}><Input value={child} onChange={(e) => setChild(e.target.value)} placeholder="e.g. Hex bolts" /></Field>
              <Button iconStart={Plus} disabled={pending || !child.trim()} disabledReason={!child.trim() ? 'Type a name first.' : undefined} onClick={() => { onAddChild(child.trim()); setChild(''); }}>Add subcategory</Button>
            </div>
          ) : <Note tone="warning">This is level 4, the deepest level. Add products here, not subcategories.</Note>}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Merge into">
              <Select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
                <option value="">Choose a category…</option>
                {targets.map((x) => <option key={x.id} value={x.id}>{pathLabel(x.id)}</option>)}
              </Select>
            </Field>
            <Button variant="secondary" disabled={pending || !mergeTo} disabledReason={!mergeTo ? 'Choose a category first.' : undefined} onClick={() => onMerge(mergeTo)}>Merge</Button>
          </div>
        </>
      ) : null}
      <p className="m-0 mt-3 text-ods-small text-ods-slate">Moving products between categories happens through merge; every change is written to the audit log.</p>
    </Card>
  );
}

function TagsCard({ tags, byKind, canEdit, pending, onAdd, onSave, onDelete }: { tags: TagRow[]; byKind: Map<string, TagRow[]>; canEdit: boolean; pending: boolean; onAdd: (n: string, k: string) => void; onSave: (id: string, n: string, k: string) => void; onDelete: (t: TagRow) => void }) {
  const [n, setN] = useState('');
  const [k, setK] = useState('feature');
  const [edit, setEdit] = useState<string | null>(null);
  const [en, setEn] = useState('');
  const [ek, setEk] = useState('');
  return (
    <Card title="Tags" headingLevel={2} description="Add tags to products in Create product. Tags show as badges and work as filters." actions={<span className="font-mono text-ods-small text-ods-slate">{tags.length} tags</span>} data-testid="tags-card">
      {canEdit ? (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-ods-control bg-ods-canvas p-3">
          <Field label="New tag"><Input value={n} onChange={(e) => setN(e.target.value)} placeholder="e.g. Marine grade" /></Field>
          <Field label="Group"><Select value={k} onChange={(e) => setK(e.target.value)}>{TAG_KINDS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></Field>
          <Button disabled={pending || !n.trim()} disabledReason={!n.trim() ? 'Type a name first.' : undefined} onClick={() => { onAdd(n.trim(), k); setN(''); }}>Add tag</Button>
        </div>
      ) : null}
      <div className="grid gap-3 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
        {[...byKind.entries()].map(([kind, list]) => (
          <section key={kind} className="rounded-ods-control border border-ods-line p-3" aria-label={`${human(kind)} tags`}>
            <div className="mb-2 flex justify-between"><h3 className="m-0 text-ods-label font-bold text-ods-navy">{human(kind)}</h3><span className="text-ods-small text-ods-slate">{list.length}</span></div>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {list.map((tg) =>
                edit === tg.id ? (
                  <li key={tg.id} className="flex flex-wrap items-center gap-1.5">
                    <Input aria-label="Tag name" value={en} onChange={(e) => setEn(e.target.value)} className="min-w-0 flex-1" />
                    <Select aria-label="Tag group" value={ek} onChange={(e) => setEk(e.target.value)}>{TAG_KINDS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
                    <Button size="sm" disabled={pending} onClick={() => { onSave(tg.id, en, ek); setEdit(null); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                  </li>
                ) : (
                  <li key={tg.id} className="flex items-center gap-2">
                    <PillView p={{ label: `${tg.name} · ${tg.products}`, tone: 'info' }} />
                    {canEdit ? (
                      <>
                        <Button size="sm" variant="link" onClick={() => { setEdit(tg.id); setEn(tg.name); setEk(tg.kind); }}>Edit<span className="sr-only"> tag {tg.name}</span></Button>
                        <Button size="sm" variant="link" className="text-ods-danger" onClick={() => onDelete(tg)}>Delete<span className="sr-only"> tag {tg.name}</span></Button>
                      </>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
        {!tags.length ? <p className="m-0 text-ods-small text-ods-slate">No tags yet.</p> : null}
      </div>
    </Card>
  );
}
