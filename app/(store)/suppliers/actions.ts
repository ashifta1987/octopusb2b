'use server';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { getEmail } from '@/lib/adapters';
import { getSiteContent } from '@/lib/content';
import { SITE_URL } from '@/components/store/seo';
import { supplierApplySchema, SHEET_EXT, SHEET_MAX_BYTES, type SupplierApplyValues } from '@/lib/supplier-apply/schema';

/** ADDON-36 C5 — public supplier applications. Rate-limited per IP / email; product sheet via a signed upload URL. */

async function clientInfo() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  return { ip, country: (h.get('x-vercel-ip-country') ?? '').toUpperCase() || null };
}

/** Fixed-window limiter (auth_rate_hit). Fails open if the limiter is unavailable, like sign-in. */
async function limited(bucket: string, limit: number, windowS: number) {
  try {
    const { data } = await createAdminClient().rpc('auth_rate_hit', { p_bucket: bucket, p_limit: limit, p_window_s: windowS });
    const r = data as { allowed: boolean; retry_after_s: number } | null;
    return r && !r.allowed ? r.retry_after_s : null;
  } catch { return null; }
}
const wait = (s: number) => (s > 3600 ? `${Math.ceil(s / 3600)} hours` : s > 60 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function createSheetUpload(file: { name: string; size: number }): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!SHEET_EXT.test(file.name)) return { ok: false, error: 'Product sheets must be PDF, Excel, CSV, JPG or PNG.' };
  if (!(file.size > 0 && file.size <= SHEET_MAX_BYTES)) return { ok: false, error: 'Product sheets can be up to 20 MB.' };
  const { ip } = await clientInfo();
  if (ip) { const s = await limited(`sa-upload:${ip}`, 10, 3600); if (s) return { ok: false, error: `Too many uploads from your network. Try again in ${wait(s)}.` }; }
  const safe = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `pending/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await createAdminClient().storage.from('supplier-applications').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: 'Upload is unavailable right now. Submit without the file and email it to us afterwards.' };
  return { ok: true, path: data.path, token: data.token };
}

export async function submitSupplierApplication(values: SupplierApplyValues): Promise<{ ok: true; reference: string } | { ok: false; error: string; field?: string }> {
  const parsed = supplierApplySchema.safeParse(values);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i?.message ?? 'Please check the form.', field: i?.path?.[0] as string | undefined };
  }
  const v = parsed.data;
  const { ip, country } = await clientInfo();
  const a = ip ? await limited(`sa-ip:${ip}`, 3, 86400) : null;
  const b = await limited(`sa-email:${v.contact_email.toLowerCase()}`, 2, 86400);
  if (a || b) return { ok: false, error: `You've already applied today. Try again in ${wait((a ?? b)!)}, or message us on WhatsApp.` };

  const admin = createAdminClient();
  if (v.product_sheet_path) {
    if (!/^pending\/[0-9a-f-]{36}\/[\w.-]+$/.test(v.product_sheet_path)) return { ok: false, error: 'The product sheet upload is invalid. Please attach it again.', field: 'product_sheet_path' };
    const [dir, name] = [v.product_sheet_path.split('/').slice(0, 2).join('/'), v.product_sheet_path.split('/')[2]];
    const { data: found } = await admin.storage.from('supplier-applications').list(dir, { search: name });
    if (!found?.some((f) => f.name === name)) return { ok: false, error: 'The product sheet did not finish uploading. Please attach it again.', field: 'product_sheet_path' };
  }
  const { data, error } = await admin.rpc('submit_supplier_application', { p: { ...v, ip_country: country } });
  if (error) {
    console.error('submit_supplier_application failed', error.message);
    return { ok: false, error: 'Could not send your application. Please try again, or message us on WhatsApp.' };
  }
  const r = data as { id: string; reference: string };
  await sendEmails(r, v).catch((e) => console.error('supplier application email failed', e)); // the application is saved either way
  return { ok: true, reference: r.reference };
}

async function sendEmails(r: { id: string; reference: string }, v: ReturnType<typeof supplierApplySchema.parse>) {
  const mail = getEmail();
  await mail.send({
    to: v.contact_email,
    subject: `Octopus B2B · supplier application received (${r.reference})`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11133C;line-height:1.5">
      <p>Hello ${esc(v.contact_name)},</p>
      <p>Thank you for applying to sell on Octopus B2B. Your reference is <b>${r.reference}</b>.</p>
      <p>Our supplier team checks your business licence and product range, usually within 3 working days, and will contact you about a factory audit and onboarding.</p>
      <p>— Octopus B2B supplier team</p></div>`,
  }, { template: 'supplier_application.applicant' });
  const { company } = await getSiteContent();
  if (company?.email) {
    await mail.send({
      to: company.email,
      subject: `New supplier application: ${v.company_name} (${v.city}) · ${r.reference}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11133C">
        <p>${esc(v.company_name)} (${esc(v.city)}) applied to sell on Octopus B2B. Categories: ${esc(v.categories.join(', '))}.</p>
        <p><a href="${SITE_URL}/office/kyc/supplier/${r.id}">Review the application</a></p></div>`,
    }, { template: 'supplier_application.staff' });
  }
}
