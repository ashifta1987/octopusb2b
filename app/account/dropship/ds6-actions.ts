'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { connectorPushNow } from '@/lib/connectors/runtime-server';

/**
 * Octopus Dropship · Step 6 + 6b merchant — server actions. Every action checks the merchant (and that the feature that
 * owns the page is switched on: requireDropshipV2Merchant(featurePath) redirects otherwise), then calls one SECURITY
 * DEFINER RPC, which checks again (org via auth.uid(), paused / closed merchants refused for anything new, feature list).
 * Actions answer { ok, message } so the page can show the reason next to the control; they never throw raw DB errors.
 */

export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T; message?: string } | { ok: false; message: string; code?: string; fields?: { field: string; kind: string }[] };

const Uuid = z.string().uuid();
/** CONN S2b: start the push / unlink for a non-Shopify store right after the answer (the 5-minute job picks up anything left) */
const kickPush = () => after(async () => { await connectorPushNow().catch(() => undefined); });
const Uuids = z.array(Uuid).min(1).max(200);

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error), code: error.message.split(':')[0].trim() };
  return { ok: true, data: data as T };
}

function revalidateDs6() {
  revalidatePath('/account/dropship/catalogue', 'layout');
  revalidatePath('/account/dropship/import', 'layout');
  revalidatePath('/account/dropship/push');
  revalidatePath('/account/dropship/pushed');
  revalidatePath('/account/dropship/pricing');
}

/* ───────── Import list ───────── */

export async function importRemoveAction(productIds: string[]): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/import');
  const p = Uuids.safeParse(productIds);
  if (!p.success) return { ok: false, message: 'Select at least one product.' };
  const r = await rpc<{ removed: number }>('ds_import_remove', { p_product_ids: p.data });
  if (r.ok) revalidateDs6();
  return r;
}

export async function importApplyRuleAction(productIds: string[]): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/import');
  const p = Uuids.safeParse(productIds);
  if (!p.success) return { ok: false, message: 'Select at least one product.' };
  const r = await rpc<{ updated: number }>('ds_import_apply_rule', { p_product_ids: p.data });
  if (r.ok) revalidateDs6();
  return r;
}

const BulkLine = z.object({ line: z.number().int().min(1), model_no: z.string().max(60), variant: z.string().max(60).optional() });

export async function importBulkAddAction(lines: { line: number; model_no: string; variant?: string }[]): Promise<ActionResult<{ added: number; skipped: { line: number; model_no: string; reason: string }[]; lines: number }>> {
  await requireDropshipV2Merchant('/account/dropship/import');
  const p = z.array(BulkLine).min(1).max(500).safeParse(lines);
  if (!p.success) return { ok: false, message: 'The file must have between 1 and 500 lines with a model_no column.' };
  const r = await rpc<{ added: number; skipped: { line: number; model_no: string; reason: string }[]; lines: number }>('ds_import_bulk_add', { p_lines: p.data });
  if (r.ok) revalidateDs6();
  return r;
}

/* ───────── Product editor ───────── */

const ListingInput = z.object({
  title: z.string().max(255),
  description: z.string().max(20000),
  image_urls: z.array(z.string().url().max(2000)).max(50),
  vendor: z.string().max(120).nullable(),
  product_type: z.string().max(120).nullable(),
  collection: z.string().max(120).nullable(),
  tags: z.array(z.string().max(255)).max(100),
  handle: z.string().max(255).nullable(),
  seo_title: z.string().max(70).nullable(),
  seo_description: z.string().max(160).nullable(),
  publish_as: z.enum(['draft', 'active']),
  sync_stock: z.boolean(),
  sync_price: z.boolean(),
  price_mode: z.enum(['rule', 'manual']),
  variants: z.array(z.object({
    variant_id: Uuid,
    include: z.boolean(),
    store_sku: z.string().max(64).nullable(),
    price_minor: z.number().int().positive().max(100_000_000).nullable(),
    compare_at_minor: z.number().int().positive().max(100_000_000).nullable(),
  })).max(200),
});
export type ListingInputT = z.infer<typeof ListingInput>;

export async function listingSaveAction(productId: string, listing: ListingInputT): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/import');
  if (!Uuid.safeParse(productId).success) return { ok: false, message: 'Unknown product.' };
  const p = ListingInput.safeParse(listing);
  if (!p.success) return { ok: false, message: `Please check ${p.error.issues[0]?.path.join(' ') || 'the form'}: ${p.error.issues[0]?.message ?? ''}`.trim() };
  const r = await rpc<{ ok: boolean; code?: string; message?: string; fields?: { field: string; kind: string }[] }>('ds_listing_save', { p_product_id: productId, p_listing: p.data });
  if (!r.ok) return r;
  if (r.data.ok === false) {
    // white-label refusal: the FIELDS are named, never the matched supplier / model term
    return { ok: false, code: r.data.code, fields: r.data.fields, message: 'Some text mentions a supplier or factory name, a model number or the word Octopus. Remove it before saving. Supplier and factory names are never sent to your store.' };
  }
  revalidateDs6();
  return { ok: true, data: r.data, message: 'Saved. Your store copy is updated; the Octopus product stays the same.' };
}

export async function textCheckAction(productId: string, fields: Record<string, string>): Promise<ActionResult<{ ok: boolean; fields: { field: string; kind: string }[] }>> {
  await requireDropshipV2Merchant('/account/dropship/import');
  if (!Uuid.safeParse(productId).success) return { ok: false, message: 'Unknown product.' };
  const clean = Object.fromEntries(Object.entries(fields ?? {}).slice(0, 80).map(([k, v]) => [k.slice(0, 80), String(v ?? '').slice(0, 20000)]));
  return rpc('ds_text_check', { p_product_id: productId, p_fields: clean });
}

/* ───────── Pricing and sync ───────── */

const RulesInput = z.object({
  bands: z.array(z.object({
    from_cents: z.number().int().min(0),
    to_cents: z.number().int().positive().nullable(),
    multiplier_milli: z.number().int(),
    fixed_cents: z.number().int().min(0),
  })).min(1).max(10),
  rounding: z.enum(['end_99', 'end_95', 'whole', 'none']),
  compare_at_bp: z.union([z.literal(2500), z.literal(5000)]).nullable(),
  min_profit_bp: z.number().int().min(0).max(9000),
  store_currency: z.string().regex(/^[A-Z]{3}$/),
  fx_threshold_bp: z.number().int().min(0).max(5000).nullable(),
  main_market: z.string().regex(/^[A-Z]{2}$/).nullable(),
  when_landed_up: z.enum(['reprice', 'ask', 'alert']),
  when_landed_down: z.enum(['keep', 'reprice']),
  when_out_of_stock: z.enum(['draft', 'sold_out', 'nothing']),
  check_every_hours: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(24)]),
  alert_low_stock: z.boolean(),
  email_alerts: z.boolean(),
});
export type RulesInputT = z.infer<typeof RulesInput>;

export async function pricingSaveAction(rules: RulesInputT): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/pricing');
  const p = RulesInput.safeParse(rules);
  if (!p.success) return { ok: false, message: 'Please check the rule: every band needs numbers, and the minimum margin is between 0% and 90%.' };
  const r = await rpc('ds_pricing_save', { p_rules: p.data });
  if (r.ok) { revalidateDs6(); return { ...r, message: 'Rules saved. New pushes use them; products already in your store change only through the sync rules.' }; }
  return r;
}

export async function priceApprovalAction(id: string, decision: 'approve' | 'keep_old'): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/pricing');
  if (!Uuid.safeParse(id).success || !['approve', 'keep_old'].includes(decision)) return { ok: false, message: 'Unknown change.' };
  const r = await rpc('ds_price_approval_decide', { p_id: id, p_decision: decision });
  if (r.ok) revalidatePath('/account/dropship/pricing');
  return r;
}

/* ───────── Push queue ───────── */

const PushOptions = z.object({
  publish_as: z.enum(['draft', 'active']),
  collection: z.string().max(120).nullable(),
  push_images: z.boolean(),
  push_seo: z.boolean(),
  keep_synced: z.boolean(),
});

export async function pushEnqueueAction(productIds: string[], options: z.infer<typeof PushOptions>, confirmBelowMin: string[], requestKey: string): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/push');
  const ids = z.array(Uuid).min(1).max(100).safeParse(productIds);
  const opts = PushOptions.safeParse(options);
  if (!ids.success || !opts.success || !Uuid.safeParse(requestKey).success) return { ok: false, message: 'Select between 1 and 100 products to push.' };
  const confirm = z.array(Uuid).max(100).safeParse(confirmBelowMin ?? []);
  const r = await rpc('ds_push_enqueue', { p_product_ids: ids.data, p_options: opts.data, p_confirm_below_min: confirm.success ? confirm.data : [], p_request_key: requestKey });
  if (r.ok) { revalidateDs6(); kickPush(); }
  return r;
}

export async function pushCancelAction(jobIds: string[]): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/push');
  const p = Uuids.safeParse(jobIds);
  if (!p.success) return { ok: false, message: 'Nothing selected.' };
  const r = await rpc('ds_push_cancel', { p_job_ids: p.data });
  if (r.ok) revalidateDs6();
  return r;
}

export async function pushRetryAction(jobIds: string[], requestKey: string, confirmBelowMin: string[] = []): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/push');
  const p = Uuids.safeParse(jobIds);
  if (!p.success || !Uuid.safeParse(requestKey).success) return { ok: false, message: 'Nothing selected.' };
  const r = await rpc('ds_push_retry', { p_job_ids: p.data, p_request_key: requestKey, p_confirm_below_min: z.array(Uuid).max(100).catch([]).parse(confirmBelowMin) });
  if (r.ok) { revalidateDs6(); kickPush(); }
  return r;
}

export async function unlinkAction(productIds: string[], requestKey: string): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/pushed');
  const p = z.array(Uuid).min(1).max(100).safeParse(productIds);
  if (!p.success || !Uuid.safeParse(requestKey).success) return { ok: false, message: 'Select at least one product.' };
  const r = await rpc('ds_unlink', { p_product_ids: p.data, p_request_key: requestKey });
  if (r.ok) { revalidateDs6(); kickPush(); }
  return r;
}

/* ───────── Packing and shipping ───────── */

const PackingInput = z.object({
  default_packaging: z.enum(['standard', 'protective', 'branded']),
  branded_sku_id: Uuid.nullable(),
  insert_card: z.boolean(),
  insert_card_sku_id: Uuid.nullable(),
  sticker: z.boolean(),
  sticker_sku_id: Uuid.nullable(),
  gift_message: z.boolean(),
  packing_slip: z.enum(['brand_no_prices', 'none']),
  insurance: z.boolean(),
  signature: z.boolean(),
  default_method: z.enum(['economy', 'standard', 'express']),
  fallback_method: z.enum(['cheapest_on_time', 'economy', 'standard', 'express']),
  duty_modes: z.record(z.string().regex(/^[A-Z]{2}$/), z.enum(['DDP', 'DAP'])),
});
export type PackingInputT = z.infer<typeof PackingInput>;

export async function packingSaveAction(input: PackingInputT): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/packing');
  const p = PackingInput.safeParse(input);
  if (!p.success) return { ok: false, message: 'Please check the form and try again.' };
  const r = await rpc('ds_packing_save', { p: p.data });
  if (r.ok) {
    revalidatePath('/account/dropship/packing');
    revalidateDs6();
    return { ...r, message: 'Saved. Prices in your import list now use these duties and packaging.' };
  }
  return r;
}

export async function rateMappingAction(mappingId: string, method: 'economy' | 'standard' | 'express' | null): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/packing');
  if (!Uuid.safeParse(mappingId).success) return { ok: false, message: 'Unknown rate.' };
  const r = await rpc('ds_rate_mapping_save', { p_mapping_id: mappingId, p_method: method });
  if (r.ok) revalidatePath('/account/dropship/packing');
  return r;
}
