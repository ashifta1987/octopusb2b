'use server';
import ExcelJS from 'exceljs';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { slugify, toCents } from '@/lib/format';
import { actionSession, fail, ok, getManagedSuppliers, type Result } from '@/components/backoffice/server-utils';
import { IMPORT_COLUMNS, type ImportData } from '@/components/backoffice/import-columns';

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

/** Parse + validate an uploaded workbook into import_jobs / import_rows with per-row errors. */
export async function validateImport(fd: FormData): Promise<Result<{ jobId: string }>> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Choose an .xlsx file to upload.');
  if (!file.name.toLowerCase().endsWith('.xlsx')) return fail('Upload the .xlsx template (CSV is not supported yet).');
  if (file.size > 10 * 1024 * 1024) return fail('File is larger than 10 MB.');

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return fail('Could not read this file. Is it a valid .xlsx?'); }
  const ws = wb.getWorksheet('Products') ?? wb.worksheets[0];
  if (!ws) return fail('The workbook has no sheets.');

  // header map
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => header.set(cellText(c.value).toLowerCase().trim(), col));
  // legacy templates (before SPEC §15.1) have tierN_price_usd instead of tierN_price
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !header.has(c.key) && !header.has(`${c.key}_usd`)).map((c) => c.key);
  if (missing.length) return fail(`Missing columns: ${missing.join(', ')}. Download the latest template.`);

  const sb = await createClient();
  const suppliers = await getManagedSuppliers(g.s);
  const supByCode = new Map(suppliers.map((s) => [s.code.toUpperCase(), s]));
  const { data: allSup } = await sb.from('public_suppliers').select('id, code');
  const knownCodes = new Set((allSup ?? []).map((s) => s.code.toUpperCase()));
  const { data: cats } = await sb.from('categories').select('id, name, parent_id').eq('active', true);
  const byId = new Map((cats ?? []).map((c) => [c.id, c]));
  const pathMap = new Map<string, string>();
  const nameCount = new Map<string, string[]>();
  for (const c of cats ?? []) {
    const parts: string[] = []; let cur: typeof c | undefined = c;
    while (cur) { parts.unshift(cur.name.toLowerCase().trim()); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    pathMap.set(parts.join(' > '), c.id);
    const n = c.name.toLowerCase().trim();
    nameCount.set(n, [...(nameCount.get(n) ?? []), c.id]);
  }
  const resolveCategory = (p: string) => {
    const norm = p.split('>').map((x) => x.trim().toLowerCase()).filter(Boolean).join(' > ');
    if (pathMap.has(norm)) return pathMap.get(norm)!;
    const leaf = norm.split(' > ').pop() ?? '';
    const m = nameCount.get(leaf);
    return m && m.length === 1 ? m[0] : null;
  };

  const rows: { row_no: number; data: ImportData; errors: string[] }[] = [];
  const get = (r: ExcelJS.Row, key: string) => { const col = header.get(key); return col ? cellText(r.getCell(col).value) : ''; };
  const intOrNull = (s: string) => (s === '' ? null : Number(s));
  const yes = (s: string) => ['yes', 'y', 'true', '1'].includes(s.toLowerCase());
  const yesNoValid = (s: string) => s === '' || ['yes', 'no', 'y', 'n', 'true', 'false', '1', '0'].includes(s.toLowerCase());

  ws.eachRow({ includeEmpty: false }, (r, rowNo) => {
    if (rowNo === 1 || rows.length >= MAX_ROWS) return;
    const raw = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, get(r, c.key)])) as Record<string, string>;
    if (Object.values(raw).every((v) => v === '')) return;
    const errors: string[] = [];
    const title = raw.title;
    if (!title) errors.push('Missing title');
    else if (title.length < 3) errors.push('Title too short');

    const category_id = raw.category_path ? resolveCategory(raw.category_path) : null;
    if (!raw.category_path) errors.push('Missing category_path');
    else if (!category_id) errors.push(`Unknown category "${raw.category_path}"`);

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
      // legacy templates used tierN_price_usd (always USD)
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

    rows.push({
      row_no: rowNo,
      errors,
      data: {
        title, category_path: raw.category_path, category_id, supplier_code: code, supplier_id: sup?.id ?? null,
        unit: raw.unit || 'pcs', moq: moq != null && Number.isFinite(moq) ? moq : null, lead_time_days: lead != null && Number.isFinite(lead) ? lead : null,
        incoterm: raw.incoterm ? raw.incoterm.toUpperCase() : 'FOB', origin_country: raw.origin_country ? raw.origin_country.toUpperCase() : null,
        hs_code: raw.hs_code || null, currency, tiers, octopus_dropship: yes(raw.octopus_dropship), ready_to_ship: yes(raw.ready_to_ship), description: raw.description || null,
      },
    });
  });
  if (!rows.length) return fail('No product rows found in the Products sheet.');

  const valid = rows.filter((r) => !r.errors.length).length;
  const supplierIds = [...new Set(rows.map((r) => r.data.supplier_id).filter(Boolean))];
  const { data: job, error } = await sb.from('import_jobs').insert({
    file_name: file.name, status: 'validated', total_rows: rows.length, valid_rows: valid, error_rows: rows.length - valid,
    created_by: g.s.userId, supplier_id: supplierIds.length === 1 ? supplierIds[0] : null,
  }).select('id').single();
  if (error) return fail(error);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ job_id: job.id, row_no: r.row_no, data: r.data, errors: r.errors.length ? r.errors : null }));
    const { error: e } = await sb.from('import_rows').insert(chunk);
    if (e) return fail(e);
  }
  revalidatePath('/distributor/products/import');
  redirect(`/distributor/products/import?job=${job.id}`);
}

/** Insert every valid, not-yet-imported row as a draft product with its price tiers. */
export async function importValidRows(jobId: string): Promise<Result> {
  const g = await actionSession('products', 'create');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data: job } = await sb.from('import_jobs').select('id, status').eq('id', jobId).maybeSingle();
  if (!job) return fail('Import job not found');
  const { data: rows } = await sb.from('import_rows').select('id, row_no, data, errors, product_id').eq('job_id', jobId).is('errors', null).is('product_id', null).order('row_no');
  let done = 0; const failures: string[] = [];
  for (const r of rows ?? []) {
    const d = r.data as ImportData;
    const prices = d.tiers.map((t) => t.unit_price_cents);
    const currency = d.currency === 'CNY' ? 'CNY' : 'USD';
    const { data: p, error } = await sb.from('products').insert({
      slug: `${slugify(d.title).slice(0, 80)}-${Math.random().toString(36).slice(2, 8)}`, title: d.title, description: d.description,
      supplier_id: d.supplier_id, category_id: d.category_id, status: 'draft', unit: d.unit, moq: d.moq ?? 1, lead_time_days: d.lead_time_days,
      incoterm: d.incoterm, origin_country: d.origin_country, hs_code: d.hs_code, octopus_dropship: d.octopus_dropship, ready_to_ship: d.ready_to_ship,
      currency, min_price_cents: prices.length ? Math.min(...prices) : null, created_by: g.s.userId,
      seo_title: `${d.title} | Wholesale`.slice(0, 60),
    }).select('id').single();
    if (error) {
      failures.push(`Row ${r.row_no}: ${error.message}`);
      await sb.from('import_rows').update({ errors: [error.message] }).eq('id', r.id);
      continue;
    }
    if (d.tiers.length) await sb.from('price_tiers').insert(d.tiers.map((t) => ({ product_id: p.id, ...t, currency })));
    await sb.from('import_rows').update({ product_id: p.id }).eq('id', r.id);
    done++;
  }
  const { count: errCount } = await sb.from('import_rows').select('id', { count: 'exact', head: true }).eq('job_id', jobId).not('errors', 'is', null);
  await sb.from('import_jobs').update({ status: 'imported', error_rows: errCount ?? 0 }).eq('id', jobId);
  revalidatePath('/distributor/products/import');
  revalidatePath('/distributor/products');
  if (failures.length && !done) return fail(failures.slice(0, 3).join('; '));
  return ok(undefined, `${done} products imported as drafts${failures.length ? ` · ${failures.length} failed` : ''}`);
}

/** Submit every imported draft of this job for moderation via transition_product. */
export async function submitImported(jobId: string): Promise<Result> {
  const g = await actionSession('products', 'edit');
  if ('error' in g) return fail(g.error);
  const sb = await createClient();
  const { data: rows } = await sb.from('import_rows').select('product_id, products(status)').eq('job_id', jobId).not('product_id', 'is', null);
  let n = 0; let firstErr: string | null = null;
  for (const r of rows ?? []) {
    const st = (Array.isArray(r.products) ? r.products[0] : r.products) as { status: string } | null;
    if (st?.status !== 'draft') continue;
    const { error } = await sb.rpc('transition_product', { p_product: r.product_id, p_to: 'submitted', p_reason: 'bulk import' });
    if (error) firstErr ??= error.message; else n++;
  }
  await sb.from('import_jobs').update({ status: 'submitted' }).eq('id', jobId);
  revalidatePath('/distributor/products/import');
  if (!n && firstErr) return fail(firstErr);
  return ok(undefined, `${n} products submitted for moderation`);
}
