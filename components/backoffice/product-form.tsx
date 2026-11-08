'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { money, CURRENCIES, CURRENCY_PREFIX, asCurrency } from '@/lib/format';
import { productSchema, INCOTERMS, UNITS, type ProductFormValues } from './product-schema';

type Result = { ok: boolean; error?: string; message?: string; data?: { id: string } };
export type FormSupplier = { id: string; code: string; legal_name: string; country: string; product_upload: boolean; ai_tools: boolean };
export type FormCategory = { id: string; name: string; parent_id: string | null; level: number; hs_code: string | null };
export type FormTag = { id: string; name: string; kind: string };
export type FormCert = { id: string; supplier_id: string; name: string; issuer: string | null; status: string; expires_at: string | null };

export function ProductForm({
  productId: initialId, status, initial, hsInfo, suppliers, categories, tags, certificates, countries, aiMode, saveAction, submitAction,
}: {
  productId: string | null; status: string; initial: ProductFormValues; hsInfo?: { status: string | null; source: string | null; note: string | null } | null; suppliers: FormSupplier[]; categories: FormCategory[];
  tags: FormTag[]; certificates: FormCert[]; countries: Record<string, string>; aiMode: 'live' | 'mock';
  saveAction: (id: string | null, v: ProductFormValues, mode: 'draft' | 'full') => Promise<Result>;
  submitAction: (id: string, to: 'submitted') => Promise<Result>;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState<string | null>(initialId);
  const [saveState, setSaveState] = useState<{ tone: 'ok' | 'bad' | 'muted'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [poster, setPoster] = useState<{ headline: string; tagline: string; bullets: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const editable = ['draft', 'rejected'].includes(status);

  const form = useForm<ProductFormValues>({ resolver: zodResolver(productSchema) as Resolver<ProductFormValues>, defaultValues: initial, mode: 'onBlur' });
  const { register, control, watch, setValue, getValues, handleSubmit, formState: { errors } } = form;
  const tiers = useFieldArray({ control, name: 'tiers' });
  const specs = useFieldArray({ control, name: 'specs' });

  const supplierId = watch('supplier_id');
  const categoryId = watch('category_id');
  const tagIds = watch('tag_ids') ?? [];
  const certIds = watch('certificate_ids') ?? [];
  const images = watch('images') ?? [];
  const title = watch('title') ?? '';
  const supplier = suppliers.find((s) => s.id === supplierId);
  const uploadBlocked = !!supplier && !supplier.product_upload;
  const aiBlocked = !supplier || !supplier.ai_tools;

  /* ── 4-level cascading category picker ── */
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const path = useMemo(() => {
    const out: string[] = [];
    let cur = categoryId ? byId.get(categoryId) : undefined;
    while (cur) { out.unshift(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    return out;
  }, [categoryId, byId]);
  const pickLevel = (level: number, id: string) => {
    const next = id || path[level - 2] || null; // empty → fall back to parent
    setValue('category_id', next, { shouldDirty: true });
    const cat = id ? byId.get(id) : undefined;
    if (cat?.hs_code && !getValues('hs_code')) setValue('hs_code', cat.hs_code, { shouldDirty: true });
  };
  const categoryLabel = path.map((id) => byId.get(id)?.name).join(' › ');

  /* ── autosave drafts (debounced) ── */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(productId);
  useEffect(() => { idRef.current = productId; }, [productId]);
  useEffect(() => {
    if (!editable) return;
    const sub = watch((v, { type }) => {
      if (type !== 'change' && type !== undefined) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const vals = getValues();
        if (!vals.title?.trim() || !vals.supplier_id) return;
        if (suppliers.find((s) => s.id === vals.supplier_id)?.product_upload === false) return;
        setSaveState({ tone: 'muted', text: 'Saving draft…' });
        const r = await saveAction(idRef.current, vals, 'draft');
        if (r.ok && r.data?.id) {
          if (!idRef.current) {
            idRef.current = r.data.id;
            setProductId(r.data.id);
            window.history.replaceState(null, '', `/distributor/products/${r.data.id}/edit`);
          }
          setSaveState({ tone: 'ok', text: `Draft saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
        } else setSaveState({ tone: 'bad', text: r.error ?? 'Autosave failed' });
      }, 2000);
    });
    return () => { sub.unsubscribe(); if (timer.current) clearTimeout(timer.current); };
  }, [watch, getValues, saveAction, editable, suppliers]);

  const onSave = handleSubmit((v) => start(async () => {
    const r = await saveAction(productId, v, 'full');
    if (!r.ok) { setSaveState({ tone: 'bad', text: r.error ?? 'Save failed' }); return; }
    if (!productId && r.data?.id) { setProductId(r.data.id); window.history.replaceState(null, '', `/distributor/products/${r.data.id}/edit`); }
    setSaveState({ tone: 'ok', text: 'Saved' });
    router.refresh();
  }), () => setSaveState({ tone: 'bad', text: 'Fix the highlighted fields' }));

  const onSubmitModeration = handleSubmit((v) => start(async () => {
    const r = await saveAction(productId, v, 'full');
    if (!r.ok || !r.data?.id) { setSaveState({ tone: 'bad', text: r.error ?? 'Save failed' }); return; }
    const t = await submitAction(r.data.id, 'submitted');
    if (!t.ok) { setProductId(r.data.id); setSaveState({ tone: 'bad', text: t.error ?? 'Submit failed' }); return; }
    router.push('/distributor/products?status=submitted');
  }), () => setSaveState({ tone: 'bad', text: 'Fix the highlighted fields before submitting' }));

  /* ── image upload to public bucket product-media ── */
  async function upload(files: FileList | null) {
    if (!files?.length || !supplierId) { if (!supplierId) setAiNote('Choose a supplier before uploading photos.'); return; }
    setUploading(true);
    const sb = createClient();
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const path = `${supplierId}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9.]+/g, '-').toLowerCase()}`;
      const { error } = await sb.storage.from('product-media').upload(path, f, { contentType: f.type });
      if (error) { setAiNote(`Upload failed: ${error.message}`); continue; }
      urls.push(sb.storage.from('product-media').getPublicUrl(path).data.publicUrl);
    }
    setValue('images', [...getValues('images'), ...urls], { shouldDirty: true });
    setUploading(false);
  }

  /* ── AI tools via POST /api/ai ── */
  async function runAi(kind: 'seo_fix' | 'description' | 'poster' | 'photo_enhance') {
    const v = getValues();
    setAiNote(null);
    if (!v.title?.trim()) { setAiNote('Add a product title first.'); return; }
    if (!v.supplier_id) { setAiNote('Choose a supplier first.'); return; }
    setAiBusy(kind);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, supplier_id: v.supplier_id, product_id: productId,
          input: {
            title: v.title, description: v.description ?? null, category: categoryLabel || null,
            specs: Object.fromEntries((v.specs ?? []).filter((s) => s.name).map((s) => [s.name, s.value])),
            moq: Number.isFinite(v.moq) ? v.moq : undefined, unit: v.unit, image_url: v.images?.[0],
          },
        }),
      });
      const j = await res.json();
      if (!j.ok) { setAiNote(j.error ?? 'AI request failed'); return; }
      const o = j.output;
      if (kind === 'seo_fix') {
        setValue('seo_title', o.seo_title ?? '', { shouldDirty: true });
        setValue('seo_description', o.seo_description ?? '', { shouldDirty: true });
        setAiNote('SEO title and meta description updated — review before saving.');
      } else if (kind === 'description') {
        setValue('description', o.description ?? '', { shouldDirty: true });
        setAiNote('Description written — review before saving.');
      } else if (kind === 'poster') {
        setPoster(o);
        setAiNote('Poster copy generated below.');
      } else {
        if (o.image_url && o.image_url !== v.images?.[0]) setValue('images', [o.image_url, ...v.images], { shouldDirty: true });
        setAiNote(o.note ?? 'Photo processed.');
      }
    } catch (e) {
      setAiNote((e as Error).message);
    } finally { setAiBusy(null); }
  }

  /* ── completeness + preview ── */
  const tierVals = watch('tiers') ?? [];
  const cur = asCurrency(watch('currency'));
  const prices = tierVals.map((t) => Number(t.price)).filter((n) => Number.isFinite(n));
  const checks = [
    { ok: title.trim().length >= 10, label: 'Descriptive title (10+ characters)' },
    { ok: !!categoryId, label: 'Category chosen' },
    { ok: prices.length > 0, label: 'At least one price tier' },
    { ok: images.length > 0, label: 'Main photo' },
    { ok: (watch('description') ?? '').length >= 80, label: 'Description (80+ characters)' },
    { ok: !!watch('hs_code'), label: 'HS code' },
    { ok: (watch('specs') ?? []).length >= 2, label: 'At least 2 specifications' },
    { ok: !!watch('seo_title') && !!watch('seo_description'), label: 'SEO title and meta description' },
  ];
  const pct = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  const err = (m?: { message?: string }) => m?.message ? <p className="text-xs text-bad mt-1" role="alert">{m.message}</p> : null;
  const supCerts = certificates.filter((c) => c.supplier_id === supplierId);
  const levelOptions = (level: number) => categories.filter((c) => c.level === level && (level === 1 ? !c.parent_id : c.parent_id === path[level - 2]));

  return (
    <form onSubmit={onSave} className="grid lg:grid-cols-[1fr_320px] gap-6 items-start" noValidate>
      <div className="space-y-6 min-w-0">
        {/* Supplier */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Supplier</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pf-sup" className="label">Supplier *</label>
              <select id="pf-sup" className="input" {...register('supplier_id')}>
                <option value="">Choose…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.legal_name}{!s.product_upload ? ' (upload off)' : ''}</option>)}
              </select>
              {err(errors.supplier_id)}
            </div>
            <div>
              <span className="label">Octopus product status</span>
              <div className="input flex items-center bg-pearl mono text-sm">{productId ? status : 'new (autosaves as draft)'}</div>
            </div>
          </div>
          {uploadBlocked && <p className="mt-3 text-sm text-bad" role="alert">Product upload is switched off for {supplier?.code}. Turn it on in Suppliers to add or edit products.</p>}
          <p className="text-xs text-muted mt-3">Buyers only ever see the supplier code, never the company name.</p>
        </section>

        {/* Basics */}
        <section className="card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Basics</h2>
          <div>
            <label htmlFor="pf-sku" className="label">SKU (Product Id)</label>
            <input id="pf-sku" className="input mono uppercase" maxLength={40} {...register('sku')} readOnly={!!productId} aria-describedby="pf-sku-hint"
              placeholder={productId ? '' : 'e.g. FST-BLT-M10X40-A2 — leave blank for an automatic one'} />
            <p id="pf-sku-hint" className="text-xs text-muted mt-1">{productId ? 'The SKU is fixed once the product exists (an Admin can change it).' : '3–40 characters, letters/digits/dash/dot/underscore, no spaces. Unique across the whole platform and never reused.'}</p>
            {err(errors.sku)}
          </div>
          <div>
            <label htmlFor="pf-title" className="label">Product title *</label>
            <input id="pf-title" className="input" maxLength={160} {...register('title')} placeholder="e.g. Stainless steel hex bolts, M10 × 40 mm, A2-70" />
            <p className="text-xs text-muted mt-1">{title.length} / 120 characters · include material, size and standard</p>
            {err(errors.title)}
          </div>
          <fieldset>
            <legend className="label">Category * <span className="font-normal text-muted">· up to 4 levels</span></legend>
            <div className="grid sm:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((lvl) => {
                const opts = levelOptions(lvl);
                const disabled = lvl > 1 && (!path[lvl - 2] || opts.length === 0);
                return (
                  <select key={lvl} aria-label={`Category level ${lvl}`} className="input" disabled={disabled} value={path[lvl - 1] ?? ''} onChange={(e) => pickLevel(lvl, e.target.value)}>
                    <option value="">{lvl === 1 ? 'Level 1…' : disabled ? '—' : `Level ${lvl} (optional)`}</option>
                    {opts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                );
              })}
            </div>
            <p className="text-xs text-muted mt-1">Missing a category? <Link href="/distributor/catalog" className="text-coral-text font-semibold">Add it in Categories &amp; tags</Link>. The category sets the default HS code.</p>
            {err(errors.category_id)}
          </fieldset>
          <fieldset>
            <legend className="label">Tags</legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button key={t.id} type="button" aria-pressed={on}
                    onClick={() => setValue('tag_ids', on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id], { shouldDirty: true })}
                    className={cn('rounded-full px-3 py-1 text-xs font-semibold border', on ? 'bg-tint border-coral-text text-coral-text' : 'bg-white border-line-strong text-muted')}>
                    {on ? '✓ ' : '+ '}{t.name}<span className="sr-only"> ({t.kind})</span>
                  </button>
                );
              })}
              {!tags.length && <span className="text-sm text-muted">No tags yet — add them in Categories &amp; tags.</span>}
            </div>
          </fieldset>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="pf-desc" className="label">Description</label>
              <button type="button" className="btn btn-ghost btn-sm" disabled={aiBlocked || !!aiBusy} onClick={() => runAi('description')}>{aiBusy === 'description' ? 'Writing…' : '✦ Write description'}</button>
            </div>
            <textarea id="pf-desc" className="input min-h-32 py-2" {...register('description')} />
            {err(errors.description)}
          </div>
        </section>

        {/* Photos */}
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Photos</h2>
            <span className="text-xs font-semibold rounded-full bg-tint text-coral-text px-2 py-1">AI tools · {aiMode === 'live' ? 'live' : 'mock'}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {images.map((url, i) => (
              <div key={url + i} className={cn('relative w-28 h-28 rounded-[10px] overflow-hidden border', i === 0 ? 'border-ink border-2' : 'border-line')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={i === 0 ? 'Main photo' : `Photo ${i + 1}`} className="w-full h-full object-cover" />
                <span className="absolute left-1 top-1 text-[10px] font-semibold bg-white/90 rounded px-1">{i === 0 ? 'Main' : i + 1}</span>
                <div className="absolute right-1 bottom-1 flex gap-1">
                  {i > 0 && <button type="button" className="text-[10px] bg-white/90 rounded px-1 font-semibold" onClick={() => setValue('images', [url, ...images.filter((_, j) => j !== i)], { shouldDirty: true })}>Make main</button>}
                  <button type="button" aria-label={`Remove photo ${i + 1}`} className="text-[10px] bg-white/90 rounded px-1 font-semibold text-bad" onClick={() => setValue('images', images.filter((_, j) => j !== i), { shouldDirty: true })}>✕</button>
                </div>
              </div>
            ))}
            <label className="w-28 h-28 rounded-[10px] border-2 border-dashed border-line-strong flex items-center justify-center text-sm font-semibold text-coral-text cursor-pointer text-center">
              {uploading ? 'Uploading…' : '+ Add photos'}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => upload(e.target.files)} disabled={uploading} />
            </label>
          </div>
          <div className="mt-4 rounded-[10px] border border-line bg-pearl p-4">
            <div className="font-semibold text-sm">Enhance photos with AI</div>
            <p className="text-xs text-muted mt-1">White background, remove supplier logos and watermarks, auto-crop. Only enhance photos you have the right to use. Originals are always kept.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" className="btn btn-primary btn-sm" disabled={aiBlocked || !!aiBusy || !images.length} onClick={() => runAi('photo_enhance')}>{aiBusy === 'photo_enhance' ? 'Enhancing…' : '✦ Enhance photo'}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={aiBlocked || !!aiBusy} onClick={() => runAi('poster')}>{aiBusy === 'poster' ? 'Creating…' : '✦ Make poster'}</button>
            </div>
            {poster && (
              <div className="mt-4 rounded-[10px] bg-ink text-white p-5 max-w-sm">
                <div className="font-display text-xl font-bold">{poster.headline}</div>
                <div className="text-sm opacity-80 mt-1">{poster.tagline}</div>
                <ul className="mt-3 text-sm list-disc pl-5">{poster.bullets?.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            )}
          </div>
        </section>

        {/* SEO */}
        <section className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">SEO</h2>
              <p className="text-sm text-muted">Fix it with one click before saving.</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={aiBlocked || !!aiBusy} onClick={() => runAi('seo_fix')}>{aiBusy === 'seo_fix' ? 'Fixing…' : '✦ Fix SEO with AI'}</button>
          </div>
          <div>
            <label htmlFor="pf-seot" className="label">SEO title</label>
            <input id="pf-seot" className="input" {...register('seo_title')} maxLength={160} />
            <p className="text-xs text-muted mt-1">{(watch('seo_title') ?? '').length} / 60 recommended</p>
          </div>
          <div>
            <label htmlFor="pf-seod" className="label">Meta description</label>
            <textarea id="pf-seod" className="input min-h-20 py-2" {...register('seo_description')} maxLength={320} />
            <p className="text-xs text-muted mt-1">{(watch('seo_description') ?? '').length} / 155 recommended</p>
          </div>
        </section>

        {aiNote && <div role="status" className="rounded-[10px] border border-coral-text/30 bg-tint px-4 py-3 text-sm text-coral-text">{aiNote}</div>}
        {aiBlocked && supplier && <p className="text-sm text-warn">AI tools are switched off for {supplier.code}.</p>}

        {/* Price tiers */}
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Price tiers ({cur})</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              const last = tierVals[tierVals.length - 1];
              tiers.append({ min_qty: last ? Number(last.min_qty) * 5 || 1 : getValues('moq') || 1, price: last ? Number(last.price) : NaN });
            }}>+ Add tier</button>
          </div>
          <div className="grid sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label htmlFor="pf-cur" className="label">Currency</label>
              <select id="pf-cur" className="input" aria-describedby="pf-cur-hint" {...register('currency')}>{CURRENCIES.map((c) => <option key={c} value={c}>{c} ({CURRENCY_PREFIX[c]})</option>)}</select>
              <p id="pf-cur-hint" className="text-xs text-muted mt-1">1688 suppliers quote CNY</p>
            </div>
            <div>
              <label htmlFor="pf-unit" className="label">Unit</label>
              <select id="pf-unit" className="input" {...register('unit')}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
            </div>
            <div>
              <label htmlFor="pf-moq" className="label">MOQ *</label>
              <input id="pf-moq" type="number" min={1} className="input mono" {...register('moq', { valueAsNumber: true })} />
              {err(errors.moq)}
            </div>
            <div>
              <label htmlFor="pf-lead" className="label">Lead time (days)</label>
              <input id="pf-lead" type="number" min={0} className="input mono" {...register('lead_time_days', { setValueAs: (v) => (v === '' || v == null ? null : Number(v)) })} />
            </div>
          </div>
          <div className="space-y-2">
            {tiers.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <div>
                  <label htmlFor={`t-q-${i}`} className="label text-xs">From qty</label>
                  <input id={`t-q-${i}`} type="number" min={1} className="input mono" {...register(`tiers.${i}.min_qty`, { valueAsNumber: true })} />
                  {err(errors.tiers?.[i]?.min_qty)}
                </div>
                <div>
                  <label htmlFor={`t-p-${i}`} className="label text-xs">Price per unit ({cur})</label>
                  <input id={`t-p-${i}`} type="number" min={0} step="0.001" className="input mono" {...register(`tiers.${i}.price`, { valueAsNumber: true })} />
                  {err(errors.tiers?.[i]?.price)}
                </div>
                <button type="button" className="btn btn-ghost btn-sm mt-6" aria-label={`Remove tier ${i + 1}`} disabled={tiers.fields.length === 1} onClick={() => tiers.remove(i)}>Remove</button>
              </div>
            ))}
          </div>
          {err(errors.tiers?.root ?? (errors.tiers as { message?: string } | undefined))}
          <p className="text-xs text-muted mt-3">Quantities must go up from tier to tier. All tiers use one currency; prices are stored in {cur} minor units ({cur === 'CNY' ? 'fen' : 'cents'}). The storefront converts them to the platform currency at the approved rate.</p>
        </section>

        {/* Specs */}
        <section className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Specifications</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => specs.append({ name: '', value: '' })}>+ Add row</button>
          </div>
          <div className="space-y-2">
            {specs.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1.4fr_auto] gap-3">
                <input aria-label={`Spec ${i + 1} name`} className="input" placeholder="e.g. Material" {...register(`specs.${i}.name`)} />
                <input aria-label={`Spec ${i + 1} value`} className="input" placeholder="e.g. Stainless steel A2-70" {...register(`specs.${i}.value`)} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove spec ${i + 1}`} onClick={() => specs.remove(i)}>Remove</button>
              </div>
            ))}
            {!specs.fields.length && <p className="text-sm text-muted">No specifications yet.</p>}
          </div>
        </section>

        {/* Shipping & customs */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Shipping &amp; customs</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="pf-hs" className="label">HS code</label>
              <input id="pf-hs" className="input mono" {...register('hs_code')} placeholder="Leave blank to detect automatically" />
              {hsInfo?.status === 'suggested' && <p className="text-xs mt-1 text-warn" data-testid="hs-suggested">Suggested by {hsInfo.source === 'ai' ? 'the AI classifier' : 'a product-type rule'} — check it. Typing a code here makes it a manual (confirmed) code.</p>}
              {hsInfo?.status === 'confirmed' && hsInfo.source && <p className="text-xs mt-1 text-ok">Confirmed ({hsInfo.source === 'sheet' ? 'from the import sheet' : hsInfo.source === 'manual' ? 'entered manually' : 'product-type rule'})</p>}
              {hsInfo?.status === 'missing' && hsInfo.note && <p className="text-xs mt-1 text-bad">{hsInfo.note}</p>}
              {!hsInfo && <p className="text-xs mt-1 text-muted">Blank = a 4-digit heading is detected automatically after saving.</p>}
            </div>
            <div>
              <label htmlFor="pf-origin" className="label">Country of origin</label>
              <select id="pf-origin" className="input" {...register('origin_country')}>
                <option value="">—</option>
                {Object.entries(countries).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pf-inc" className="label">Incoterm</label>
              <select id="pf-inc" className="input" {...register('incoterm')}>{INCOTERMS.map((i) => <option key={i}>{i}</option>)}</select>
            </div>
          </div>
        </section>

        {/* Certificates & services */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Certificates &amp; services</h2>
          <fieldset>
            <legend className="label">Supplier certificates</legend>
            {!supplierId ? <p className="text-sm text-muted">Choose a supplier to see its certificates.</p>
              : !supCerts.length ? <p className="text-sm text-muted">No certificates on file for this supplier.</p>
                : (
                  <ul className="space-y-2">
                    {supCerts.map((c) => (
                      <li key={c.id} className="flex items-center gap-3">
                        <input id={`cert-${c.id}`} type="checkbox" checked={certIds.includes(c.id)} disabled={['expired', 'rejected'].includes(c.status)}
                          onChange={(e) => setValue('certificate_ids', e.target.checked ? [...certIds, c.id] : certIds.filter((x) => x !== c.id), { shouldDirty: true })} />
                        <label htmlFor={`cert-${c.id}`} className="text-sm">{c.name}{c.issuer ? ` · ${c.issuer}` : ''}{c.expires_at ? ` · valid until ${c.expires_at}` : ''}</label>
                        <span className="text-xs font-semibold rounded-full bg-pearl border border-line px-2 py-0.5">{c.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
            <p className="text-xs text-muted mt-2">A certificate tag shows on the product only while the certificate is verified; expired certificates hide automatically.</p>
          </fieldset>
          <div className="mt-4 flex flex-wrap gap-6">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" {...register('octopus_dropship')} /> Available on Octopus Dropship</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" {...register('ready_to_ship')} /> Ready to ship</label>
          </div>
        </section>
      </div>

      {/* Sidebar */}
      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="card overflow-hidden">
          {images[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={images[0]} alt="" className="w-full h-44 object-cover" />
            : <div className="ph h-44">Main photo</div>}
          <div className="p-4">
            <div className="eyebrow text-muted">Buyer preview</div>
            <div className="font-semibold mt-1">{title || 'Product title'}</div>
            <div className="mono font-bold text-lg mt-1">
              {prices.length ? `${money(Math.round(Math.min(...prices) * 100), cur)}${prices.length > 1 ? `–${money(Math.round(Math.max(...prices) * 100), cur)}` : ''}` : '—'}
              <span className="text-xs text-muted font-normal"> / {watch('unit')}</span>
            </div>
            <div className="text-xs text-muted">MOQ {watch('moq') || '—'} {watch('unit')} · Supplier {supplier?.code ?? '—'} · {supplier?.country ?? ''}</div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex justify-between text-sm font-semibold"><span>Listing completeness</span><span className="mono">{pct}%</span></div>
          <div className="h-2 bg-line rounded-full mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Listing completeness">
            <div className="h-2 bg-coral rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {checks.map((c) => <li key={c.label} className={c.ok ? 'text-ok' : 'text-muted'}>{c.ok ? '✓' : '○'} {c.label}</li>)}
          </ul>
        </div>
        <div className="card p-4 space-y-3">
          <div className="text-sm"><span className="text-muted">Status: </span><b>{status}</b></div>
          {saveState && <p role="status" className={cn('text-sm', saveState.tone === 'ok' ? 'text-ok' : saveState.tone === 'bad' ? 'text-bad' : 'text-muted')}>{saveState.text}</p>}
          <button type="submit" className="btn btn-dark w-full" disabled={pending || uploadBlocked}>{pending ? 'Saving…' : 'Save product'}</button>
          {editable && <button type="button" className="btn btn-primary w-full" disabled={pending || uploadBlocked} onClick={onSubmitModeration}>Submit for moderation</button>}
          <p className="text-xs text-muted">{editable ? 'Drafts autosave every few seconds. Moderation publishes the listing.' : 'This product is not a draft — changes save only when you click Save.'}</p>
          <p className="text-xs text-muted">AI mode: <b>{aiMode}</b>{aiMode === 'mock' ? ' (set OPENAI_API_KEY for live results)' : ''}</p>
        </div>
      </aside>
    </form>
  );
}
