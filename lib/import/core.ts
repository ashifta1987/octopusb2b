import { unzipSync } from 'fflate';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkbook } from './parse-workbook.ts';
import type { StagingBatch } from './types.ts';

/**
 * Import pipeline shared by /admin/import and `pnpm import:bulk` (ADDON-27). Needs a SERVICE-ROLE client:
 * callers check staff permissions first. Relative imports only, so the CLI can run it with plain Node.
 */

export type TableDiff = { create: number; update: number; skip: number; conflicts?: string[] };
export type FieldChange = { external_id: string; field: string; from: string | null; to: string | null };
export type ImportDiff = {
  suppliers: TableDiff; products: TableDiff; supplier_products: TableDiff; prices: TableDiff; images: TableDiff;
  review: { total: number; by_kind: Record<string, number>; already_known: number };
  /** ADDON-29: every field that differs on an UPDATE (capped at 500) */
  changes?: FieldChange[];
  errors?: number;
};

type Settings = { validDays: number; outlierX: number; maxImageBytes: number; maxZipBytes: number };

export async function loadImportSettings(sb: SupabaseClient): Promise<Settings> {
  const { data } = await sb.from('site_settings').select('key, value').like('key', 'import.%');
  const m = new Map((data ?? []).map((r) => [r.key as string, Number(r.value)]));
  return {
    validDays: m.get('import.price_validity_default_days') || 30,
    outlierX: m.get('import.outlier_threshold_median_x') || 3,
    maxImageBytes: m.get('import.images.max_bytes_each') || 15_000_000,
    maxZipBytes: m.get('import.images.max_total_bytes') || 500_000_000,
  };
}

export function readZip(bytes: Uint8Array, s: Pick<Settings, 'maxImageBytes' | 'maxZipBytes'>) {
  if (bytes.byteLength > s.maxZipBytes) throw new Error(`IMPORT_ZIP_TOO_LARGE: the image ZIP is larger than ${s.maxZipBytes} bytes`);
  const files = unzipSync(bytes, { filter: (f) => !f.name.startsWith('__MACOSX/') && !f.name.split('/').pop()!.startsWith('.') && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name) });
  const out = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    if (data.byteLength > s.maxImageBytes) throw new Error(`IMPORT_IMAGE_TOO_LARGE: ${name} is larger than ${s.maxImageBytes} bytes`);
    out.set(name.split('/').pop()!, data);
  }
  return out;
}

const changed = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null);

/** Compare the staged batch with the database: create / update / skip per target table. */
export async function computeDiff(sb: SupabaseClient, batch: StagingBatch): Promise<ImportDiff> {
  const ids = batch.products.map((p) => p.external_id);
  const [{ data: sup }, { data: prods }] = await Promise.all([
    sb.from('suppliers').select('id, manufacturer_code, province, handle, contact_name, contact_email, contact_phone, legal_name').eq('external_id', batch.supplier.external_id).maybeSingle(),
    ids.length ? sb.from('products').select('id, external_id, title, factory_model, specification_raw, selling_points_raw, net_weight, product_size_mm, size_notes, colour_box_mm, carton_size_mm, qty_per_carton, gross_weight, listing_status, import_notes, incoterm').in('external_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const byExt = new Map((prods ?? []).map((p) => [p.external_id as string, p]));
  const pids = (prods ?? []).map((p) => p.id as string);
  const [{ data: sps }, { data: prices }, { data: media }, { data: review }] = await Promise.all([
    sup && pids.length ? sb.from('supplier_products').select('product_id, supplier_model, moq, exclusive_channels, exclusivity_flag, status').eq('supplier_id', sup.id).in('product_id', pids) : Promise.resolve({ data: [] }),
    sup && pids.length ? sb.from('supplier_product_prices').select('product_id, incoterm, moq_tier_min, variant_label, price_minor, currency, valid_from, valid_to').eq('supplier_id', sup.id).in('product_id', pids) : Promise.resolve({ data: [] }),
    pids.length ? sb.from('product_media').select('product_id, url').in('product_id', pids) : Promise.resolve({ data: [] }),
    ids.length ? sb.from('import_review_items').select('external_id, issue').in('external_id', ids) : Promise.resolve({ data: [] }),
  ]);

  const supplierDiff: TableDiff = { create: 0, update: 0, skip: 0, conflicts: [] };
  if (!sup) supplierDiff.create = 1;
  else {
    const s = batch.supplier;
    const upd = changed(sup.manufacturer_code, s.manufacturer_code ?? sup.manufacturer_code) || changed(sup.province, s.province ?? sup.province)
      || changed(sup.handle, s.handle ?? sup.handle) || changed(sup.contact_email, s.contact_email ?? sup.contact_email) || changed(sup.contact_phone, s.contact_phone ?? sup.contact_phone);
    if (upd) supplierDiff.update = 1; else supplierDiff.skip = 1;
    if (sup.legal_name !== s.legal_name) supplierDiff.conflicts!.push(`Legal name on file "${sup.legal_name}" differs from the workbook "${s.legal_name}" — the import never changes it; pick the canonical name instead.`);
  }

  const productDiff: TableDiff = { create: 0, update: 0, skip: 0, conflicts: [] };
  const changes: FieldChange[] = [];
  const show = (v: unknown) => (v == null ? null : String(v).slice(0, 160));
  const FIELDS = ['factory_model', 'specification_raw', 'selling_points_raw', 'net_weight', 'product_size_mm', 'size_notes', 'colour_box_mm', 'carton_size_mm', 'qty_per_carton', 'gross_weight', 'import_notes', 'incoterm', 'title'];
  const spDiff: TableDiff = { create: 0, update: 0, skip: 0 };
  const spBy = new Map((sps ?? []).map((r) => [r.product_id as string, r]));
  for (const p of batch.products) {
    const e = byExt.get(p.external_id);
    if (!e) { productDiff.create++; spDiff.create++; continue; }
    const fields: [unknown, unknown][] = [[e.factory_model, p.factory_model], [e.specification_raw, p.specification_raw], [e.selling_points_raw, p.selling_points_raw],
      [e.net_weight, p.net_weight], [e.product_size_mm, p.product_size_mm], [e.size_notes, p.size_notes], [e.colour_box_mm, p.colour_box_mm],
      [e.carton_size_mm, p.carton_size_mm], [e.qty_per_carton, p.qty_per_carton], [e.gross_weight, p.gross_weight],
      // Platform status (listing_status) only applies to NEW products — an update never lowers a product (bug fix 6 Nov 2026)
      [e.import_notes, p.notes], [e.incoterm, p.incoterm ?? e.incoterm], [e.title, p.name || e.title]];
    if (fields.some(([a, b]) => changed(a, b))) {
      productDiff.update++;
      fields.forEach(([a, b], i) => { if (changed(a, b) && changes.length < 500) changes.push({ external_id: p.external_id, field: FIELDS[i], from: show(a), to: show(b) }); });
    } else productDiff.skip++;
    if (p.name && e.title !== p.name) productDiff.conflicts!.push(`${p.external_id}: title "${e.title}" → "${p.name}"`);
    const sp = spBy.get(e.id as string);
    if (!sp) spDiff.create++;
    else if (changed(sp.supplier_model, p.supplier_model) || changed(sp.moq, p.moq) || changed(sp.exclusive_channels, p.exclusive_channels) || changed(sp.exclusivity_flag, p.exclusivity_flag) || changed(sp.status, p.supplier_status)) spDiff.update++;
    else spDiff.skip++;
  }

  const priceDiff: TableDiff = { create: 0, update: 0, skip: 0 };
  const extById = new Map((prods ?? []).map((p) => [p.id as string, p.external_id as string]));
  const priceBy = new Map((prices ?? []).map((r) => [`${extById.get(r.product_id as string)}|${r.incoterm}|${r.moq_tier_min}|${r.variant_label}|${r.valid_from}`, r]));
  for (const p of batch.prices) {
    const e = priceBy.get(`${p.external_id}|${p.incoterm}|${p.moq_tier_min}|${p.variant_label}|${p.valid_from}`);
    if (!e) priceDiff.create++;
    else if (Number(e.price_minor) !== p.price_minor || e.currency !== p.currency || (e.valid_to ?? null) !== (p.valid_to ?? null)) {
      priceDiff.update++;
      if (changes.length < 500) changes.push({ external_id: p.external_id, field: `price ${p.incoterm} · MOQ ${p.moq_tier_min}${p.variant_label ? ` · ${p.variant_label}` : ''}`,
        from: `${(Number(e.price_minor) / 10000).toFixed(4).replace(/0{1,2}$/, '')} ${e.currency}`, to: `${(p.price_minor / 10000).toFixed(4).replace(/0{1,2}$/, '')} ${p.currency}` });
    }
    else priceDiff.skip++;
  }

  const imgDiff: TableDiff = { create: 0, update: 0, skip: 0 };
  const mediaKeys = new Set((media ?? []).map((m) => `${extById.get(m.product_id as string)}|${String(m.url).split('/').pop()}`));
  for (const i of batch.images) { if (mediaKeys.has(`${i.external_id}|${i.file}`)) imgDiff.skip++; else imgDiff.create++; }

  const known = new Set((review ?? []).map((r) => `${r.external_id}|${r.issue}`));
  const byKind: Record<string, number> = {};
  batch.review.forEach((r) => (byKind[r.kind] = (byKind[r.kind] ?? 0) + 1));
  return {
    suppliers: supplierDiff, products: productDiff, supplier_products: spDiff, prices: priceDiff, images: imgDiff,
    review: { total: batch.review.length, by_kind: byKind, already_known: batch.review.filter((r) => known.has(`${r.external_id}|${r.issue}`)).length },
    changes, errors: batch.errors?.length ?? 0,
  };
}

export async function stageImport(sb: SupabaseClient, input: {
  name: string; xlsx: Uint8Array; zip: Uint8Array | null; validFrom: string; actor: string | null; source: Record<string, unknown>;
}) {
  const settings = await loadImportSettings(sb);
  const images = input.zip ? readZip(input.zip, settings) : null;
  const batch = await parseWorkbook(Buffer.from(input.xlsx), {
    validFrom: input.validFrom, validDays: settings.validDays, outlierX: settings.outlierX, imageFiles: images ? [...images.keys()] : null,
  });
  if (!batch.products.length && !batch.errors.length) throw new Error('IMPORT_NO_PRODUCTS: no sheet with "Product Id" in cell A1 was found');
  const diff = await computeDiff(sb, batch);
  const { data, error } = await sb.from('import_runs')
    .insert({ name: input.name, staging: batch, diff, source: input.source, created_by: input.actor })
    .select('id').single();
  if (error) throw new Error(error.message);
  return { runId: data.id as string, batch, diff };
}

/** Upload the run's images to product-media, then commit everything in one database transaction. */
export async function commitImport(sb: SupabaseClient, input: { runId: string; actor: string | null; zip: Uint8Array | null; canonical?: string | null }) {
  const { data: run, error } = await sb.from('import_runs').select('id, status, staging, report').eq('id', input.runId).single();
  if (error || !run) throw new Error('IMPORT_NOT_FOUND');
  if (run.status === 'committed') return run.report as Record<string, unknown>;
  const batch = run.staging as StagingBatch;
  if (batch.errors?.length) throw new Error(`IMPORT_HAS_ERRORS: fix the ${batch.errors.length} error(s) in the workbook and upload it again`);
  const uploaded: string[] = [];
  try {
    if (input.zip && batch.images.length) {
      const settings = await loadImportSettings(sb);
      const files = readZip(input.zip, settings);
      const done = new Map<string, string>();   // a photo used by several rows is stored once (ADDON-29)
      for (const img of batch.images) {
        if (done.has(img.file)) { img.url = done.get(img.file); continue; }
        const bytes = files.get(img.file);
        if (!bytes) continue;
        const key = `import/${batch.supplier.external_id}/${img.file}`;
        const type = /\.png$/i.test(img.file) ? 'image/png' : /\.webp$/i.test(img.file) ? 'image/webp' : /\.avif$/i.test(img.file) ? 'image/avif' : 'image/jpeg';
        const up = await sb.storage.from('product-media').upload(key, bytes, { contentType: type, upsert: true });
        if (up.error) throw new Error(`image ${img.file}: ${up.error.message}`);
        uploaded.push(key);
        img.url = sb.storage.from('product-media').getPublicUrl(key).data.publicUrl;
        img.bytes = bytes.byteLength;
        done.set(img.file, img.url);
      }
      await sb.from('import_runs').update({ staging: batch }).eq('id', input.runId);
    }
    const { data, error: e2 } = await sb.rpc('commit_import_run', { p_run: input.runId, p_actor: input.actor, p_canonical: input.canonical ?? null });
    if (e2) throw new Error(e2.message);
    return data as Record<string, unknown>;
  } catch (e) {
    await sb.from('import_runs').update({ error: e instanceof Error ? e.message : String(e) }).eq('id', input.runId);
    throw e;
  }
}

