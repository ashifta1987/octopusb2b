'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsButton, DsCard, DsCheckbox, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { PRODUCT_CATEGORIES } from '@/lib/dropship-ds14-shared';
import type { ProductPayload, SupSubmissionFull } from '@/lib/dropship-ds14';
import { saveProductAction } from '../../actions';
import { SupplierFrame } from '../../frame';

type V = { option: string; sku: string; barcode: string; cost: string; stock: string; weight: string };
const emptyV = (): V => ({ option: '', sku: '', barcode: '', cost: '', stock: '', weight: '' });
const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));

export function NewProductClient({ existing }: { existing: SupSubmissionFull | null }) {
  const router = useRouter();
  const p: ProductPayload = existing?.payload ?? {};
  const [f, setF] = useState({
    name: p.name ?? '', category: p.category ?? PRODUCT_CATEGORIES[0], brand: p.brand ?? '', sku: p.supplier_sku ?? '', barcode: p.barcode ?? '', condition: p.condition ?? 'new',
    description: p.description ?? '', features: (p.features ?? []).join('\n'), images: (p.images ?? []).join('\n'),
    pw: String(p.package?.weight_g ?? ''), pl: String(p.package?.length_cm ?? ''), pwd: String(p.package?.width_cm ?? ''), ph: String(p.package?.height_cm ?? ''), handling: String(p.handling_days ?? ''),
    hs: p.customs?.hs_code ?? '', origin: p.customs?.origin ?? 'CN', material: p.customs?.material ?? '', cdesc: p.customs?.description_en ?? '',
    battery: !!p.customs?.battery, liquid: !!p.customs?.liquid, magnetic: !!p.customs?.magnetic, branded: !!p.customs?.branded,
    moq: String(p.terms?.moq ?? ''), lead: String(p.terms?.lead_days ?? ''), validity: String(p.terms?.price_valid_days ?? ''), packaging: p.terms?.packaging ?? 'plain',
  });
  const [vars, setVars] = useState<V[]>((p.variants ?? []).length
    ? p.variants!.map((v) => ({ option: v.option, sku: v.sku, barcode: v.barcode ?? '', cost: (v.cost_cents / 100).toFixed(2), stock: String(v.stock), weight: String(v.weight_g) }))
    : [emptyV()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const flag = (k: 'battery' | 'liquid' | 'magnetic' | 'branded') => (e: { target: { checked: boolean } }) => setF((x) => ({ ...x, [k]: e.target.checked }));

  const build = (): unknown => ({
    name: f.name, category: f.category, brand: f.brand || undefined, description: f.description, supplier_sku: f.sku, barcode: f.barcode || undefined, condition: f.condition as 'new' | 'refurbished',
    features: f.features.split('\n').map((x) => x.trim()).filter(Boolean),
    variants: vars.filter((v) => v.option || v.sku || v.cost).map((v) => ({ option: v.option, sku: v.sku, barcode: v.barcode || undefined, cost_cents: Math.round((num(v.cost) ?? 0) * 100), stock: num(v.stock) ?? 0, weight_g: num(v.weight) ?? 0 })),
    images: f.images.split('\n').map((x) => x.trim()).filter(Boolean), handling_days: num(f.handling),
    package: { weight_g: num(f.pw), length_cm: num(f.pl), width_cm: num(f.pwd), height_cm: num(f.ph) },
    customs: { hs_code: f.hs, origin: f.origin.toUpperCase(), material: f.material || undefined, description_en: f.cdesc, battery: f.battery, liquid: f.liquid, magnetic: f.magnetic, branded: f.branded },
    terms: { moq: num(f.moq), lead_days: num(f.lead), price_valid_days: num(f.validity), packaging: f.packaging as 'plain' | 'own_box' },
  });
  const send = (submit: boolean) => start(async () => {
    setMsg(null);
    const r = await saveProductAction(existing?.id ?? null, build(), submit);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: submit ? 'Sent for review. You get an email when it is approved or when we need changes.' : 'Draft saved.' });
    if (submit) router.push('/supplier');
  });
  const checklist = [
    ['Name and category', !!f.name && !!f.category], ['Model number and SKU', !!f.sku && vars.every((v) => !v.sku || v.sku.length > 1) && vars.some((v) => v.sku)],
    ['Variants with cost and stock', vars.some((v) => num(v.cost) && v.stock !== '')], ['3 or more images', f.images.split('\n').filter((x) => x.trim()).length >= 3],
    ['Package weight and size', !!num(f.pw) && !!num(f.pl) && !!num(f.pwd) && !!num(f.ph)], ['HS code and origin', f.hs.replace(/[ .]/g, '').length >= 6 && f.origin.length === 2],
  ] as [string, boolean][];
  const locked = existing ? !existing.editable : false;

  return (
    <SupplierFrame testId="supplier-new-product-page">
      <DsPageHeader title={existing ? 'Edit product' : 'Add product'} subtitle="Enter the product once. Staff review it before merchants can sell it." icon="plus" actions={<DsLinkButton href="/supplier" variant="secondary" icon="arrow">Back to products</DsLinkButton>} />
      {existing?.review_note && <DsNotice tone="warn" title="Staff asked for changes">{existing.review_note}</DsNotice>}
      {locked && <DsNotice tone="info" title="This product is in review">You can edit it again if staff ask for changes.</DsNotice>}
      <form className="grid lg:grid-cols-[1fr_320px] gap-5 items-start" onSubmit={(e) => { e.preventDefault(); send(true); }} aria-label="Add product">
        <fieldset disabled={locked} className="contents">
          <div className="flex flex-col gap-5 min-w-0">
            <DsCard title="Basic information" subtitle="What the product is" icon="package">
              <div className="grid sm:grid-cols-2 gap-3">
                <DsInput label="Product name" value={f.name} onChange={set('name')} required />
                <DsSelect label="Category" value={f.category} onChange={set('category')}>{PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</DsSelect>
                <DsInput label="Brand" value={f.brand} onChange={set('brand')} />
                <DsInput label="Model number" hint="Your own model number. It must be unique." value={f.sku} onChange={set('sku')} required />
                <DsInput label="Barcode (EAN or UPC)" value={f.barcode} onChange={set('barcode')} />
                <DsSelect label="Condition" value={f.condition} onChange={set('condition')}><option value="new">New</option><option value="refurbished">Refurbished</option></DsSelect>
              </div>
              <div className="grid gap-3 mt-3">
                <DsTextarea label="Description" value={f.description} onChange={set('description')} rows={4} />
                <DsTextarea label="Key features (one per line)" value={f.features} onChange={set('features')} rows={3} />
              </div>
            </DsCard>
            <DsCard title="Variants" subtitle="Colour, size or style. Each variant has its own SKU, cost and stock." icon="layers" actions={<DsButton variant="secondary" icon="plus" onClick={() => setVars((v) => [...v, emptyV()])}>Add variant</DsButton>}>
              <div className="flex flex-col gap-4">
                {vars.map((v, i) => (
                  <div key={i} className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end" role="group" aria-label={`Variant ${i + 1}`}>
                    <DsInput label={`Option (variant ${i + 1})`} value={v.option} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, option: e.target.value } : x)))} />
                    <DsInput label={`Variant SKU ${i + 1}`} value={v.sku} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} />
                    <DsInput label={`Cost (USD) ${i + 1}`} inputMode="decimal" value={v.cost} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} />
                    <DsInput label={`Stock ${i + 1}`} inputMode="numeric" value={v.stock} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, stock: e.target.value } : x)))} />
                    <DsInput label={`Weight (g) ${i + 1}`} inputMode="numeric" value={v.weight} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
                    <DsButton variant="secondary" disabled={vars.length === 1} disabledReason={vars.length === 1 ? 'A product needs at least one variant' : undefined} onClick={() => setVars((a) => a.filter((_, j) => j !== i))} aria-label={`Remove variant ${i + 1}`}>Remove</DsButton>
                  </div>
                ))}
              </div>
            </DsCard>
            <DsCard title="Images" subtitle="At least 3 image links. White background for the first image." icon="image">
              <DsTextarea label="Image links (https://, one per line, up to 9)" value={f.images} onChange={set('images')} rows={4} hint="Images must not carry a watermark, a logo or contact details. Staff check every image." />
            </DsCard>
            <DsCard title="Package and shipping" subtitle="Used for carrier rates and the label" icon="truck">
              <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <DsInput label="Package weight (g)" inputMode="numeric" value={f.pw} onChange={set('pw')} />
                <DsInput label="Length (cm)" inputMode="decimal" value={f.pl} onChange={set('pl')} />
                <DsInput label="Width (cm)" inputMode="decimal" value={f.pwd} onChange={set('pwd')} />
                <DsInput label="Height (cm)" inputMode="decimal" value={f.ph} onChange={set('ph')} />
                <DsInput label="Handling time (days)" inputMode="numeric" value={f.handling} onChange={set('handling')} />
              </div>
            </DsCard>
            <DsCard title="Customs and safety" subtitle="Needed for the commercial invoice" icon="globe">
              <div className="grid sm:grid-cols-2 gap-3">
                <DsInput label="HS code (customs code)" value={f.hs} onChange={set('hs')} />
                <DsInput label="Country of origin (2 letters)" value={f.origin} onChange={set('origin')} maxLength={2} />
                <DsInput label="Material" value={f.material} onChange={set('material')} />
                <DsInput label="Customs description (English)" value={f.cdesc} onChange={set('cdesc')} />
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-3">
                <DsCheckbox checked={f.battery} onChange={flag('battery')} label="Contains a battery" />
                <DsCheckbox checked={f.liquid} onChange={flag('liquid')} label="Contains liquid or powder" />
                <DsCheckbox checked={f.magnetic} onChange={flag('magnetic')} label="Magnetic" />
                <DsCheckbox checked={f.branded} onChange={flag('branded')} label="Branded or licensed item" />
              </div>
              <p className="text-[12px] text-muted mt-3 mb-0">Certificates (CE, RoHS, test reports) for batteries and electronics: send them to your Octopus contact. Staff attach them to the product in Docs.</p>
            </DsCard>
            <DsCard title="Your terms" icon="file">
              <div className="grid sm:grid-cols-4 gap-3">
                <DsInput label="Minimum order quantity" inputMode="numeric" value={f.moq} onChange={set('moq')} />
                <DsInput label="Lead time to ship (days)" inputMode="numeric" value={f.lead} onChange={set('lead')} />
                <DsInput label="Price validity (days)" inputMode="numeric" value={f.validity} onChange={set('validity')} />
                <DsSelect label="Packaging" value={f.packaging} onChange={set('packaging')}><option value="plain">Plain, no logo</option><option value="own_box">Your own box</option></DsSelect>
              </div>
            </DsCard>
          </div>
          <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
            <DsCard title="Ready to submit?" icon="check">
              <ul className="list-none p-0 m-0 flex flex-col gap-1.5" data-testid="supplier-checklist">
                {checklist.map(([l, ok]) => <li key={l} className="flex items-center gap-2 text-[14px]"><span aria-hidden>{ok ? '✓' : '○'}</span><span>{l}</span><span className="sr-only">{ok ? 'done' : 'not done yet'}</span></li>)}
              </ul>
              <div className="flex flex-col gap-2 mt-4">
                <DsButton type="submit" loading={pending} disabled={locked} disabledReason={locked ? 'The product is in review' : undefined} icon="send">Submit for review</DsButton>
                <DsButton variant="secondary" loading={pending} disabled={locked} onClick={() => send(false)}>Save as draft</DsButton>
              </div>
              {msg && <div role={msg.ok ? 'status' : 'alert'} className={`text-[13px] mt-3 ${msg.ok ? 'text-ok' : 'text-bad'}`} data-testid="supplier-product-msg">{msg.text}</div>}
              <p className="text-[12px] text-muted mt-3 mb-0">Staff review each product. You get an email when it is approved or when we need changes.</p>
            </DsCard>
            <DsCard title="Rules"><ul className="m-0 pl-4 text-[13px] text-muted"><li>No watermark, logo or contact details on images or packaging.</li><li>Model number and SKU must be unique.</li><li>Batteries and electronics need a certificate.</li></ul>
              <Link className="text-coral-text font-semibold min-h-[44px] inline-flex items-center" href="/supplier/products/import">Many products? Use a spreadsheet</Link></DsCard>
          </aside>
        </fieldset>
      </form>
    </SupplierFrame>
  );
}
