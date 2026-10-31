import 'server-only';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Session } from '@/lib/auth';
import { COUNTRY_NAMES, asCurrency } from '@/lib/format';
import { getAiAdapter } from '@/lib/adapters/ai';
import { getManagedSuppliers } from './server-utils';
import { ProductForm, type FormCategory, type FormCert, type FormTag } from './product-form';
import type { ProductFormValues } from './product-schema';
import { saveProduct, transitionProduct } from '@/app/distributor/products/actions';

/** Server loader for Create / Edit product (ProductCreate.png). */
export async function ProductEditor({ session, productId, presetSupplier }: { session: Session; productId: string | null; presetSupplier?: string }) {
  const sb = await createClient();
  const suppliers = await getManagedSuppliers(session);
  const ids = suppliers.map((s) => s.id);
  const [{ data: cats }, { data: tags }, { data: certs }] = await Promise.all([
    sb.from('categories').select('id, name, parent_id, level, hs_code, sort').eq('active', true).order('sort'),
    sb.from('tags').select('id, name, kind').order('kind').order('name'),
    ids.length ? sb.from('certificates').select('id, supplier_id, name, issuer, status, expires_at').in('supplier_id', ids).order('name') : Promise.resolve({ data: [] }),
  ]);

  let status = 'draft';
  let initial: ProductFormValues = {
    title: '', supplier_id: presetSupplier && ids.includes(presetSupplier) ? presetSupplier : (suppliers.length === 1 ? suppliers[0].id : ''),
    category_id: null, tag_ids: [], unit: 'pcs', moq: 1, lead_time_days: null, incoterm: 'FOB', origin_country: null, hs_code: null,
    currency: 'USD', tiers: [{ min_qty: 1, price: NaN }], specs: [], certificate_ids: [], octopus_dropship: false, ready_to_ship: false, images: [],
    description: '', seo_title: '', seo_description: '',
  };

  if (productId) {
    const { data: p } = await sb.from('products')
      .select('id, title, supplier_id, category_id, status, unit, moq, lead_time_days, incoterm, origin_country, hs_code, octopus_dropship, ready_to_ship, description, seo_title, seo_description, image_url, currency, price_tiers(min_qty, unit_price_cents, currency), product_specs(name, value, sort), product_tags(tag_id), product_certificates(certificate_id), product_media(url, sort)')
      .eq('id', productId).maybeSingle();
    if (!p || !ids.includes(p.supplier_id)) notFound();
    status = p.status;
    const media = ((p.product_media ?? []) as { url: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((m) => m.url);
    initial = {
      title: p.title, supplier_id: p.supplier_id, category_id: p.category_id, unit: p.unit, moq: p.moq, lead_time_days: p.lead_time_days,
      incoterm: p.incoterm ?? 'FOB', origin_country: p.origin_country, hs_code: p.hs_code, octopus_dropship: p.octopus_dropship, ready_to_ship: p.ready_to_ship,
      description: p.description ?? '', seo_title: p.seo_title ?? '', seo_description: p.seo_description ?? '',
      currency: asCurrency((p.price_tiers as { currency: string }[] | null)?.[0]?.currency ?? p.currency),
      tiers: ((p.price_tiers ?? []) as { min_qty: number; unit_price_cents: number }[]).sort((a, b) => a.min_qty - b.min_qty).map((t) => ({ min_qty: t.min_qty, price: t.unit_price_cents / 100 })),
      specs: ((p.product_specs ?? []) as { name: string; value: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((s) => ({ name: s.name, value: s.value })),
      tag_ids: ((p.product_tags ?? []) as { tag_id: string }[]).map((t) => t.tag_id),
      certificate_ids: ((p.product_certificates ?? []) as { certificate_id: string }[]).map((c) => c.certificate_id),
      images: media.length ? media : p.image_url ? [p.image_url] : [],
    };
    if (!initial.tiers.length) initial.tiers = [{ min_qty: p.moq || 1, price: NaN }];
  }

  return (
    <ProductForm
      key={productId ?? 'new'}
      productId={productId}
      status={status}
      initial={initial}
      suppliers={suppliers.map((s) => ({ id: s.id, code: s.code, legal_name: s.legal_name, country: s.country, product_upload: s.supplier_switches?.product_upload ?? true, ai_tools: s.supplier_switches?.ai_tools ?? true }))}
      categories={(cats ?? []) as FormCategory[]}
      tags={(tags ?? []) as FormTag[]}
      certificates={(certs ?? []) as FormCert[]}
      countries={COUNTRY_NAMES}
      aiMode={getAiAdapter().mode}
      saveAction={saveProduct}
      submitAction={transitionProduct}
    />
  );
}
