'use server';

import { revalidatePath } from 'next/cache';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { CarrierError, getCarrierAdapter } from '@/lib/carriers';
import type { LabelCustoms } from '@/lib/carriers/types';
import { PRODUCT_TYPES, parseCountries, type ProductType } from '@/lib/carriers/rules';
import { CARRIERS, LEVELS, TRACKING_STATUSES, labelPath, type Carrier, type Level } from '@/lib/warehouse-w4';

/**
 * Warehouse OS · W4 staff actions (carrier accounts / services / rules with two-person approval, parcel labels through the
 * carrier adapter, label check, dispatch batches with manifest, freight pallets, tracking events). Every rule (roles per
 * warehouse, two people, sandbox only on staging, label must match the order, steps) is enforced by the wh_* database functions;
 * these only shape the input, call the carrier, and choose the sentence shown.
 */
export type W4Result = { ok: boolean; message?: string; error?: string; data?: unknown };
const fail = (m: string): W4Result => ({ ok: false, error: cleanDbError(m) });
const CARRIERS_PATH = '/office/warehouse/carriers';
const DISPATCH = '/office/warehouse/dispatch';
const LABELS = '/office/warehouse/labels';
const ORDERS = '/office/warehouse/orders';
const done = (message: string, paths: string[], data?: unknown, code?: string): W4Result => {
  for (const p of [...paths, '/office/warehouse']) revalidatePath(p);
  if (code) revalidatePath(`${ORDERS}/${code}`);
  return { ok: true, message, data };
};
const uuid = (s: string | null | undefined): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
const optInt = (v: string) => (v.trim() === '' ? null : Number(v.trim()));

// ───────── carrier accounts and services ─────────
export async function saveCarrierAccountAction(f: {
  warehouse: string; id: string | null; carrier: string; name: string; mode: string; credentialEnv: string; active: boolean;
}): Promise<W4Result> {
  await requireWarehouseStaff(CARRIERS_PATH);
  if (!(CARRIERS as readonly string[]).includes(f.carrier)) return { ok: false, error: 'Choose YunExpress or 4PX.' };
  if (!['sandbox', 'live'].includes(f.mode)) return { ok: false, error: 'Choose sandbox or live.' };
  if (!f.name.trim()) return { ok: false, error: 'Give the account a name.' };
  const env = f.credentialEnv.trim().toUpperCase();
  if (env && !/^[A-Z][A-Z0-9_]{2,40}$/.test(env)) return { ok: false, error: 'The credentials name is a server setting prefix in capitals, e.g. FOURPX_FS01 — never the key itself.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_carrier_account', {
    p_warehouse: f.warehouse, p_id: f.id, p_carrier: f.carrier as Carrier, p_name: f.name.trim(), p_mode: f.mode, p_credential_env: env || null, p_active: f.active,
  });
  if (error) return fail(error.message);
  return done(f.id ? 'Account saved.' : `Account added${f.mode === 'sandbox' ? ' (sandbox: test labels only, staging only)' : ''}. Add its services next.`, [CARRIERS_PATH, DISPATCH]);
}

export async function saveCarrierServiceAction(f: {
  accountId: string; id: string | null; code: string; name: string; level: string; maxWeightG: string; battery: boolean; liquid: boolean; active: boolean;
  /** CONN S4: takes magnetic goods (undefined = keep / default yes) */
  magnet?: boolean;
}): Promise<W4Result> {
  await requireWarehouseStaff(CARRIERS_PATH);
  if (!uuid(f.accountId)) return { ok: false, error: 'Choose the account.' };
  if (!(LEVELS as readonly string[]).includes(f.level)) return { ok: false, error: 'Choose economy, standard or express.' };
  const max = optInt(f.maxWeightG);
  if (max !== null && !whole(max, 1, 1_000_000)) return { ok: false, error: 'Maximum weight is 1 to 1,000,000 g, or leave it empty.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_save_carrier_service', {
    p_account: f.accountId, p_id: f.id, p_code: f.code.trim(), p_name: f.name.trim(), p_level: f.level as Level, p_max_weight_g: max,
    p_accepts_battery: f.battery, p_accepts_liquid: f.liquid, p_active: f.active, p_accepts_magnet: typeof f.magnet === 'boolean' ? f.magnet : null,
  });
  if (error) return fail(error.message);
  return done(f.id ? 'Service saved.' : 'Service added. Use it in a rule or as the fallback.', [CARRIERS_PATH]);
}

/**
 * CONN S4 · "Test connection": the account's adapter checks the server credentials (sandbox: staging only; 4PX: a harmless
 * tracking query); the result is kept on the account and logged for System health (c4_carrier_check_record checks the role).
 */
export async function testCarrierAccountAction(accountId: string): Promise<W4Result> {
  await requireWarehouseStaff(CARRIERS_PATH);
  if (!uuid(accountId)) return { ok: false, error: 'Choose the account.' };
  const sb = await createClient();
  const { data: a, error } = await sb.from('wh_carrier_accounts').select('id, carrier, mode, credential_env').eq('id', accountId).maybeSingle();
  if (error || !a) return { ok: false, error: 'Not found. Reload the page and try again.' };
  let res: { ok: boolean; message: string };
  try {
    res = await getCarrierAdapter({ carrier: a.carrier as Carrier, mode: a.mode as 'sandbox' | 'live', credentialEnv: a.credential_env }).validateCredentials();
  } catch (e) {
    res = { ok: false, message: e instanceof CarrierError ? e.message : 'The carrier could not be checked. Try again.' };
  }
  const { error: recErr } = await sb.rpc('c4_carrier_check_record', { p_account: a.id, p_ok: res.ok, p_message: res.message });
  if (recErr) return fail(recErr.message);
  revalidatePath(CARRIERS_PATH);
  return res.ok ? { ok: true, message: `Connection works: ${res.message}` } : { ok: false, error: `Connection failed: ${res.message}` };
}

// ───────── carrier rules (proposed by a warehouse admin, approved by a different admin) ─────────
export type RuleInput = { countries: string; productType: string; minG: string; maxG: string; serviceId: string };

export async function proposeRulesAction(f: { warehouse: string; rules: RuleInput[]; fallbackId: string; note: string }): Promise<W4Result> {
  await requireWarehouseStaff(CARRIERS_PATH);
  if (f.rules.length > 50) return { ok: false, error: 'Up to 50 rules.' };
  if (!uuid(f.fallbackId)) return { ok: false, error: 'Choose the fallback service.' };
  const rules: { countries: string[]; product_type: ProductType; min_weight_g: number | null; max_weight_g: number | null; service_id: string }[] = [];
  for (const [i, r] of f.rules.entries()) {
    const countries = parseCountries(r.countries);
    if (!countries) return { ok: false, error: `Rule ${i + 1}: use two-letter country codes separated by commas (DE, FR), or leave it empty for any country.` };
    if (!(PRODUCT_TYPES as readonly string[]).includes(r.productType)) return { ok: false, error: `Rule ${i + 1}: choose the product type.` };
    const min = optInt(r.minG);
    const max = optInt(r.maxG);
    if (min !== null && !whole(min, 0, 1_000_000)) return { ok: false, error: `Rule ${i + 1}: lowest weight in whole grams.` };
    if (max !== null && !whole(max, 1, 1_000_000)) return { ok: false, error: `Rule ${i + 1}: highest weight in whole grams.` };
    if (min !== null && max !== null && min > max) return { ok: false, error: `Rule ${i + 1}: the lowest weight is above the highest.` };
    if (!uuid(r.serviceId)) return { ok: false, error: `Rule ${i + 1}: choose a service.` };
    rules.push({ countries, product_type: r.productType as ProductType, min_weight_g: min, max_weight_g: max, service_id: r.serviceId });
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_propose_carrier_rules', { p_warehouse: f.warehouse, p_rules: rules, p_fallback: f.fallbackId, p_note: f.note.trim() || null });
  if (error) return fail(error.message);
  const d = data as { version: number; rules: number };
  return done(`Version ${d.version} proposed (${d.rules} rule${d.rules === 1 ? '' : 's'} + fallback). A different admin approves it before it is used.`, [CARRIERS_PATH], d);
}

export async function decideRulesAction(id: string, decision: 'approve' | 'reject', reason: string): Promise<W4Result> {
  await requireWarehouseStaff(CARRIERS_PATH);
  if (!uuid(id)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (decision === 'reject' && !reason.trim()) return { ok: false, error: 'Enter why the rules are rejected.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_decide_carrier_rules', { p_id: id, p_decision: decision, p_reason: reason.trim() || null });
  if (error) return fail(error.message);
  const d = data as { version: number };
  return done(decision === 'approve' ? `Version ${d.version} approved. New labels use these rules now.` : `Version ${d.version} rejected.`, [CARRIERS_PATH, DISPATCH]);
}

// ───────── labels ─────────
type Plan = {
  ok: boolean; message?: string; parcel_id: string; seq: number; parcels: number; order_id: string; order_code: string; reference: string; warehouse_code: string;
  weight_g: number | null; dg: string[]; service_id: string; service_code: string; service_name: string; carrier: Carrier; account_id: string; account_name: string;
  mode: 'sandbox' | 'live'; credential_env: string | null; rule_version_id: string | null; reason: string;
  ship_to: { name: string; phone: string | null; address: Record<string, unknown> | null; country: string };
  ship_from: { name: string; city: string; province: string | null; country: string; address: string | null; phone: string | null };
  items: { sku: string; name: string; qty: number; unit_weight_g: number | null }[];
  /** C0: the customs check of this parcel (wh_customs_check; the plan is refused when a Dropship parcel fails it) */
  customs?: {
    scope: 'dropship' | 'client_order' | 'domestic'; declared_usd_cents: number | null; duty_type: 'DDP' | 'DAP' | null;
    items: { sku: string; description_en: string; hs_code: string | null; qty: number; unit_value_cents: number | null; value_cents: number | null;
      origin_country: string | null; unit_weight_g: number | null; battery: boolean; liquid: boolean; magnet: boolean }[];
  };
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const labelCustoms = (c: Plan['customs']): LabelCustoms | null => (c ? {
  scope: c.scope, currency: 'USD', declaredValueCents: c.declared_usd_cents, dutyType: c.duty_type,
  items: c.items.map((i) => ({ sku: i.sku, descriptionEn: i.description_en, hsCode: i.hs_code, qty: i.qty, unitValueCents: i.unit_value_cents, valueCents: i.value_cents,
    originCountry: i.origin_country, unitWeightG: i.unit_weight_g, battery: i.battery, liquid: i.liquid, magnet: i.magnet })),
} : null);

/** Rules choose the service → the account's adapter makes the label → PDF to the private bucket → the database records it. */
export async function createLabelAction(parcelId: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(parcelId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { data: planData, error: planErr } = await sb.rpc('wh_label_plan', { p_parcel: parcelId });
  if (planErr) return fail(planErr.message);
  const plan = planData as Plan;
  if (!plan.ok) {
    for (const p of [DISPATCH, '/office/warehouse/exceptions']) revalidatePath(p);
    return { ok: false, error: plan.message ?? 'No carrier service can take this parcel.' };
  }
  const a = plan.ship_to.address ?? {};
  let label: { trackingNo: string; pdf: Uint8Array };
  const adapterRef = { carrier: plan.carrier, mode: plan.mode, credentialEnv: plan.credential_env };
  try {
    const adapter = getCarrierAdapter(adapterRef);
    label = await adapter.createLabel({
      orderCode: plan.order_code, reference: plan.reference, parcelSeq: plan.seq, parcelCount: plan.parcels, weightG: plan.weight_g,
      serviceCode: plan.service_code, serviceName: plan.service_name, dangerousGoods: plan.dg,
      shipTo: {
        name: plan.ship_to.name, phone: plan.ship_to.phone, country: plan.ship_to.country,
        line1: str(a.line1) ?? str(a.address1), line2: str(a.line2) ?? str(a.address2), city: str(a.city),
        region: str(a.region) ?? str(a.state) ?? str(a.province), postcode: str(a.postcode) ?? str(a.zip) ?? str(a.postal_code),
      },
      shipFrom: plan.ship_from,
      items: plan.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitWeightG: i.unit_weight_g })),
      customs: labelCustoms(plan.customs),
    });
  } catch (e) {
    const why = e instanceof CarrierError ? e.message : 'The carrier could not make the label. Try again.';
    // CONN S5: a refused label shows in System health (carrier failures); never a key
    await sb.rpc('c5_carrier_error_record', { p_account: plan.account_id, p_message: why }).then(() => undefined, () => undefined);
    return { ok: false, error: why };
  }
  const path = labelPath(plan.warehouse_code, plan.order_code, plan.seq, label.trackingNo.toUpperCase());
  const up = await sb.storage.from('wh-labels').upload(path, label.pdf, { contentType: 'application/pdf', upsert: false });
  if (up.error) return { ok: false, error: `The label PDF could not be saved (${up.error.message}).` };
  const { data, error } = await sb.rpc('wh_label_record', {
    p_parcel: parcelId, p_service: plan.service_id, p_rule_version: plan.rule_version_id, p_tracking_no: label.trackingNo, p_label_path: path, p_reason: plan.reason,
  });
  if (error) {
    if (plan.mode === 'live') await getCarrierAdapter(adapterRef).cancelLabel(label.trackingNo).catch(() => undefined);
    return fail(error.message);
  }
  const d = data as { tracking_no: string; sandbox: boolean; order_status: string; service_name: string; parcel: number };
  return done(`${d.sandbox ? 'SANDBOX label' : 'Label'} ${d.tracking_no} made for ${plan.order_code} parcel ${d.parcel} with ${d.service_name} (${plan.reason}). Print it, stick it on and scan it at Label check.`,
    [DISPATCH, LABELS], d, plan.order_code);
}

export async function confirmLabelAction(orderCode: string, scan: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!/^WO-\d{6,}$/i.test(orderCode.trim())) return { ok: false, error: 'Scan or type the order number (WO-…).' };
  if (!scan.trim()) return { ok: false, error: 'Scan the label on the parcel.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_label_confirm', { p_order_code: orderCode.trim().toUpperCase(), p_scan: scan.trim() });
  if (error) return fail(error.message);
  const d = data as { ok: boolean; message: string; result: string };
  for (const p of [DISPATCH, LABELS, '/office/warehouse/exceptions']) revalidatePath(p);
  return d.ok ? { ok: true, message: d.message, data: d } : { ok: false, error: d.message, data: d };
}

export async function voidLabelAction(shipmentId: string, reason: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(shipmentId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!reason.trim()) return { ok: false, error: 'Enter why the label is voided.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_label_void', { p_shipment: shipmentId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  const d = data as { tracking_no: string; order_code: string; carrier: Carrier; account_id: string; sandbox: boolean };
  let note = '';
  if (!d.sandbox) {
    const { data: acc } = await sb.from('wh_carrier_accounts').select('carrier, mode, credential_env').eq('id', d.account_id).maybeSingle();
    const cancelled = acc
      ? await getCarrierAdapter({ carrier: acc.carrier as Carrier, mode: acc.mode as 'live', credentialEnv: acc.credential_env }).cancelLabel(d.tracking_no).then(() => true, () => false)
      : false;
    note = cancelled ? ' The carrier was told.' : ' Tell the carrier too: the cancellation did not go through.';
  }
  return done(`Label ${d.tracking_no} voided. Take it off the parcel and make a new one.${note}`, [DISPATCH, LABELS], d, d.order_code);
}

export async function logLabelPrintAction(shipmentId: string): Promise<W4Result> {
  await requireWarehouseStaff(LABELS);
  if (!uuid(shipmentId)) return { ok: false, error: 'Not found.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_label_printed', { p_shipment: shipmentId });
  if (error) return fail(error.message);
  revalidatePath(LABELS);
  return { ok: true, message: 'Print logged.' };
}

// ───────── dispatch batches ─────────
export async function openDispatchAction(accountId: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(accountId)) return { ok: false, error: 'Choose the carrier account.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dispatch_open', { p_account: accountId });
  if (error) return fail(error.message);
  const d = data as { code: string; existing: boolean };
  return done(d.existing ? `${d.code} is already open for this account.` : `${d.code} started. Scan the checked labels into it.`, [DISPATCH], d);
}

export async function dispatchScanAction(dispatchId: string, scan: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(dispatchId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!scan.trim()) return { ok: false, error: 'Scan a label.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dispatch_scan', { p_dispatch: dispatchId, p_scan: scan.trim() });
  if (error) return fail(error.message);
  const d = data as { ok: boolean; message: string };
  if (!d.ok) return { ok: false, error: d.message };
  return done(d.message, [DISPATCH], d);
}

export async function dispatchRemoveAction(dispatchId: string, shipmentId: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(dispatchId) || !uuid(shipmentId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_dispatch_remove', { p_dispatch: dispatchId, p_shipment: shipmentId });
  if (error) return fail(error.message);
  return done('Taken out of the batch.', [DISPATCH]);
}

export async function closeDispatchAction(dispatchId: string, handedTo: string, manifestNo: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(dispatchId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!handedTo.trim()) return { ok: false, error: 'Enter who took the parcels (driver or pickup reference).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dispatch_close', { p_dispatch: dispatchId, p_handed_to: handedTo.trim(), p_manifest_no: manifestNo.trim() || null });
  if (error) return fail(error.message);
  const d = data as { code: string; parcels: number; orders_shipped: number; manifest_no: string };
  return done(`${d.code} handed over: ${d.parcels} parcel${d.parcels === 1 ? '' : 's'}, manifest ${d.manifest_no}. ${d.orders_shipped} order${d.orders_shipped === 1 ? '' : 's'} shipped.`,
    [DISPATCH, LABELS, ORDERS], d);
}

export async function cancelDispatchAction(dispatchId: string, reason: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(dispatchId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!reason.trim()) return { ok: false, error: 'Enter why the batch is cancelled.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_dispatch_cancel', { p_dispatch: dispatchId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done('Batch cancelled; its labels are ready for another batch.', [DISPATCH]);
}

// ───────── freight pallets ─────────
export async function freightCreateAction(warehouse: string, destination: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!destination.trim()) return { ok: false, error: 'Enter where the pallet goes.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_freight_create', { p_warehouse: warehouse, p_destination: destination.trim() });
  if (error) return fail(error.message);
  const d = data as { code: string };
  return done(`${d.code} started. Scan the orders that go on it.`, [DISPATCH], d);
}

export async function freightAddAction(palletId: string, orderCode: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!/^WO-\d{6,}$/i.test(orderCode.trim())) return { ok: false, error: 'Scan or type the order number (WO-…).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_freight_add', { p_pallet: palletId, p_order_code: orderCode.trim().toUpperCase() });
  if (error) return fail(error.message);
  const d = data as { order_code: string; parcels: number; pallet: string };
  return done(`${d.order_code} (${d.parcels} parcel${d.parcels === 1 ? '' : 's'}) is on ${d.pallet}.`, [DISPATCH], d, d.order_code);
}

export async function freightRemoveAction(palletId: string, orderId: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId) || !uuid(orderId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_freight_remove', { p_pallet: palletId, p_order: orderId });
  if (error) return fail(error.message);
  return done('Order taken off the pallet.', [DISPATCH]);
}

export async function freightCloseAction(palletId: string, f: { grossKg: string; lengthCm: string; widthCm: string; heightCm: string }): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const kgv = Number(f.grossKg.replace(',', '.'));
  const grams = Math.round(kgv * 1000);
  if (!f.grossKg.trim() || !Number.isFinite(kgv) || !whole(grams, 1, 5_000_000)) return { ok: false, error: 'Weigh the pallet: gross weight in kg (up to 5,000).' };
  const mm = [f.lengthCm, f.widthCm, f.heightCm].map((v) => Math.round(Number(v.replace(',', '.')) * 10));
  if (mm.some((v) => !whole(v, 1, 5000))) return { ok: false, error: 'Measure the pallet: length, width and height in cm (up to 500).' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_freight_close', { p_pallet: palletId, p_gross_g: grams, p_length_mm: mm[0], p_width_mm: mm[1], p_height_mm: mm[2] });
  if (error) return fail(error.message);
  const d = data as { code: string };
  return done(`${d.code} closed. Print its pallet label, then dispatch it.`, [DISPATCH], d);
}

export async function freightReopenAction(palletId: string, reason: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!reason.trim()) return { ok: false, error: 'Enter why the pallet is reopened.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_freight_reopen', { p_pallet: palletId, p_reason: reason.trim() });
  if (error) return fail(error.message);
  return done('Pallet reopened.', [DISPATCH]);
}

export async function freightDispatchAction(palletId: string, forwarder: string, reference: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  if (!forwarder.trim()) return { ok: false, error: 'Enter the freight forwarder.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_freight_dispatch', { p_pallet: palletId, p_forwarder: forwarder.trim(), p_reference: reference.trim() || null });
  if (error) return fail(error.message);
  const d = data as { code: string; orders_shipped: number };
  return done(`${d.code} dispatched. ${d.orders_shipped} order${d.orders_shipped === 1 ? '' : 's'} shipped.`, [DISPATCH, ORDERS], d);
}

export async function freightLabelPrintedAction(palletId: string, copies: number): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!uuid(palletId)) return { ok: false, error: 'Not found.' };
  if (!whole(copies, 1, 20)) return { ok: false, error: 'Print 1 to 20 copies.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_freight_label_printed', { p_pallet: palletId, p_copies: copies });
  if (error) return fail(error.message);
  revalidatePath(DISPATCH);
  return { ok: true, message: 'Print logged.' };
}

// ───────── tracking ─────────
export async function addTrackingEventAction(f: { shipmentId: string | null; palletId: string | null; status: string; description: string; location: string }): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (!(TRACKING_STATUSES as readonly string[]).includes(f.status)) return { ok: false, error: 'Choose what happened.' };
  const d = f.description.trim();
  if (d.length < 3 || d.length > 300) return { ok: false, error: 'Write what the customer reads (3 to 300 characters).' };
  if (!(uuid(f.shipmentId) || uuid(f.palletId))) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_tracking_add', {
    p_shipment: uuid(f.shipmentId) ? f.shipmentId : null, p_pallet: uuid(f.palletId) ? f.palletId : null, p_status: f.status, p_description: d,
    p_location: f.location.trim() || null, p_occurred_at: null,
  });
  if (error) return fail(error.message);
  return done('Tracking updated. The customer sees it on the tracking page.', [DISPATCH]);
}

export async function sandboxNextEventAction(shipmentId: string): Promise<W4Result> {
  await requireWarehouseStaff(DISPATCH);
  if (process.env.APP_ENVIRONMENT !== 'staging') return { ok: false, error: 'Sandbox tracking exists only on staging.' };
  if (!uuid(shipmentId)) return { ok: false, error: 'Not found. Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_tracking_sandbox_next', { p_shipment: shipmentId });
  if (error) return fail(error.message);
  const d = data as { description: string };
  return done(`Sandbox event added: ${d.description}.`, [DISPATCH]);
}
