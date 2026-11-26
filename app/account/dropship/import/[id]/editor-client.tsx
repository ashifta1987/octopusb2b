'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  DsBadge, DsButton, DsCard, DsCheckbox, DsIcon, DsInput, DsNotice, DsPageHeader, DsRadioCard, DsSwitch, DsTableCard, DsTextarea,
} from '@/components/dropship-ui';
import { money } from '@/lib/format';
import {
  computePrice, minorToInput, parseMoneyToMinor, pct, profitBp, ruleSummary, storeMoney, STOCK_TEXT, STOCK_TONE,
} from '@/lib/dropship-pricing';
import type { ListingState } from '@/lib/dropship-ds6';
import { listingSaveAction, textCheckAction } from '../../ds6-actions';
import { optionText } from '../../ds6-ui';

type VarState = { variant_id: string; include: boolean; store_sku: string; price: string; compare: string };

const FIELD_LABEL: Record<string, string> = {
  title: 'Title', description: 'Description', vendor: 'Vendor', product_type: 'Product type', collection: 'Collection', tags: 'Tags',
  handle: 'URL handle', seo_title: 'Meta title', seo_description: 'Meta description',
};
const fieldLabel = (f: string) => (f.startsWith('sku:') ? 'Store SKU' : FIELD_LABEL[f] ?? f);
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export function EditorClient({ st, crumb, marketName }: { st: ListingState; crumb: ReactNode; marketName: string | null }) {
  const router = useRouter();
  const cur = st.currency;
  const initial = useMemo(() => ({
    title: st.title,
    description: st.description,
    images: st.image_urls,
    vendor: st.vendor ?? '',
    productType: st.product_type ?? '',
    collection: st.collection ?? '',
    tags: st.tags.join(', '),
    handle: st.handle ?? '',
    seoTitle: st.seo_title ?? '',
    seoDesc: st.seo_description ?? '',
    publishAs: st.publish_as,
    syncStock: st.sync_stock,
    syncPrice: st.sync_price,
    manual: st.price_mode === 'manual',
    vars: st.variants.map<VarState>((v) => ({
      variant_id: v.variant_id, include: v.include, store_sku: v.store_sku,
      price: minorToInput(v.manual ? v.manual_price_minor : v.price_minor, cur),
      compare: minorToInput(v.manual ? v.manual_compare_at_minor : v.compare_at_minor, cur),
    })),
  }), [st, cur]);
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; title: string; text?: string } | null>(null);
  const [badFields, setBadFields] = useState<string[]>(st.problems.find((p) => p.code === 'TEXT_CHECK')?.fields?.map((x) => x.field) ?? []);
  const [checking, setChecking] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // live white-label check (field names only come back, never the matched term)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setChecking(true);
      const fields: Record<string, string> = {
        title: f.title, description: f.description, vendor: f.vendor, product_type: f.productType, collection: f.collection, tags: f.tags,
        handle: f.handle, seo_title: f.seoTitle, seo_description: f.seoDesc,
      };
      f.vars.forEach((v) => { if (v.include && v.store_sku) fields[`sku:${v.variant_id}`] = v.store_sku; });
      const r = await textCheckAction(st.product_id, fields);
      setChecking(false);
      if (r.ok) setBadFields(r.data.fields.map((x) => x.field));
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [f.title, f.description, f.vendor, f.productType, f.collection, f.tags, f.handle, f.seoTitle, f.seoDesc, f.vars, st.product_id]);

  const rule = { bands: st.rules.bands, rounding: st.rules.rounding, compare_at_bp: st.rules.compare_at_bp, min_profit_bp: st.rules.min_profit_bp };
  const fx = st.fx?.rate != null ? String(st.fx.rate) : null;
  const rows = st.variants.map((v, i) => {
    const vs = f.vars[i];
    const live = v.landed_usd_cents != null ? computePrice(v.landed_usd_cents, rule, fx, cur) : null;
    const typed = parseMoneyToMinor(vs.price, cur);
    const typedCmp = parseMoneyToMinor(vs.compare, cur);
    const price = f.manual ? typed : live && live.ok ? live.price_minor : null;
    const compare = f.manual ? typedCmp : live && live.ok ? live.compare_at_minor : null;
    const profit = price != null && v.landed_usd_cents != null ? profitBp(price, v.landed_usd_cents, fx, cur) : null;
    return { v, vs, price, compare, profit, live };
  });
  const included = rows.filter((r) => r.vs.include);
  const priced = included.filter((r) => r.price != null);
  const lowest = included.reduce<number | null>((a, r) => (r.profit == null ? a : a == null ? r.profit : Math.min(a, r.profit)), null);
  const textOk = badFields.length === 0;
  const priceErr = f.manual && included.some((r) => r.price == null) ? 'Enter a price for every variant you push.' : null;
  const cmpErr = included.some((r) => r.compare != null && r.price != null && r.compare <= r.price) ? 'Compare-at prices must be higher than the price.' : null;

  function save() {
    setResult(null);
    start(async () => {
      const r = await listingSaveAction(st.product_id, {
        title: f.title.trim(),
        description: f.description,
        image_urls: f.images,
        vendor: f.vendor.trim() || null,
        product_type: f.productType.trim() || null,
        collection: f.collection.trim() || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
        handle: f.handle.trim() || null,
        seo_title: f.seoTitle.trim() || null,
        seo_description: f.seoDesc.trim() || null,
        publish_as: f.publishAs,
        sync_stock: f.syncStock,
        sync_price: f.syncPrice,
        price_mode: f.manual ? 'manual' : 'rule',
        variants: rows.map((r) => ({
          variant_id: r.v.variant_id, include: r.vs.include && r.v.stock_status !== 'out', store_sku: r.vs.store_sku.trim() || null,
          price_minor: f.manual ? parseMoneyToMinor(r.vs.price, cur) : null, compare_at_minor: f.manual ? parseMoneyToMinor(r.vs.compare, cur) : null,
        })),
      });
      if (r.ok) {
        setResult({ tone: 'ok', title: 'Saved', text: r.message });
        router.refresh();
      } else {
        if (r.fields) setBadFields(r.fields.map((x) => x.field));
        setResult({ tone: 'bad', title: r.code === 'TEXT_CHECK' ? `${[...new Set((r.fields ?? []).map((x) => fieldLabel(x.field)))].join(', ')} mention${(r.fields ?? []).length === 1 ? 's' : ''} a supplier name` : 'Not saved', text: r.message });
      }
    });
  }

  const moveImage = (i: number, d: -1 | 1) => setF((s) => {
    const a = [...s.images];
    const j = i + d;
    if (j < 0 || j >= a.length) return s;
    [a[i], a[j]] = [a[j], a[i]];
    return { ...s, images: a };
  });
  const toggleImage = (u: string) => setF((s) => ({ ...s, images: s.images.includes(u) ? s.images.filter((x) => x !== u) : [...s.images, u] }));
  const unchosen = st.octopus_images.filter((u) => !f.images.includes(u));
  const pushDisabledReason = dirty ? 'Save your changes first.' : !st.store ? 'Connect a store first.' : !st.ready ? (st.problems.find((p) => p.blocking)?.message ?? 'Not ready yet.') : undefined;

  return (
    <div className="flex flex-col gap-5" data-testid="ds6-editor">
      {crumb}
      <DsPageHeader
        title="Edit before pushing"
        icon="pencil"
        subtitle="Changes apply to your store only. The Octopus product stays the same."
        actions={
          <>
            <DsButton variant="secondary" icon="x" disabled={!dirty || pending} disabledReason={!dirty ? 'Nothing changed yet.' : undefined} onClick={() => { setF(initial); setResult(null); }} testId="editor-discard">Discard</DsButton>
            <DsButton variant="secondary" icon="check" loading={pending} disabled={pending || !!priceErr || !!cmpErr || (f.images.length === 0 && st.octopus_images.length > 0) || !f.title.trim()}
              disabledReason={priceErr ?? cmpErr ?? (f.images.length === 0 && st.octopus_images.length > 0 ? 'Choose at least one image.' : !f.title.trim() ? 'Enter a title.' : undefined)} onClick={save} testId="editor-save">Save</DsButton>
            <DsButton icon="upload" disabled={Boolean(pushDisabledReason)} disabledReason={pushDisabledReason} testId="editor-push"
              onClick={() => router.push(`/account/dropship/push?ids=${st.product_id}`)}>Push to Shopify</DsButton>
          </>
        }
      />
      {result && <DsNotice tone={result.tone} title={result.title} testId="editor-result">{result.text}</DsNotice>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5 min-w-0">
          <DsCard title="Title and description" icon="pencil" testId="editor-text">
            <div className="flex flex-col gap-3">
              <DsInput id="pt" label="Title" value={f.title} maxLength={255} onChange={(e) => set('title', e.target.value)}
                error={badFields.includes('title') ? 'Remove the supplier or factory name, model number or the word Octopus.' : undefined} />
              <DsTextarea id="pd" label="Description" rows={8} value={f.description} maxLength={20000} onChange={(e) => set('description', e.target.value)}
                hint='Plain text. Start a line with "- " for a bullet list; leave an empty line between paragraphs.'
                error={badFields.includes('description') ? 'Remove the supplier or factory name, model number or the word Octopus.' : undefined} />
              <p className="m-0 text-[13px]" data-testid="text-check" aria-live="polite">
                {checking ? <span className="text-muted">Checking…</span>
                  : textOk ? <DsBadge tone="ok">Checked No supplier or factory names found.</DsBadge>
                    : <DsBadge tone="warn">{`Check: ${[...new Set(badFields.map(fieldLabel))].join(', ')}`}</DsBadge>}
              </p>
            </div>
          </DsCard>

          <DsCard title="Images" icon="image" testId="editor-images" subtitle="Choose which images to push and their order. The first one is the main image.">
            {f.images.length === 0 && <p className="mt-0 text-[13px] text-bad">{st.octopus_images.length > 0 ? 'Choose at least one image.' : 'This product has no images yet.'}</p>}
            <ol className="list-none m-0 p-0 grid gap-3 grid-cols-2 sm:grid-cols-3">
              {f.images.map((u, i) => (
                <li key={u} className="border border-line rounded-[12px] p-2 flex flex-col gap-2" data-testid={`image-${i}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`${f.title} – image ${i + 1}`} className="w-full aspect-square object-cover rounded-[8px] bg-pearl" />
                  <span className="text-[12px] text-muted">{i === 0 ? 'Main' : `Image ${i + 1}`}</span>
                  <div className="flex gap-1 flex-wrap">
                    <button type="button" className="ds-btn ds-btn-secondary !px-2" aria-label={`Move image ${i + 1} earlier`} disabled={i === 0} onClick={() => moveImage(i, -1)}><DsIcon name="arrow" size={14} className="rotate-180" /></button>
                    <button type="button" className="ds-btn ds-btn-secondary !px-2" aria-label={`Move image ${i + 1} later`} disabled={i === f.images.length - 1} onClick={() => moveImage(i, 1)}><DsIcon name="arrow" size={14} /></button>
                    <button type="button" className="ds-btn ds-btn-secondary !px-2" aria-label={`Don't push image ${i + 1}`} onClick={() => toggleImage(u)}><DsIcon name="x" size={14} /></button>
                  </div>
                </li>
              ))}
            </ol>
            {unchosen.length > 0 && (
              <div className="mt-3">
                <p className="m-0 mb-2 text-[13px] text-muted">Not pushed:</p>
                <div className="flex gap-2 flex-wrap">
                  {unchosen.map((u, i) => (
                    <button key={u} type="button" className="ds-btn ds-btn-secondary" onClick={() => toggleImage(u)} aria-label={`Add image ${i + 1} back`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" className="w-8 h-8 object-cover rounded" /> Add back
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 mb-0 text-[12px] text-muted">Alt text is written from the title. Images have no supplier logos or watermarks (checked by Octopus staff) and are sent under new file names.</p>
          </DsCard>

          <DsTableCard title="Variants" icon="layers" testId="editor-variants" minWidth={900}
            headers={['Push', 'Option', 'Model no.', 'Store SKU', 'Your cost', 'Your price', 'Compare-at', 'Margin', 'Stock']}
            footer={`Your cost is landed to ${marketName ?? 'your main market'} (${st.duty_mode === 'DAP' ? 'buyer pays duties' : 'duties included'}). Stock is a label: In stock, Low stock, Out of stock or Extended.`}>
            {rows.map((r, i) => {
              const out = r.v.stock_status === 'out';
              const name = optionText(r.v.options);
              return (
                <tr key={r.v.variant_id} data-testid={`variant-${r.v.model_no}`}>
                  <td><input type="checkbox" className="w-4 h-4 accent-coral" aria-label={`Push ${name}`} disabled={out} checked={r.vs.include && !out}
                    onChange={() => setF((s) => ({ ...s, vars: s.vars.map((x, j) => (j === i ? { ...x, include: !x.include } : x)) }))} /></td>
                  <td>{name}</td>
                  <td>{r.v.model_no}</td>
                  <td>{out ? '—' : <input className="ds-input w-[150px]" aria-label={`SKU ${name}`} value={r.vs.store_sku} maxLength={64}
                    aria-invalid={badFields.includes(`sku:${r.v.variant_id}`) || undefined}
                    onChange={(e) => setF((s) => ({ ...s, vars: s.vars.map((x, j) => (j === i ? { ...x, store_sku: e.target.value } : x)) }))} />}</td>
                  <td>{r.v.landed_usd_cents != null ? money(r.v.landed_usd_cents, 'USD') : <span className="text-[12px] text-muted">{r.v.landed && !r.v.landed.ok ? r.v.landed.message : 'Not known yet'}</span>}</td>
                  <td>{out ? '—' : f.manual
                    ? <input className="ds-input w-[110px]" aria-label={`Price ${name}`} inputMode="decimal" value={r.vs.price}
                      onChange={(e) => setF((s) => ({ ...s, vars: s.vars.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) }))} />
                    : storeMoney(r.price, cur)}</td>
                  <td>{out ? '—' : f.manual
                    ? <input className="ds-input w-[110px]" aria-label={`Compare-at ${name}`} inputMode="decimal" value={r.vs.compare}
                      onChange={(e) => setF((s) => ({ ...s, vars: s.vars.map((x, j) => (j === i ? { ...x, compare: e.target.value } : x)) }))} />
                    : storeMoney(r.compare, cur)}</td>
                  <td>{out || r.profit == null ? '—' : <DsBadge tone={r.profit < st.min_profit_bp ? 'warn' : 'ok'}>{pct(r.profit)}</DsBadge>}</td>
                  <td><DsBadge tone={STOCK_TONE[r.v.stock_status]}>{STOCK_TEXT[r.v.stock_status]}</DsBadge></td>
                </tr>
              );
            })}
          </DsTableCard>
          {(priceErr || cmpErr) && <DsNotice tone="warn" title="Check the prices">{priceErr ?? cmpErr}</DsNotice>}

          <DsCard title="Organisation" icon="tag" testId="editor-org">
            <div className="grid gap-3 sm:grid-cols-2">
              <DsInput id="pv" label="Vendor" value={f.vendor} maxLength={120} onChange={(e) => set('vendor', e.target.value)} hint="Your brand. The supplier is never sent to your store."
                error={badFields.includes('vendor') ? 'Use your own brand name.' : undefined} />
              <DsInput id="ptp" label="Product type" value={f.productType} maxLength={120} onChange={(e) => set('productType', e.target.value)} />
              <DsInput id="pc" label="Collection" value={f.collection} maxLength={120} onChange={(e) => set('collection', e.target.value)}
                hint="Matched to a collection with this name in your store when you push. Leave empty for no collection." />
              <DsInput id="ptg" label="Tags" value={f.tags} onChange={(e) => set('tags', e.target.value)} hint="Separate tags with commas."
                error={badFields.includes('tags') ? 'Remove the supplier name or model number from the tags.' : undefined} />
            </div>
          </DsCard>

          <DsCard title="Search listing" icon="search" testId="editor-seo">
            <div className="flex flex-col gap-3">
              <DsInput id="ph" label="URL handle" value={f.handle} placeholder={slug(f.title)} maxLength={255} onChange={(e) => set('handle', e.target.value.toLowerCase())}
                hint="Lowercase letters, numbers and dashes. Empty = made from the title." />
              <DsInput id="pmt" label="Meta title" value={f.seoTitle} maxLength={70} onChange={(e) => set('seoTitle', e.target.value)} hint={`${f.seoTitle.length} of 70 characters`} />
              <DsTextarea id="pmd" label="Meta description" value={f.seoDesc} maxLength={160} onChange={(e) => set('seoDesc', e.target.value)} hint={`${f.seoDesc.length} of 160 characters`} />
            </div>
          </DsCard>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <DsCard title="Preview" icon="eye" testId="editor-preview">
            {f.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.images[0]} alt="Main image" className="w-full aspect-square object-cover rounded-[8px] bg-pearl" />
            ) : <div className="w-full aspect-square rounded-[8px] bg-pearl flex items-center justify-center text-[13px] text-muted">No image chosen</div>}
            <h3 className="mt-3 mb-1 text-[16px] font-bold text-ink">{f.title || 'Untitled'}</h3>
            <p className="m-0 text-[15px] text-ink">
              {storeMoney(priced[0]?.price ?? null, cur)}{' '}
              {priced[0]?.compare != null && <span className="text-muted line-through">{storeMoney(priced[0].compare, cur)}</span>}
            </p>
            <p className="mt-1 mb-0 text-[13px] text-muted">{[f.vendor, included.map((r) => optionText(r.v.options)).join(', ')].filter(Boolean).join(' · ')}</p>
          </DsCard>

          <DsCard title="Pricing" icon="tag" testId="editor-pricing">
            <div className="ds-row"><span className="ds-mut">Rule</span><span>{st.rules.saved ? ruleSummary(st.rules) : 'Not saved yet'}</span></div>
            <DsSwitch label="Override this product" checked={f.manual} onChange={(v) => set('manual', v)} testId="override-price"
              hint={f.manual ? 'You enter the price per variant.' : 'Prices follow your rule.'} />
            <div className="ds-row"><span className="ds-mut">Compare-at uplift</span><span>{st.rules.compare_at_bp ? `+${st.rules.compare_at_bp / 100}%` : 'Not set'}</span></div>
            <div className="ds-row"><span className="ds-mut">Minimum margin</span><span>{pct(st.min_profit_bp)}</span></div>
            {cur !== 'USD' && <p className="mt-2 mb-0 text-[12px] text-muted">{st.fx?.source_name ? `1 USD = ${st.fx.rate} ${cur} · ${st.fx.source_name}` : `No exchange rate for ${cur} yet.`}</p>}
          </DsCard>

          <DsCard title="After pushing" icon="upload" testId="editor-after">
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
              <legend className="ds-label">Status in your store</legend>
              <DsRadioCard name="status" value="draft" checked={f.publishAs === 'draft'} onChange={() => set('publishAs', 'draft')} title="Draft" description="Review it in Shopify first" />
              <DsRadioCard name="status" value="active" checked={f.publishAs === 'active'} onChange={() => set('publishAs', 'active')} title="Active" description="Visible in your store right away" />
            </fieldset>
            <DsCheckbox label="Keep stock in sync" checked={f.syncStock} onChange={(e) => set('syncStock', e.target.checked)} />
            <DsCheckbox label="Keep price in sync with my rule" checked={f.syncPrice} onChange={(e) => set('syncPrice', e.target.checked)} />
          </DsCard>

          <DsCard title="Ready to push" icon="check" testId="editor-ready">
            <ul className="list-none m-0 p-0 flex flex-col gap-2 text-[14px]">
              <Check ok={textOk && Boolean(f.title.trim())} label="Title and description" />
              <Check ok={f.images.length > 0} label={`${f.images.length} image${f.images.length === 1 ? '' : 's'}`} />
              <Check ok={included.length > 0 && priced.length === included.length} label={`${priced.length} variant${priced.length === 1 ? '' : 's'} priced`} />
              <Check ok={lowest != null && lowest >= st.min_profit_bp} label={`Margin above ${pct(st.min_profit_bp)}`} warn />
              <Check ok={Boolean(st.store)} label={st.store ? 'Store connected' : 'Store connected — connect a store first'} />
            </ul>
          </DsCard>
        </div>
      </div>
    </div>
  );
}

function Check({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <DsBadge tone={ok ? 'ok' : warn ? 'warn' : 'neutral'}>{ok ? 'Done' : warn ? 'Check' : 'Not yet'}</DsBadge>
      <span>{label}</span>
    </li>
  );
}
