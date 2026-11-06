'use server';
import { headers } from 'next/headers';
import { revalidateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { getEmail } from '@/lib/adapters';
import { SITE_URL } from '@/components/store/seo';
import { leadSchema, FLOOR_PLAN_EXT, FLOOR_PLAN_MAX_BYTES, type LeadValues } from '@/lib/turnkey/schema';

/** Turnkey Projects server actions (ADDON-31): floor-plan upload URL, lead submit (rate-limited, routed), atlas signals. */

async function clientInfo() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const country = (h.get('x-vercel-ip-country') ?? '').toUpperCase() || null;
  return { ip, country };
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

export async function createFloorPlanUpload(file: { name: string; size: number }): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!FLOOR_PLAN_EXT.test(file.name)) return { ok: false, error: 'Floor plans must be PDF, DWG, JPG or PNG.' };
  if (!(file.size > 0 && file.size <= FLOOR_PLAN_MAX_BYTES)) return { ok: false, error: 'Floor plans can be up to 20 MB.' };
  const { ip } = await clientInfo();
  if (ip) { const s = await limited(`tk-upload:${ip}`, 10, 3600); if (s) return { ok: false, error: `Too many uploads from your network. Try again in ${wait(s)}.` }; }
  const safe = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `pending/${crypto.randomUUID()}/${safe}`;
  const { data, error } = await createAdminClient().storage.from('turnkey-floorplans').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: 'Upload is unavailable right now — send the floor plan by email after submitting.' };
  return { ok: true, path: data.path, token: data.token };
}

export async function submitTurnkeyLead(values: LeadValues): Promise<{ ok: true; leadId: string; reference: string } | { ok: false; error: string; field?: string }> {
  const parsed = leadSchema.safeParse(values);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i?.message ?? 'Please check the form.', field: i?.path?.[0] as string | undefined };
  }
  const v = parsed.data;
  const { ip } = await clientInfo();
  // ADDON-31 §11: interest 5 / IP / day and 3 / email / day; quote 2 / IP / hour
  if (v.kind === 'interest') {
    const a = ip ? await limited(`tk-interest-ip:${ip}`, 5, 86400) : null;
    const b = await limited(`tk-interest-email:${v.email.toLowerCase()}`, 3, 86400);
    if (a || b) return { ok: false, error: `You've registered interest several times today. Try again in ${wait((a ?? b)!)}, or WhatsApp us.` };
  } else if (ip) {
    const s = await limited(`tk-quote-ip:${ip}`, 2, 3600);
    if (s) return { ok: false, error: `Too many quote requests from your network. Try again in ${wait(s)}, or WhatsApp us.` };
  }
  const admin = createAdminClient();
  if (v.floor_plan_path) {
    if (!/^pending\/[0-9a-f-]{36}\/[\w.-]+$/.test(v.floor_plan_path)) return { ok: false, error: 'The floor plan upload is invalid — please attach it again.', field: 'floor_plan_path' };
    const [dir, name] = [v.floor_plan_path.split('/').slice(0, 2).join('/'), v.floor_plan_path.split('/')[2]];
    const { data: found } = await admin.storage.from('turnkey-floorplans').list(dir, { search: name });
    if (!found?.some((f) => f.name === name)) return { ok: false, error: 'The floor plan did not finish uploading — please attach it again.', field: 'floor_plan_path' };
  }
  const s = await getSession().catch(() => null);
  const { data, error } = await admin.rpc('submit_turnkey_lead', {
    p: { ...v, buyer_user_id: s && !s.isStaff ? s.userId : null, org_id: s && !s.isStaff ? s.org?.id ?? null : null, floor_plan_path: v.floor_plan_path || null },
  });
  if (error) {
    if (/TURNKEY_NOT_LIVE/.test(error.message)) return { ok: false, error: 'This project is open for register-interest only.' };
    if (/TURNKEY_(PROJECT|PACKAGE)_NOT_FOUND/.test(error.message)) return { ok: false, error: 'This project or package is no longer available.' };
    return { ok: false, error: 'Could not send your request. Please try again or WhatsApp us.' };
  }
  const r = data as { lead_id: string; reference: string; assigned_to: string | null };
  revalidateTag('turnkey-leads', 'max');
  await sendLeadEmails(r, v).catch(() => undefined); // email failures never lose the lead (logged in email_deliveries)
  return { ok: true, leadId: r.lead_id, reference: r.reference };
}

async function sendLeadEmails(r: { lead_id: string; reference: string; assigned_to: string | null }, v: ReturnType<typeof leadSchema.parse>) {
  const admin = createAdminClient();
  const { data: proj } = await admin.from('turnkey_projects').select('title').eq('project_id', v.project_id).maybeSingle();
  const title = (proj?.title as string) ?? v.project_id;
  const what = v.kind === 'quote' ? 'quote request' : 'interest';
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const mail = getEmail();
  await mail.send({
    to: v.email,
    subject: `Octopus B2B · ${title} — ${what} received (${r.reference})`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11133C;line-height:1.5">
      <p>Hello ${esc(v.contact_name)},</p>
      <p>Thank you — we received your ${what} for <b>${esc(title)}</b>. Your reference is <b>${r.reference}</b>.</p>
      <p>${v.kind === 'quote' ? 'A sourcing lead will reply within 24 hours with a USD quote and Incoterm. A sample quote follows within 5 days; we schedule QC once the PO is signed.' : 'Packages for this project go live once enough buyers register interest. We will contact you as soon as it is ready, usually with a first rough quote.'}</p>
      <p><a href="${SITE_URL}/turnkey/confirmation/${r.lead_id}">View your request</a></p>
      <p>— Octopus B2B Turnkey Projects</p></div>`,
  }, { template: `turnkey.${v.kind}.buyer` });
  if (r.assigned_to) {
    const { data: staff } = await admin.from('profiles').select('email').eq('id', r.assigned_to).maybeSingle();
    if (staff?.email) {
      await mail.send({
        to: staff.email as string,
        subject: `New turnkey ${what}: ${title} · ${v.company_name} (${v.country}) · ${r.reference}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#11133C">
          <p>${esc(v.company_name)} (${v.country}) sent a ${what} for <b>${esc(title)}</b>. It is assigned to you.</p>
          <p><a href="${SITE_URL}/admin/turnkey?lead=${r.lead_id}">Open the lead</a></p></div>`,
      }, { template: `turnkey.${v.kind}.staff` });
    }
  }
}

/** Atlas analytics (views, hub taps). Best-effort; rate-limited per IP. */
export async function logTurnkeySignal(event: 'view' | 'tap_hub', projectId: string | null, hubId: string | null) {
  if (!['view', 'tap_hub'].includes(event)) return;
  if (projectId && !/^[a-z0-9-]{2,60}$/.test(projectId)) return;
  if (hubId && !/^CN-[A-Z]{2}-[A-Z]{2,4}$/.test(hubId)) return;
  const { ip, country } = await clientInfo();
  if (ip && (await limited(`tk-signal:${ip}`, 60, 60))) return;
  await createAdminClient().rpc('log_turnkey_signal', { p_event: event, p_project: projectId, p_hub: hubId, p_country: country }).then(() => undefined, () => undefined);
}

