'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { DOC_MAX_BYTES, detectDocType } from '@/lib/dropship-ds14-shared';

/**
 * Release 6 · Step 14 staff server actions (Approvals, Suppliers, Sales partners, Docs). Every action re-checks the staff session
 * (2FA, Dropship division edit) and calls ONE definer RPC that checks the permission again and writes the audit row.
 */
export type StaffResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; message: string };
const Uuid = z.string().uuid();

async function run<T = undefined>(path: string, fn: string, args: Record<string, unknown>, paths: string[] = []): Promise<StaffResult<T>> {
  await requireDropshipV2Staff(true, path);
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error) };
  for (const p of [path, ...paths]) revalidatePath(p);
  return { ok: true, data: data as T };
}

// ───────── Approvals ─────────
const Checks = z.object({ images_clean: z.boolean(), ids_unique: z.boolean(), hs_ok: z.boolean(), size_ok: z.boolean(), flags_ok: z.boolean(), cost_ok: z.boolean() }).partial();
export async function decideApprovalAction(id: string, action: 'approve' | 'changes' | 'reject', note: string, checks: Record<string, boolean>): Promise<StaffResult<{ status: string; product_ids: string[] }>> {
  const p = z.object({ id: Uuid, action: z.enum(['approve', 'changes', 'reject']), note: z.string().max(1000), checks: Checks }).safeParse({ id, action, note, checks });
  if (!p.success) return { ok: false, message: 'Check the decision and the note.' };
  return run<{ status: string; product_ids: string[] }>('/office/dropship/approvals', 'ds_staff_approval_decide', { p_id: p.data.id, p_action: p.data.action, p_note: p.data.note, p_checks: p.data.checks }, ['/office/dropship']);
}
export async function saveRulesAction(priceAutoPct: number | null, shipWithinDays: number | null): Promise<StaffResult> {
  const p = z.object({ a: z.number().int().min(0).max(50).nullable(), d: z.number().int().min(1).max(60).nullable() }).safeParse({ a: priceAutoPct, d: shipWithinDays });
  if (!p.success) return { ok: false, message: 'Auto-approve: 0 to 50 percent. Ship within: 1 to 60 days. Leave a field empty to switch the rule off.' };
  return run('/office/dropship/approvals', 'ds_staff_rules_save', { p_price_auto_pct: p.data.a, p_ship_within_days: p.data.d });
}

// ───────── Suppliers and partner orders ─────────
export async function assignPartnerAction(soId: string): Promise<StaffResult> {
  if (!Uuid.safeParse(soId).success) return { ok: false, message: 'Order not found.' };
  return run('/office/dropship/suppliers', 'ds_partner_assign', { p_so: soId }, ['/supplier/orders']);
}
export async function cancelPartnerOrderAction(id: string, reason: string): Promise<StaffResult> {
  const p = z.object({ id: Uuid, reason: z.string().trim().min(3).max(500) }).safeParse({ id, reason });
  if (!p.success) return { ok: false, message: 'Write why you take this order back (3 to 500 characters).' };
  return run('/office/dropship/suppliers', 'ds_partner_order_cancel', { p_id: p.data.id, p_reason: p.data.reason }, ['/supplier/orders']);
}

/** A supplier's portal account: the login is invited by email with the service role, then linked by the definer RPC (suppliers:edit). */
export async function createSupplierAccountAction(supplierId: string, email: string): Promise<StaffResult> {
  const access = await requireDropshipV2Staff(true, '/office/dropship/suppliers');
  if (!can(access.session, 'suppliers', 'edit')) return { ok: false, message: 'You do not have permission to create supplier accounts.' };
  const p = z.object({ id: Uuid, email: z.string().trim().toLowerCase().email().max(200) }).safeParse({ id: supplierId, email });
  if (!p.success) return { ok: false, message: 'Enter the supplier contact email address.' };
  const admin = createAdminClient();
  const pattern = p.data.email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', pattern).limit(1).maybeSingle();
  if (existing) return { ok: false, message: 'This email already has an Octopus login. Use a separate email address for the supplier account.' };
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const { data: inv, error: ie } = await admin.auth.admin.inviteUserByEmail(p.data.email, { redirectTo: `${base}/reset-password`, data: { supplier: true } });
  if (ie || !inv.user) return { ok: false, message: ie?.message ?? 'The invitation could not be sent.' };
  await admin.from('profiles').upsert({ id: inv.user.id, full_name: 'Supplier', email: p.data.email });
  const sb = await createClient();
  const { error } = await sb.rpc('ds_supplier_link_user', { p_supplier: p.data.id, p_user: inv.user.id });
  if (error) { await admin.auth.admin.deleteUser(inv.user.id); return { ok: false, message: rpcMessage(error) }; }
  revalidatePath('/office/dropship/suppliers');
  return { ok: true, data: undefined, message: `Invitation sent to ${p.data.email}. The supplier sets a password from the email, then opens the supplier portal.` };
}

// ───────── Sales partners ─────────
export async function invitePartnerAction(input: { name: string; kind: string; contact_name: string; contact_email: string; note: string }): Promise<StaffResult<{ id: string; code: string }>> {
  const p = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['agency', 'influencer', 'other']), contact_name: z.string().trim().max(120), contact_email: z.string().trim().email().max(200), note: z.string().trim().max(500) }).safeParse(input);
  if (!p.success) return { ok: false, message: 'Check the name (2 to 120 characters), the type and the email address.' };
  return run<{ id: string; code: string }>('/office/dropship/partners', 'ds_partner_invite', { p: p.data });
}
export async function setPartnerStatusAction(id: string, status: 'active' | 'paused' | 'ended'): Promise<StaffResult> {
  const p = z.object({ id: Uuid, status: z.enum(['active', 'paused', 'ended']) }).safeParse({ id, status });
  if (!p.success) return { ok: false, message: 'Partner not found.' };
  return run('/office/dropship/partners', 'ds_partner_set_status', { p_id: p.data.id, p_status: p.data.status });
}
export async function attachMerchantAction(partnerId: string, orgId: string): Promise<StaffResult> {
  const p = z.object({ a: Uuid, b: Uuid }).safeParse({ a: partnerId, b: orgId });
  if (!p.success) return { ok: false, message: 'Choose a partner and a merchant.' };
  return run('/office/dropship/partners', 'ds_partner_attach', { p_partner: p.data.a, p_org: p.data.b });
}
export async function saveRuleAction(partnerId: string | null, rule: { kind: 'percent_of_plan_fee' | 'fixed_per_merchant'; percent: string; fixed: string; months: string }): Promise<StaffResult> {
  const p = z.object({ id: Uuid.nullable(), kind: z.enum(['percent_of_plan_fee', 'fixed_per_merchant']), months: z.string().regex(/^\d{1,2}$/) }).safeParse({ id: partnerId, kind: rule.kind, months: rule.months.trim() });
  if (!p.success) return { ok: false, message: 'Paid for how many months: enter 1 to 60.' };
  const bps = rule.kind === 'percent_of_plan_fee' && /^\d{1,3}(\.\d{1,2})?$/.test(rule.percent.trim()) ? Math.round(Number(rule.percent) * 100) : null;
  const cents = rule.kind === 'fixed_per_merchant' && /^\d{1,6}(\.\d{1,2})?$/.test(rule.fixed.trim()) ? Math.round(Number(rule.fixed) * 100) : null;
  if (rule.kind === 'percent_of_plan_fee' && bps == null) return { ok: false, message: 'Rate: enter a percent like 12.5.' };
  if (rule.kind === 'fixed_per_merchant' && cents == null) return { ok: false, message: 'Fixed amount: enter dollars like 25.00.' };
  return run('/office/dropship/partners', 'ds_partner_rule_save', { p_partner: p.data.id, p: { kind: p.data.kind, rate_bps: bps, fixed_cents: cents, months: Number(p.data.months) } });
}

// ───────── Docs ─────────
/** Upload to the private bucket under a random name (the real file name and type are never trusted), then register through the RPC. */
export async function uploadDocAction(fd: FormData): Promise<StaffResult<{ id: string }>> {
  await requireDropshipV2Staff(true, '/office/dropship/docs');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a PDF, PNG or JPG file.' };
  if (file.size > DOC_MAX_BYTES) return { ok: false, message: 'The file is larger than 10 MB.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectDocType(bytes);
  if (!type) return { ok: false, message: 'Only PDF, PNG and JPG files are accepted (the file content must match).' };
  const meta = z.object({
    kind: z.enum(['certificate', 'test_report', 'hs_document', 'msds', 'other']), title: z.string().trim().min(2).max(160), doc_number: z.string().trim().max(80), issuer: z.string().trim().max(120),
    expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')), product_id: Uuid.or(z.literal('')),
  }).safeParse(Object.fromEntries(['kind', 'title', 'doc_number', 'issuer', 'expires_on', 'product_id'].map((k) => [k, String(fd.get(k) ?? '')])));
  if (!meta.success) return { ok: false, message: 'Check the title, the type and the expiry date.' };
  const path = `${randomBytes(16).toString('hex')}.${type.ext}`;
  const admin = createAdminClient();
  const up = await admin.storage.from('dropship-documents').upload(path, bytes, { contentType: type.mime, upsert: false });
  if (up.error) return { ok: false, message: 'The file could not be stored. Try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('ds_doc_register', { p: { ...meta.data, expires_on: meta.data.expires_on || null, product_id: meta.data.product_id || null, storage_path: path, mime: type.mime, size_bytes: bytes.length } });
  if (error) { await admin.storage.from('dropship-documents').remove([path]); return { ok: false, message: rpcMessage(error) }; }
  revalidatePath('/office/dropship/docs');
  return { ok: true, data: data as { id: string }, message: 'Document added.' };
}
export async function linkDocAction(docId: string, productId: string | null): Promise<StaffResult> {
  const p = z.object({ d: Uuid, p: Uuid.nullable() }).safeParse({ d: docId, p: productId });
  if (!p.success) return { ok: false, message: 'Choose a document and a product.' };
  return run('/office/dropship/docs', 'ds_doc_link', { p_doc: p.data.d, p_product: p.data.p });
}
export async function docStatusAction(docId: string, status: 'pending' | 'verified' | 'rejected', note: string): Promise<StaffResult> {
  const p = z.object({ d: Uuid, s: z.enum(['pending', 'verified', 'rejected']), n: z.string().trim().max(500) }).safeParse({ d: docId, s: status, n: note });
  if (!p.success) return { ok: false, message: 'Check the status and the note.' };
  return run('/office/dropship/docs', 'ds_doc_set_status', { p_doc: p.data.d, p_status: p.data.s, p_note: p.data.n || null });
}
