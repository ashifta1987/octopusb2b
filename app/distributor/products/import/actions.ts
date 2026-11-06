'use server';
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { slugify, toCents } from '@/lib/format';
import { actionSession, fail, ok, getManagedSuppliers, type Result } from '@/components/backoffice/server-utils';
import { IMPORT_COLUMNS, type ImportData, type ImportImage } from '@/components/backoffice/import-columns';
import { SKU_ERRORS, normalizeSku, skuDbError, skuProblem } from '@/lib/sku';
import { COST_PRICE_WARNING, pricesEqualSupplierCost, IMAGE_COLS, IMAGE_EXT, MAX_IMAGE_BYTES, MAX_ZIP_BYTES, diffProduct, exportImageName, inFileDuplicateErrors, matchImage, unreferenced, zipImageEntries, type ZipEntry } from '@/lib/product-import';

const MAX_ROWS = 2000;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result == null ? '' : String(v.result);
    return '';
  }
  return String(v).trim();
}

/** Step 2 (optional): signed URL so the browser uploads the images .zip (≤ 200 MB) straight to private Storage. */
export async function createZipUpload(file: { name: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  if (!/\.zip$/i.test(file.name)) return fail('Images must be a .zip file.');
  if (!(file.size > 0 && file.size <= MAX_ZIP_BYTES)) return fail('The images .zip can be up to 200 MB.');
  const path = `distributor/${g.s.userId}/${crypto.randomUUID()}.zip`;
  const { data, error } = await createAdminClient().storage.from('imports').createSignedUploadUrl(path);
  if (error || !data) return fail(/size|large/i.test(error?.message ?? '') ? 'This zip is larger than the storage upload limit. Split the photos into smaller zips.' : 'Upload could not start.');
  return ok({ path: data.path, token: data.token });
}

async function zipBytes(path: string): Promise<Uint8Array | null> {
  const { data } = await createAdminClient().storage.from('imports').download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

/** List zip entries without inflating them. */
function listZip(buf: Uint8Array): ZipEntry[] {
  const seen: { path: string; size: number }[] = [];
  unzipSync(buf, { filter: (f) => { seen.push({ path: f.name, size: f.originalSize }); return false; } });
  return zipImageEntries(seen);
}

/** Parse + validate an uploaded workbook into import_jobs / import_rows with per-row errors, diffs and image report. */
export async function validateImport(fd: FormData): Promise<Result<{ jobId: string }>> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Choose an .xlsx file to upload.');
  if (!file.name.toLowerCase().endsWith('.xlsx')) return fail('Upload the .xlsx template (CSV is not supported yet).');
  if (file.size > 10 * 1024 * 1024) return fail('File is larger than 10 MB.');
  const zipPath = String(fd.get('zip_path') ?? '');
  if (zipPath && !zipPath.startsWith(`distributor/${g.s.userId}/`)) return fail('The images upload is invalid — attach the zip again.');

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return fail('Could not read this file. Is it a valid .xlsx?'); }
  const ws = wb.getWorksheet('Products') ?? wb.worksheets[0];
  if (!ws) return fail('The workbook has no sheets.');

  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => header.set(cellText(c.value).toLowerCase().trim(), col));
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !header.has(c.key) && !header.has(`${c.key}_usd`)).map((c) => c.key);
  if (missing.length) return fail(`Missing columns: ${missing.join(', ')}. Download the latest template (it now starts with a sku column).`);

  let entries: ZipEntry[] = [];
  if (zipPath) {
    const buf = await zipBytes(zipPath);
    if (!buf) return fail('The images zip did not finish uploading — attach it again.');
    try { entries = listZip(buf); } catch { return fail('Could not read the images .zip.'); }
  }

  const sb = await createClient();
  const admin = createAdminClient();
  const suppliers = await getManagedSuppliers(g.s);
  const supByCode = new Map(suppliers.map((s) => [s.code.toUpperCase(), s]));
  const { data: allSup } = await sb.from('public_suppliers').select('id, code');
  const knownCodes = new Set((allSup ?? []).map((s) => s.code.toUpperCase()));
  const { data: cats } = await sb.from('categories').select('id, name, parent_id').eq('active', true);
  const byId = new Map((cats ?? []).map((c) => [c.id, c]));
  const pathMap = new Map<string, string>(); const pathOf = new Map<string, string>();
  const nameCount = new Map<string, string[]>();
  for (const c of cats ?? []) {
    const parts: string[] = []; const display: string[] = []; let cur: typeof c | undefined = c;
    while (cur) { parts.unshift(cur.name.toLowerCase().trim()); display.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    pathMap.set(parts.join(' > '), c.id); pathOf.set(c.id, display.join(' > '));
    const n = c.name.toLowerCase().trim();
    nameCount.set(n, [...(nameCount.get(n) ?? []), c.id]);
  }
  { // display names for every category, including switched-off ones created by the workbook import (e.g. "Home & Garden")
    const { data: allCats } = await admin.from('categories').select('id, name, parent_id');
    const all = new Map((allCats ?? []).map((c) => [c.id as string, c]));
    for (const c of allCats ?? []) {
      if (pathOf.has(c.id as string)) continue;
      const parts: string[] = []; let cur: typeof c | undefined = c;
      while (cur) { parts.unshift(cur.name as string); cur = cur.parent_id ? all.get(cur.parent_id as string) : undefined; }
      pathOf.set(c.id as string, parts.join(' > '));
    }
  }
  const resolveCategory = (p: string) => {
    const norm = p.split('>').map((x) => x.trim().toLowerCase()).filter(Boolean).join(' > ');
    if (pathMap.has(norm)) return pathMap.get(norm)!;
    const leaf = norm.split(' > ').pop() ?? '';
    const m = nameCount.get(leaf);
    return m && m.length === 1 ? m[0] : null;
  };

  const rows: { row_no: number; data: ImportData; errors: string[]; warnings: string[] }[] = [];
  const get = (r: ExcelJS.Row, key: string) => { const col = header.get(key); return col ? cellText(r.getCell(col).value) : ''; };
  const intOrNull = (s: string) => (s === '' ? null : Number(s));
  const yes = (s: string) => ['yes', 'y', 'true', '1'].includes(s.toLowerCase());
  const yesNoValid = (s: string) => s === '' || ['yes', 'no', 'y', 'n', 'true', 'false', '1', '0'].includes(s.toLowerCase());

  ws.eachRow({ includeEmpty: false }, (r, rowNo) => {
    if (rowNo === 1 || rows.length >= MAX_ROWS) return;
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, get(r, c.key)])) as Record<string, string>;
    if (Object.values(raw).every((v) => v === '')) return;
    const errors: string[] = []; const warnings: string[] = [];
    const sku = normalizeSku(raw.sku);
    const sp = skuProblem(raw.sku);
    if (sp) errors.push(sp);
    const title = raw.title;
    if (!title) errors.push('Missing title');
    else if (title.length < 3) errors.push('Title too short');
    const category_id = raw.category_path ? resolveCategory(raw.category_path) : null;
    // blank category: required for new products, keeps the current category on an update (decided once the SKU is known)
    if (raw.category_path && !category_id) errors.push(`Unknown category "${raw.category_path}"`);
    const code = raw.supplier_code.toUpperCase();
    const sup = supByCode.get(code);
    if (!code) errors.push('Missing supplier_code');
    else if (!sup) errors.push(knownCodes.has(code) ? `Supplier ${code} is not assigned to you` : `Unknown supplier ${code}`);
    else if (sup.supplier_switches?.product_upload === false) errors.push(`Product upload is off for ${code}`);
    const moq = intOrNull(raw.moq);
    if (moq == null) errors.push('Missing moq');
    else if (!Number.isInteger(moq) || moq <= 0) errors.push('moq must be a whole number > 0');
    const lead = intOrNull(raw.lead_time_days);
    if (lead != null && (!Number.isInteger(lead) || lead < 0)) errors.push('lead_time_days must be a whole number ≥ 0');
    const curRaw = (raw.currency || 'USD').toUpperCase();
    if (curRaw !== 'USD' && curRaw !== 'CNY') errors.push('currency must be USD or CNY');
    const currency: 'USD' | 'CNY' = curRaw === 'CNY' ? 'CNY' : 'USD';
    const tiers: { min_qty: number; unit_price_cents: number }[] = [];
    for (const n of [1, 2, 3]) {
      const q = raw[`tier${n}_qty`]; const p = raw[`tier${n}_price`] !== '' ? raw[`tier${n}_price`] : get(r, `tier${n}_price_usd`);
      if (q === '' && p === '') { if (n === 1) errors.push('Missing tier1_qty / tier1_price'); continue; }
      const qn = Number(q); const pc = toCents(p);
      if (!Number.isInteger(qn) || qn <= 0) { errors.push(`tier${n}_qty must be a whole number > 0`); continue; }
      if (!Number.isFinite(pc) || pc < 0 || p === '') { errors.push(`tier${n}_price must be a number ≥ 0`); continue; }
      tiers.push({ min_qty: qn, unit_price_cents: pc });
    }
    for (let i = 1; i < tiers.length; i++) if (tiers[i].min_qty <= tiers[i - 1].min_qty) { errors.push('Tier quantities must go up (tier1 < tier2 < tier3)'); break; }
    if (!yesNoValid(raw.octopus_dropship)) errors.push('octopus_dropship must be yes or no');
    if (!yesNoValid(raw.ready_to_ship)) errors.push('ready_to_ship must be yes or no');
    if (raw.origin_country && !/^[A-Za-z]{2}$/.test(raw.origin_country)) errors.push('origin_country must be a 2-letter code');
    // images (ADDON-33 §5e): case-insensitive match; missing → warning, the product still imports
    const images: ImportImage[] = [];
    IMAGE_COLS.forEach((col, i) => {
      const cell = raw[col] ?? '';
      if (!cell) return;
      const pos = (i + 1) as 1 | 2 | 3;
      if (/[\\/]/.test(cell)) { warnings.push(`${col} "${cell}" must be a file name, not a path — ignored`); return; }
      if (!IMAGE_EXT.test(cell)) { warnings.push(`${col} "${cell}" must be .jpg, .jpeg, .png, .webp or .avif — ignored`); return; }
      const m = matchImage(cell, entries);
      if (m.entry && m.entry.size > MAX_IMAGE_BYTES) { warnings.push(`${col} "${m.entry.name}" is larger than 15 MB — ignored`); return; }
      images.push({ position: pos, cell, zip_path: m.entry?.path ?? null, zip_name: m.entry?.name ?? null, status: m.entry ? (m.caseMismatch ? 'case' : 'matched') : 'missing' });
    });
    rows.push({
      row_no: rowNo, errors, warnings,
      data: {
        sku, title, category_path: raw.category_path, category_id, supplier_code: code, supplier_id: sup?.id ?? null,
        unit: raw.unit, moq: moq != null && Number.isFinite(moq) ? moq : null, lead_time_days: lead != null && Number.isFinite(lead) ? lead : null,
        incoterm: raw.incoterm ? raw.incoterm.toUpperCase() : null, origin_country: raw.origin_country ? raw.origin_country.toUpperCase() : null,
        hs_code: raw.hs_code || null, currency, tiers, octopus_dropship: yes(raw.octopus_dropship), ready_to_ship: yes(raw.ready_to_ship), description: raw.description || null,
        images, mode: 'create', product_id: null,
      },
    });
  });
  if (!rows.length) return fail('No product rows found in the Products sheet.');

  // §5a — SKU repeated inside the file: every copy gets the error with all row numbers
  const dupes = inFileDuplicateErrors(rows.map((r) => ({ row: r.row_no, sku: r.data.sku ?? '' })), SKU_ERRORS.duplicateInFile);
  for (const r of rows) { const e = dupes.get(r.row_no); if (e) r.errors.push(e); }

  // §5b–d — SKU against the platform (service role lookup; the owner is never revealed)
  const skus = [...new Set(rows.map((r) => r.data.sku).filter(Boolean))] as string[];
  const status = new Map<string, { product_id: string | null; supplier_id: string | null; state: string }>();
  for (let i = 0; i < skus.length; i += 500) {
    const { data } = await admin.rpc('sku_status', { p_skus: skus.slice(i, i + 500) });
    for (const s of (data ?? []) as { sku: string; product_id: string | null; supplier_id: string | null; state: string }[]) status.set(normalizeSku(s.sku), s);
  }
  const updIds = [...status.values()].filter((s) => s.state === 'exists').map((s) => s.product_id!) ;
  const { data: existing } = updIds.length
    ? await admin.from('products').select('id, supplier_id, title, category_id, unit, moq, lead_time_days, incoterm, origin_country, hs_code, currency, octopus_dropship, ready_to_ship, description, price_tiers(min_qty, unit_price_cents), product_media(sort, url, source_file_name, sha256)').in('id', updIds)
    : { data: [] };
  const exById = new Map((existing ?? []).map((p) => [p.id as string, p]));
  // Step C: supplier costs of the products being updated (preferred supplier, current quotes)
  const { data: costRows } = updIds.length
    ? await admin.from('supplier_product_prices').select('product_id, supplier_id, moq_tier_min, price_minor').in('product_id', updIds).eq('is_superseded', false)
    : { data: [] };
  const costsBy = new Map<string, { moq_tier_min: number; price_minor: number }[]>();
  for (const c of costRows ?? []) costsBy.set(c.product_id as string, [...(costsBy.get(c.product_id as string) ?? []), { moq_tier_min: Number(c.moq_tier_min), price_minor: Number(c.price_minor) }]);
  let costFlagged = 0;
  let unchanged = 0;
  for (const r of rows) {
    const d = r.data;
    if (!d.sku || skuProblem(d.sku)) { if (!d.category_path) r.errors.push('Missing category_path'); continue; }
    const st = status.get(d.sku);
    if (!st || st.state === 'free') { d.mode = 'create'; d.unit ||= 'pcs'; d.incoterm ??= 'FOB'; if (!d.category_path) r.errors.push('Missing category_path'); }
    else if (st.state === 'retired') r.errors.push(SKU_ERRORS.retired);
    else if (st.supplier_id !== d.supplier_id || !d.supplier_id) r.errors.push(SKU_ERRORS.otherSupplier);
    else {
      const cur = exById.get(st.product_id!);
      d.mode = 'update'; d.product_id = st.product_id;
      if (cur) {
        // blank optional cells on an UPDATE keep the current value (like blank image cells)
        d.unit ||= cur.unit as string;
        d.incoterm ??= cur.incoterm as string | null; d.origin_country ??= cur.origin_country as string | null; d.hs_code ??= cur.hs_code as string | null;
        d.lead_time_days ??= cur.lead_time_days as number | null; d.description ??= cur.description as string | null;
        if (!d.category_path) { d.category_id = cur.category_id as string | null; d.category_path = pathOf.get(cur.category_id as string) ?? ''; }   // blank → keep
        const media = ((cur.product_media ?? []) as { sort: number; url: string; source_file_name: string | null; sha256: string | null }[]);
        for (const img of d.images ?? []) {
          const at = media.find((m) => m.sort === img.position);
          // same file name already at that position → same photo, no change (missing from the zip or re-sent)
          if (at && exportImageName(at).toLowerCase() === (img.zip_name ?? img.cell).toLowerCase()) img.status = 'unchanged';
        }
        const tiersCur = ((cur.price_tiers ?? []) as { min_qty: number; unit_price_cents: number }[]).map((t) => ({ min_qty: Number(t.min_qty), unit_price_cents: Number(t.unit_price_cents) })).sort((a, b) => a.min_qty - b.min_qty);
        d.diff = diffProduct(
          { title: cur.title as string, category_id: cur.category_id as string | null, category_path: pathOf.get(cur.category_id as string) ?? undefined, unit: cur.unit as string, moq: cur.moq as number,
            lead_time_days: cur.lead_time_days as number | null, incoterm: cur.incoterm as string | null, origin_country: cur.origin_country as string | null, hs_code: cur.hs_code as string | null,
            currency: (cur.currency as string) ?? 'USD', octopus_dropship: !!cur.octopus_dropship, ready_to_ship: !!cur.ready_to_ship, description: cur.description as string | null, tiers: tiersCur },
          { ...d, category_path: d.category_id ? pathOf.get(d.category_id) : d.category_path, currency: d.currency ?? 'USD' },
        );
        const imgChanges = (d.images ?? []).filter((i) => i.status === 'matched' || i.status === 'case');
        imgChanges.forEach((i) => d.diff!.push({ field: `image ${i.position}`, from: (() => { const at = media.find((m) => m.sort === i.position); return at ? exportImageName(at) : '—'; })(), to: i.zip_name ?? i.cell }));
        if (!d.diff.length && !r.errors.length) { d.mode = 'unchanged'; unchanged++; }
      }
    }
    if (d.product_id && pricesEqualSupplierCost(d.tiers, costsBy.get(d.product_id) ?? [])) {
      d.cost_flag = true; costFlagged++;
      if (d.mode === 'unchanged') { d.mode = 'update'; unchanged--; }   // never silently skip a flagged row
      r.warnings.push(`${COST_PRICE_WARNING} — the tier prices in this row are the supplier's cost. Confirm before importing, or enter buyer prices.`);
    }
    for (const img of d.images ?? []) {
      if (img.status === 'missing') r.warnings.push(`Image "${img.cell}" was not found in the zip — imported without it`);
      if (img.status === 'case') r.warnings.push(`Image "${img.cell}" matched "${img.zip_name}" in the zip (different upper/lower case)`);
    }
  }
  const extra = entries.length ? unreferenced(entries, rows.flatMap((r) => (r.data.images ?? []).map((i) => i.cell))) : [];

  const valid = rows.filter((r) => !r.errors.length).length;
  const supplierIds = [...new Set(rows.map((r) => r.data.supplier_id).filter(Boolean))];
  const { data: job, error } = await sb.from('import_jobs').insert({
    file_name: file.name, status: 'validated', total_rows: rows.length, valid_rows: valid, error_rows: rows.length - valid, unchanged_rows: unchanged,
    created_by: g.s.userId, supplier_id: supplierIds.length === 1 ? supplierIds[0] : null, zip_path: zipPath || null, zip_unreferenced: extra, cost_flagged_rows: costFlagged,
  }).select('id').single();
  if (error) return fail(error);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ job_id: job.id, row_no: r.row_no, data: r.data, errors: r.errors.length ? r.errors : null, warnings: r.warnings.length ? r.warnings : null }));
    const { error: e } = await sb.from('import_rows').insert(chunk);
    if (e) return fail(e);
  }
  revalidatePath('/distributor/products/import');
  redirect(`/distributor/products/import?job=${job.id}`);
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

/** Create / update every valid row (one transaction per product via import_product_row). Unchanged rows are skipped. */
export async function importValidRows(jobId: string): Promise<Result> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const admin = createAdminClient();
  const { data: job } = await sb.from('import_jobs').select('id, status, zip_path, cost_flagged_rows, cost_confirmed_at').eq('id', jobId).maybeSingle();
  if (!job) return fail('Import job not found');
  if ((job.cost_flagged_rows ?? 0) > 0 && !job.cost_confirmed_at) {
    return fail(`${job.cost_flagged_rows} row${job.cost_flagged_rows === 1 ? '' : 's'}: ${COST_PRICE_WARNING}. Confirm these prices first (or fix the sheet and upload it again).`);
  }
  const { data: rows } = await sb.from('import_rows').select('id, row_no, data, errors, product_id').eq('job_id', jobId).is('errors', null).is('product_id', null).order('row_no');
  // inflate only the zip entries that rows actually use
  const want = new Set((rows ?? []).flatMap((r) => ((r.data as ImportData).images ?? []).filter((i) => i.zip_path && (i.status === 'matched' || i.status === 'case')).map((i) => i.zip_path!)));
  let files: Record<string, Uint8Array> = {};
  if (job.zip_path && want.size) {
    const buf = await zipBytes(job.zip_path);
    if (buf) files = unzipSync(buf, { filter: (f) => want.has(f.name) });
  }
  const uploaded = new Map<string, string>(); // sha → public url (same photo stored once, linked to every product)
  const upload = async (path: string) => {
    const bytes = files[path]; if (!bytes) return null;
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (!uploaded.has(sha)) {
      const ext = (path.split('.').pop() ?? 'jpg').toLowerCase();
      const key = `products/sha/${sha}.${ext}`;
      const up = await admin.storage.from('product-media').upload(key, bytes, { contentType: MIME[ext] ?? 'application/octet-stream', upsert: false });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) return null;
      uploaded.set(sha, admin.storage.from('product-media').getPublicUrl(key).data.publicUrl);
    }
    return { sha, url: uploaded.get(sha)!, key: `products/sha/${sha}.${(path.split('.').pop() ?? 'jpg').toLowerCase()}` };
  };
  let created = 0, updated = 0, skipped = 0; const failures: string[] = [];
  for (const r of rows ?? []) {
    const d = r.data as ImportData;
    if (d.mode === 'unchanged') { skipped++; continue; }
    const images: { position: number; url: string; storage_path: string; source_file_name: string; sha256: string }[] = [];
    for (const img of d.images ?? []) {
      if (!img.zip_path || (img.status !== 'matched' && img.status !== 'case')) continue;
      const u = await upload(img.zip_path);
      if (u) images.push({ position: img.position, url: u.url, storage_path: u.key, source_file_name: img.zip_name ?? img.cell, sha256: u.sha });
    }
    const mode = d.mode === 'update' ? 'update' : 'create';
    const { data: pid, error } = await sb.rpc('import_product_row', { p: {
      mode, product_id: d.product_id, sku: d.sku, slug: `${slugify(d.title).slice(0, 80)}-${Math.random().toString(36).slice(2, 8)}`,
      title: d.title, description: d.description, supplier_id: d.supplier_id, category_id: d.category_id, unit: d.unit || 'pcs', moq: d.moq ?? 1,
      lead_time_days: d.lead_time_days, incoterm: d.incoterm ?? (mode === 'create' ? 'FOB' : null), origin_country: d.origin_country, hs_code: d.hs_code,
      currency: d.currency === 'CNY' ? 'CNY' : 'USD', octopus_dropship: d.octopus_dropship, ready_to_ship: d.ready_to_ship, tiers: d.tiers, images,
    } });
    if (error) {
      // §6 — a SKU taken by a parallel upload is a row error, never a 500
      const msg = skuDbError(error.message) ?? (/NOT_EDITABLE/.test(error.message) ? 'You cannot edit this product.' : error.message);
      failures.push(`Row ${r.row_no}: ${msg}`);
      await sb.from('import_rows').update({ errors: [msg] }).eq('id', r.id);
      continue;
    }
    await sb.from('import_rows').update({ product_id: pid as string }).eq('id', r.id);
    if (mode === 'update') updated++; else created++;
  }
  const { count: errCount } = await sb.from('import_rows').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('errors', 'is', null);
  await sb.from('import_jobs').update({ status: 'imported', error_rows: errCount ?? 0 }).eq('id', jobId);
  if (job.zip_path) await admin.storage.from('imports').remove([job.zip_path]).catch(() => undefined);
  revalidatePath('/distributor/products/import');
  revalidatePath('/distributor/products');
  revalidateTag('products', 'max');
  // always "ok" once rows were processed, so the report refreshes and shows each failed row's error next to it
  return ok(undefined, `${created} created as drafts · ${updated} updated · ${skipped} unchanged${failures.length ? ` · ${failures.length} failed` : ''}`);
}

/**
 * Submit every valid product of the job (creates AND updates) for moderation — submit_import_job(): one transaction,
 * products → 'submitted' (what /office/products reads), per-row reasons when a product cannot be submitted, job status
 * set from what really changed, audit_log row. Never reports success when nothing moved.
 */
export async function submitImported(jobId: string): Promise<Result> {
  const g = await actionSession('products', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data, error } = await sb.rpc('submit_import_job', { p_job: jobId });
  revalidatePath('/distributor/products/import');
  revalidatePath('/office/products');
  if (error) return fail(error);
  const r = data as { total: number; submitted: number; already_in_moderation: number; failed: number; job_status: string };
  const parts = [`${r.submitted} submitted for moderation`];
  if (r.already_in_moderation) parts.push(`${r.already_in_moderation} already in moderation or live`);
  if (r.failed) parts.push(`${r.failed} could not be submitted — see the reason on each row`);
  if (!r.submitted && !r.already_in_moderation) return fail(parts.join(' · '));
  return ok(undefined, parts.join(' · '));
}

/** Step C: the user confirms that rows whose prices equal the supplier cost really are buyer prices. Audited. */
export async function confirmCostPrices(jobId: string): Promise<Result> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data, error } = await sb.from('import_jobs').update({ cost_confirmed_at: new Date().toISOString(), cost_confirmed_by: g.s.userId })
    .eq('id', jobId).gt('cost_flagged_rows', 0).is('cost_confirmed_at', null).select('cost_flagged_rows').maybeSingle();
  if (error) return fail(error);
  if (!data) return fail('Nothing to confirm on this job.');
  await createAdminClient().from('audit_log').insert({ actor_id: g.s.userId, action: 'import_job.cost_prices_confirmed', entity: 'import_jobs', entity_id: jobId, details: { rows: data.cost_flagged_rows } });
  revalidatePath('/distributor/products/import');
  return ok(undefined, 'Prices confirmed — you can import now');
}
