import 'server-only';
import { notFound } from 'next/navigation';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { portalProducts } from '@/components/backoffice/hidden-columns';
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
    // certificates.supplier_id is hidden from session reads (migration 195): service role, scoped explicitly to the
    // suppliers this caller manages (getManagedSuppliers → session RLS on distributor_suppliers / suppliers).
    ids.length ? createAdminClient().from('certificates').select('id, supplier_id, name, issuer, status, expires_at').in('supplier_id', ids).order('name') : Promise.resolve({ data: [] }),
  ]);

  let status = 'draft';
  let hsInfo: { status: string | null; source: string | null; note: string | null; verified?: boolean } | null = null;
  let legacyPackaging: { netWeight: string | null; colourBoxMm: string | null } | null = null;
  let initial: ProductFormValues = {
    sku: '', title: '', supplier_id: presetSupplier && ids.includes(presetSupplier) ? presetSupplier : (suppliers.length === 1 ? suppliers[0].id : ''),
    category_id: null, tag_ids: [], unit: 'pcs', moq: 1, lead_time_days: null, incoterm: 'FOB', origin_country: null, hs_code: null,
    weight_g: null, box_l_cm: null, box_w_cm: null, box_h_cm: null,
    has_battery: false, has_liquid: false, has_magnet: false, has_powder: false, is_fragile: false,
    currency: 'USD', tiers: [{ min_qty: 1, price: NaN }], specs: [], certificate_ids: [], octopus_dropship: false, ready_to_ship: false, images: [],
    description: '', seo_title: '', seo_description: '',
  };

  if (productId) {
    // supplier_id / HS columns are hidden from plain products reads (migration 195): portal_products() returns them only for
    // rows the caller may manage (staff with products:view, own / assigned suppliers); `ids` check below still applies.
    const [{ data: p }, { data: im }] = await Promise.all([
      portalProducts(sb)
        .select('id, sku, title, supplier_id, category_id, status, hs_code_status, hs_code_source, hs_code_note, unit, moq, lead_time_days, incoterm, origin_country, hs_code, net_weight, colour_box_mm, octopus_dropship, ready_to_ship, description, seo_title, seo_description, image_url, currency, price_tiers(min_qty, unit_price_cents, currency), product_specs(name, value, sort), product_tags(tag_id), product_certificates(certificate_id), product_media(url, sort)')
        .eq('id', productId).maybeSingle(),
      sb
        .from('item_master')
        .select('id, hs_code, hs_code_status, hs_code_source, hs_code_note, hs_verified, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, has_liquid, has_magnet, has_powder, is_fragile')
        .eq('sourcing_product_id', productId)
        .maybeSingle(),
    ]);
    if (!p || !ids.includes(p.supplier_id)) notFound();
    status = p.status;
    hsInfo = {
      status: (im?.hs_code_status as string | null) ?? (p.hs_code_status as string | null),
      source: (im?.hs_code_source as string | null) ?? (p.hs_code_source as string | null),
      note: (im?.hs_code_note as string | null) ?? (p.hs_code_note as string | null),
      verified: Boolean(im?.hs_verified),
    };
    legacyPackaging = {
      netWeight: (p.net_weight as string | null) ?? null,
      colourBoxMm: (p.colour_box_mm as string | null) ?? null,
    };
    const media = ((p.product_media ?? []) as { url: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((m) => m.url);
    initial = {
      sku: p.sku ?? '', title: p.title, supplier_id: p.supplier_id, category_id: p.category_id, unit: p.unit, moq: p.moq, lead_time_days: p.lead_time_days,
      incoterm: p.incoterm ?? 'FOB',
      origin_country: im?.origin_country ? String(im.origin_country).trim() : p.origin_country,
      hs_code: im?.hs_code ?? p.hs_code,
      weight_g: im?.weight_g != null ? Number(im.weight_g) : null,
      box_l_cm: im?.box_l_cm != null ? Number(im.box_l_cm) : null,
      box_w_cm: im?.box_w_cm != null ? Number(im.box_w_cm) : null,
      box_h_cm: im?.box_h_cm != null ? Number(im.box_h_cm) : null,
      has_battery: Boolean(im?.has_battery),
      has_liquid: Boolean(im?.has_liquid),
      has_magnet: Boolean(im?.has_magnet),
      has_powder: Boolean(im?.has_powder),
      is_fragile: Boolean(im?.is_fragile),
      octopus_dropship: p.octopus_dropship, ready_to_ship: p.ready_to_ship,
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
      hsInfo={hsInfo}
      legacyPackaging={legacyPackaging}
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
