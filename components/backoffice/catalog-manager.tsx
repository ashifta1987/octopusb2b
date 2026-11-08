'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { slugify } from '@/lib/format';

type Res = { ok: boolean; error?: string; message?: string };
export type CatRow = { id: string; name: string; slug: string; parent_id: string | null; level: number; hs_code: string | null; sort: number; active: boolean; products: number };
export type TagRow = { id: string; name: string; kind: string; products: number };

export const TAG_KINDS = ['general', 'feature', 'badge', 'use_case', 'service', 'certification'];

export function CatalogManager({ categories, tags, canEdit, actions }: {
  categories: CatRow[]; tags: TagRow[]; canEdit: boolean;
  actions: {
    createCategory: (parentId: string | null, name: string) => Promise<Res>;
    updateCategory: (id: string, f: { name: string; hs_code: string | null }) => Promise<Res>;
    moveCategory: (id: string, dir: 'up' | 'down') => Promise<Res>;
    setCategoryActive: (id: string, active: boolean) => Promise<Res>;
    mergeCategory: (from: string, to: string) => Promise<Res>;
    saveTag: (id: string | null, name: string, kind: string) => Promise<Res>;
    deleteTag: (id: string) => Promise<Res>;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(categories.find((c) => c.level === 1)?.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(categories.filter((c) => c.level === 1).slice(0, 1).map((c) => c.id)));
  const [showHidden, setShowHidden] = useState(false);

  const children = useMemo(() => {
    const m = new Map<string | null, CatRow[]>();
    for (const c of categories) m.set(c.parent_id, [...(m.get(c.parent_id) ?? []), c]);
    m.forEach((l) => l.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    return m;
  }, [categories]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  // rolled-up product counts
  const totals = useMemo(() => {
    const t = new Map<string, number>();
    const walk = (c: CatRow): number => { const n = c.products + (children.get(c.id) ?? []).reduce((a, k) => a + walk(k), 0); t.set(c.id, n); return n; };
    (children.get(null) ?? []).forEach(walk);
    return t;
  }, [children]);
  const pathOf = (id: string) => { const out: CatRow[] = []; let c = byId.get(id); while (c) { out.unshift(c); c = c.parent_id ? byId.get(c.parent_id) : undefined; } return out; };
  const sel = selected ? byId.get(selected) : undefined;

  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved' : r.error ?? 'Failed' });
    if (r.ok) { after?.(); router.refresh(); }
  });

  const renderTree = (parent: string | null, depth: number): React.ReactNode => {
    const list = (children.get(parent) ?? []).filter((c) => showHidden || c.active);
    if (!list.length) return null;
    return (
      <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Category tree' : undefined}>
        {list.map((c) => {
          const kids = (children.get(c.id) ?? []).filter((k) => showHidden || k.active);
          const isOpen = open.has(c.id);
          return (
            <li key={c.id} role="treeitem" aria-expanded={kids.length ? isOpen : undefined} aria-selected={selected === c.id}>
              <div className={cn('flex items-center gap-2 pr-4 py-2 border-l-[3px]', selected === c.id ? 'bg-tint border-coral-text' : 'border-transparent hover:bg-pearl')} style={{ paddingLeft: 12 + depth * 20 }}>
                {kids.length ? (
                  <button type="button" className="w-5 text-muted text-xs" aria-label={isOpen ? `Collapse ${c.name}` : `Expand ${c.name}`}
                    onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : <span className="w-5" aria-hidden />}
                <span className={cn('mono text-[10px] font-bold rounded px-1', c.level === 1 ? 'bg-ink text-white' : 'bg-tint text-coral-text')}>L{c.level}</span>
                <button type="button" className={cn('flex-1 text-left text-[15px]', selected === c.id && 'font-semibold', !c.active && 'line-through text-muted')} onClick={() => setSelected(c.id)}>
                  {c.name}{!c.active && <span className="sr-only"> (hidden)</span>}
                </button>
                <span className="mono text-xs text-muted">{totals.get(c.id) ?? 0}</span>
              </div>
              {isOpen && renderTree(c.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const tagsByKind = useMemo(() => {
    const m = new Map<string, TagRow[]>();
    for (const t of tags) m.set(t.kind, [...(m.get(t.kind) ?? []), t]);
    return m;
  }, [tags]);

  return (
    <div className="space-y-6">
      {msg && <div role="status" className={cn('rounded-[10px] border px-4 py-3 text-sm', msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad')}>{msg.text}</div>}
      <div className="grid lg:grid-cols-[420px_1fr] gap-6 items-start">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="text-lg font-semibold">Category tree</h2>
            <span className="mono text-xs text-muted">{categories.filter((c) => c.active).length} categories</span>
          </div>
          <div className="py-2 max-h-[640px] overflow-y-auto">
            {renderTree(null, 0) ?? <p className="px-5 py-6 text-sm text-muted">No categories yet.</p>}
          </div>
          <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-3">
            <label className="text-sm inline-flex items-center gap-2"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden</label>
            {canEdit && <AddInline label="+ Top-level category" disabled={pending} onAdd={(n) => run(() => actions.createCategory(null, n))} />}
          </div>
        </section>

        {sel ? (
          <CategoryDetail key={sel.id} cat={sel} path={pathOf(sel.id)} total={totals.get(sel.id) ?? 0} canEdit={canEdit} pending={pending}
            mergeTargets={categories.filter((c) => c.id !== sel.id && c.active && !pathOf(c.id).some((p) => p.id === sel.id))}
            pathLabel={(id) => pathOf(id).map((p) => p.name).join(' › ')}
            onSave={(f) => run(() => actions.updateCategory(sel.id, f))}
            onMove={(d) => run(() => actions.moveCategory(sel.id, d))}
            onActive={(a) => run(() => actions.setCategoryActive(sel.id, a))}
            onAddChild={(n) => run(() => actions.createCategory(sel.id, n), () => setOpen((s) => new Set(s).add(sel.id)))}
            onMerge={(to) => run(() => actions.mergeCategory(sel.id, to), () => setSelected(to))}
          />
        ) : <section className="card p-6 text-muted">Select a category.</section>}
      </div>

      <section className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Tags</h2>
            <p className="text-sm text-muted">Add tags to products in Create product. Tags show as badges and work as filters.</p>
          </div>
          <span className="mono text-xs text-muted">{tags.length} tags</span>
        </div>
        {canEdit && <NewTag pending={pending} onAdd={(n, k) => run(() => actions.saveTag(null, n, k))} />}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
          {[...tagsByKind.entries()].map(([kind, list]) => (
            <div key={kind} className="rounded-[10px] border border-line p-4">
              <div className="flex justify-between mb-3"><h3 className="font-semibold capitalize">{kind.replace('_', ' ')}</h3><span className="text-xs text-muted">{list.length}</span></div>
              <ul className="space-y-2">
                {list.map((t) => <TagItem key={t.id} tag={t} canEdit={canEdit} pending={pending}
                  onSave={(n, k) => run(() => actions.saveTag(t.id, n, k))}
                  onDelete={() => { if (window.confirm(`Delete tag “${t.name}”? It will be removed from ${t.products} products.`)) run(() => actions.deleteTag(t.id)); }} />)}
              </ul>
            </div>
          ))}
          {!tags.length && <p className="text-sm text-muted">No tags yet.</p>}
        </div>
      </section>
    </div>
  );
}

function AddInline({ label, onAdd, disabled }: { label: string; onAdd: (name: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) return <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); setOpen(false); } }}>
      <label className="sr-only" htmlFor="add-inline">Category name</label>
      <input id="add-inline" autoFocus className="input min-h-9 text-sm" value={v} onChange={(e) => setV(e.target.value)} placeholder="Name" />
      <button className="btn btn-primary btn-sm" disabled={disabled || !v.trim()}>Add</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function CategoryDetail({ cat, path, total, canEdit, pending, mergeTargets, pathLabel, onSave, onMove, onActive, onAddChild, onMerge }: {
  cat: CatRow; path: CatRow[]; total: number; canEdit: boolean; pending: boolean; mergeTargets: CatRow[]; pathLabel: (id: string) => string;
  onSave: (f: { name: string; hs_code: string | null }) => void; onMove: (d: 'up' | 'down') => void; onActive: (a: boolean) => void;
  onAddChild: (n: string) => void; onMerge: (to: string) => void;
}) {
  const [name, setName] = useState(cat.name);
  const [hs, setHs] = useState(cat.hs_code ?? '');
  const [child, setChild] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  return (
    <section className="card p-6">
      <nav aria-label="Category path" className="text-sm text-muted">{path.map((p) => p.name).join(' › ')}</nav>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <h2 className="text-2xl font-semibold">{cat.name}</h2>
        <span className="text-xs font-semibold rounded-full bg-tint text-coral-text px-2 py-1">Level {cat.level} of 4</span>
        <span className="text-xs font-semibold rounded-full bg-pearl border border-line px-2 py-1">{total} products</span>
        {!cat.active && <span className="text-xs font-semibold rounded-full bg-warn-bg text-warn px-2 py-1">Hidden</span>}
      </div>
      <form className="grid sm:grid-cols-2 gap-4 mt-5" onSubmit={(e) => { e.preventDefault(); onSave({ name, hs_code: hs || null }); }}>
        <div>
          <label htmlFor="cd-name" className="label">Name</label>
          <input id="cd-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <span className="label">URL slug</span>
          <div className="input flex items-center bg-pearl mono text-sm overflow-hidden">{[...path.slice(0, -1).map((p) => p.slug), slugify(name)].join('/')}</div>
        </div>
        <div>
          <label htmlFor="cd-hs" className="label">Default HS code</label>
          <input id="cd-hs" className="input mono" value={hs} onChange={(e) => setHs(e.target.value)} disabled={!canEdit} placeholder="e.g. 7318.15" />
        </div>
        <div className="flex items-end">{canEdit && <button className="btn btn-dark" disabled={pending}>Save changes</button>}</div>
      </form>

      {canEdit && (
        <>
          <div className="border-t border-line mt-6 pt-5 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onMove('up')}>↑ Move up</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onMove('down')}>↓ Move down</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
              onClick={() => { if (cat.active ? window.confirm(`Hide “${cat.name}” from menus and filters?`) : true) onActive(!cat.active); }}>{cat.active ? 'Hide (deactivate)' : 'Show (activate)'}</button>
          </div>

          {cat.level < 4 ? (
            <form className="mt-5 flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (child.trim()) { onAddChild(child.trim()); setChild(''); } }}>
              <div className="flex-1 min-w-[200px]">
                <label htmlFor="cd-child" className="label">New subcategory (level {cat.level + 1})</label>
                <input id="cd-child" className="input" value={child} onChange={(e) => setChild(e.target.value)} placeholder="e.g. Hex bolts" />
              </div>
              <button className="btn btn-primary" disabled={pending || !child.trim()}>+ Add subcategory</button>
            </form>
          ) : <p className="mt-5 text-sm text-warn">This is level 4, the deepest level. Add products here, not subcategories.</p>}

          <form className="mt-5 flex flex-wrap gap-2 items-end" onSubmit={(e) => {
            e.preventDefault();
            if (mergeTo && window.confirm(`Merge “${cat.name}” into “${pathLabel(mergeTo)}”? All ${total} products move and “${cat.name}” is deactivated.`)) onMerge(mergeTo);
          }}>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="cd-merge" className="label">Merge into</label>
              <select id="cd-merge" className="input" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
                <option value="">Choose a category…</option>
                {mergeTargets.map((c) => <option key={c.id} value={c.id}>{pathLabel(c.id)}</option>)}
              </select>
            </div>
            <button className="btn btn-ghost" disabled={pending || !mergeTo}>Merge</button>
          </form>
        </>
      )}
      <p className="text-xs text-muted mt-5">Moving products between categories happens through merge; every change is written to the audit log.</p>
    </section>
  );
}

function NewTag({ onAdd, pending }: { onAdd: (n: string, k: string) => void; pending: boolean }) {
  const [n, setN] = useState('');
  const [k, setK] = useState('feature');
  return (
    <form className="mt-4 rounded-[10px] bg-pearl p-4 flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); if (n.trim()) { onAdd(n.trim(), k); setN(''); } }}>
      <div className="flex-1 min-w-[200px]">
        <label htmlFor="nt-name" className="label">New tag</label>
        <input id="nt-name" className="input" value={n} onChange={(e) => setN(e.target.value)} placeholder="e.g. Marine grade" />
      </div>
      <div>
        <label htmlFor="nt-kind" className="label">Group</label>
        <select id="nt-kind" className="input" value={k} onChange={(e) => setK(e.target.value)}>{TAG_KINDS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select>
      </div>
      <button className="btn btn-primary" disabled={pending || !n.trim()}>Add tag</button>
    </form>
  );
}

function TagItem({ tag, canEdit, pending, onSave, onDelete }: { tag: TagRow; canEdit: boolean; pending: boolean; onSave: (n: string, k: string) => void; onDelete: () => void }) {
  const [edit, setEdit] = useState(false);
  const [n, setN] = useState(tag.name);
  const [k, setK] = useState(tag.kind);
  if (edit) return (
    <li>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); onSave(n, k); setEdit(false); }}>
        <input aria-label="Tag name" className="input min-h-9 text-sm flex-1" value={n} onChange={(e) => setN(e.target.value)} />
        <select aria-label="Tag group" className="input min-h-9 text-sm w-auto" value={k} onChange={(e) => setK(e.target.value)}>{TAG_KINDS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select>
        <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancel</button>
      </form>
    </li>
  );
  return (
    <li className="flex items-center gap-2">
      <span className="rounded-full bg-tint text-coral-text text-sm font-semibold px-3 py-1">{tag.name} <span className="mono text-[11px] text-coral-text">{tag.products}</span></span>
      {canEdit && <>
        <button type="button" className="text-xs text-coral-text font-semibold" onClick={() => setEdit(true)} aria-label={`Edit tag ${tag.name}`}>Edit</button>
        <button type="button" className="text-xs text-bad font-semibold" onClick={onDelete} aria-label={`Delete tag ${tag.name}`}>Delete</button>
      </>}
    </li>
  );
}
