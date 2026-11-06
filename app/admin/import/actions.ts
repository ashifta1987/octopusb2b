'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guard, fail, ok, type Result } from '@/components/admin/server';
import { createAdminClient } from '@/lib/supabase/server';
import { commitImport, stageImport } from '@/lib/import/core';

/** ADDON-27 bulk import — server actions. Permission: products.edit (RPCs re-check in the database). */

const MAX_FILE = 50 * 1024 * 1024;
const SAFE = /^[\w.\- ()]+$/;

/** Step 1: signed upload URLs so the browser uploads the XLSX / ZIP straight to private Storage (no 4.5 MB function limit). */
export async function createImportUploads(files: { name: string; size: number; kind: 'xlsx' | 'zip' }[]):
  Promise<{ ok: true; uploads: { kind: string; path: string; token: string }[] } | { ok: false; error: string }> {
  const g = await guard('products', 'edit');
  if ('error' in g) return { ok: false, error: g.error.ok ? 'FORBIDDEN' : g.error.error };
  const out: { kind: string; path: string; token: string }[] = [];
  const admin = createAdminClient();
  const stamp = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  for (const f of files) {
    if (f.size > MAX_FILE) return { ok: false, error: `${f.name} is larger than 50 MB.` };
    if (f.kind === 'xlsx' && !/\.xlsx$/i.test(f.name)) return { ok: false, error: 'The workbook must be an .xlsx file.' };
    if (f.kind === 'zip' && !/\.zip$/i.test(f.name)) return { ok: false, error: 'Images must be a .zip file.' };
    const base = SAFE.test(f.name) ? f.name : `${f.kind}.${f.kind}`;
    const path = `${stamp}/${base}`;
    const { data, error } = await admin.storage.from('imports').createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message ?? 'Upload could not start.' };
    out.push({ kind: f.kind, path, token: data.token });
  }
  return { ok: true, uploads: out };
}

async function download(path: string | null | undefined): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data, error } = await createAdminClient().storage.from('imports').download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? 'missing'}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Step 2: parse + validate + diff → a previewed import run. */
export async function stageImportRun(input: { name: string; validFrom: string; xlsxPath: string; zipPath?: string | null }):
  Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const g = await guard('products', 'edit');
  if ('error' in g) return { ok: false, error: g.error.ok ? 'FORBIDDEN' : g.error.error };
  const name = input.name.trim().slice(0, 120);
  if (name.length < 3) return { ok: false, error: 'Give the import a name, e.g. "Bowijie 2026-11 catalogue".' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) return { ok: false, error: 'Choose the date the supplier prices are valid from.' };
  try {
    const xlsx = await download(input.xlsxPath);
    const zip = await download(input.zipPath ?? null);
    const { runId } = await stageImport(createAdminClient(), {
      name, xlsx: xlsx!, zip, validFrom: input.validFrom, actor: g.s.userId,
      source: { xlsx_path: input.xlsxPath, images_path: input.zipPath ?? null },
    });
    revalidatePath('/admin/import');
    return { ok: true, runId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.replace(/^IMPORT_[A-Z_]+:\s*/, '') };
  }
}

/** Step 4: commit (images → product-media, then one DB transaction). */
export async function commitImportRun(runId: string): Promise<Result> {
  const g = await guard('products', 'edit');
  if ('error' in g) return g.error;
  const admin = createAdminClient();
  const { data: run } = await admin.from('import_runs').select('id, status, source').eq('id', runId).maybeSingle();
  if (!run) return fail('NOT_FOUND');
  if (run.status === 'committed') return ok('Already committed');
  try {
    const zip = await download((run.source as { images_path?: string | null })?.images_path);
    const report = await commitImport(admin, { runId, actor: g.s.userId, zip }) as Record<string, { create?: number }>;
    revalidateTag('products', 'max');
    revalidatePath('/admin/import');
    return ok(`Committed: ${report.products?.create ?? 0} new products, ${report.prices?.create ?? 0} new prices, ${report.images?.create ?? 0} images.`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function discardImportRun(runId: string): Promise<Result> {
  const g = await guard('products', 'edit');
  if ('error' in g) return g.error;
  const { error } = await createAdminClient().from('import_runs').update({ status: 'discarded' }).eq('id', runId).eq('status', 'previewed');
  if (error) return fail(error);
  revalidatePath('/admin/import');
  return ok('Preview discarded');
}

export async function decideReview(itemId: string, status: 'accepted_quote' | 'accepted_dashboard' | 'resolved' | 'held' | 'open', note?: string): Promise<Result> {
  const g = await guard('products', 'edit');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('decide_import_review', { p_item: itemId, p_status: status, p_note: note ?? null });
  if (error) return fail(error);
  revalidatePath('/admin/import', 'layout');
  return ok(status === 'held' ? 'Held' : status === 'open' ? 'Reopened' : 'Resolved');
}

export async function setCanonicalName(supplierId: string, variantId: string): Promise<Result> {
  const g = await guard('suppliers', 'edit');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('set_supplier_canonical_name', { p_supplier: supplierId, p_variant: variantId });
  if (error) return fail(error);
  revalidatePath('/admin/suppliers');
  revalidatePath('/admin/import', 'layout');
  return ok('Canonical legal name set');
}

export async function setProductPricing(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('products', 'edit');
  if ('error' in g) return g.error;
  const id = String(fd.get('product_id') ?? '');
  const mode = fd.get('mode') === 'manual' ? 'manual' : 'markup';
  const raw = String(fd.get('markup') ?? '').trim();
  const markup = raw === '' ? null : Number(raw);
  if (markup != null && (!Number.isFinite(markup) || markup < 0 || markup > 1000)) return fail('Markup must be a number from 0 to 1000 (%).');
  const { error } = await g.sb.rpc('set_product_pricing', { p_product: id, p_mode: mode, p_markup: markup });
  if (error) return fail(error);
  revalidateTag('products', 'max');
  revalidatePath('/admin/import', 'layout');
  return ok(mode === 'manual' ? 'Manual prices — edit the tiers on the product' : 'Buyer prices recalculated');
}

