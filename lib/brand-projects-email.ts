import 'server-only';
import { getEmail } from '@/lib/adapters';
import { createAdminClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';
import { BRAND_METHOD, BRAND_PACK, brandDestination } from '@/lib/brand-projects';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * One e-mail per new brand project to the admin address in settings (bug 2, 8 Nov 2026) — the same address the other
 * admin alerts use: Backup settings › alert e-mail, else the company e-mail. Sent at most once: the project row is
 * claimed first (admin_emailed_at), so a retry or a double call never sends a second mail. Never throws.
 */
export async function sendBrandProjectAdminEmail(projectId: string): Promise<'sent' | 'skipped' | 'no_address' | 'failed'> {
  try {
    const sb = createAdminClient();
    const { data: claimed } = await sb.from('brand_projects').update({ admin_emailed_at: new Date().toISOString() })
      .eq('id', projectId).is('admin_emailed_at', null).select('id, ref, org_id, quantity, method, packaging, stock_destination, bulk_country, product_link, product_id').maybeSingle();
    if (!claimed) return 'skipped';
    const [{ data: bs }, { data: company }, { data: org }, { data: mgr }, { data: prod }] = await Promise.all([
      sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle(),
      sb.from('company_profile').select('email').limit(1).maybeSingle(),
      sb.from('organizations').select('name').eq('id', claimed.org_id).maybeSingle(),
      sb.from('account_managers').select('staff_user_id').eq('org_id', claimed.org_id).eq('is_primary', true).maybeSingle(),
      claimed.product_id ? sb.from('products').select('title').eq('id', claimed.product_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const to = ((bs?.value as { alert_email?: string } | null)?.alert_email || (company?.email as string | null) || '').trim();
    if (!to) return 'no_address';
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
    const needs = !mgr;
    const title = `New brand project ${claimed.ref}${needs ? ' — needs an account manager' : ''}`;
    const lines = [
      ['Customer', org?.name], ['Product', (prod as { title?: string } | null)?.title ?? claimed.product_link],
      ['Quantity', claimed.quantity ? `${claimed.quantity} units` : 'not given'],
      ['Branding · packaging', [BRAND_METHOD[claimed.method ?? ''], BRAND_PACK[claimed.packaging ?? '']].filter(Boolean).join(' · ')],
      ['Stock goes to', brandDestination(claimed)],
    ];
    await getEmail().send({
      to,
      subject: `[Octopus B2B] ${title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:${BRAND.black}">
  <h2 style="color:${BRAND.ink};font-size:18px;margin:16px 0 8px">${esc(title)}</h2>
  <table style="font-size:14px;border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:${BRAND.muted}">${esc(k)}</td><td style="padding:4px 0">${esc(v || '—')}</td></tr>`).join('')}</table>
  <p><a href="${esc(`${site}/admin/brand-projects/${claimed.id}`)}" style="display:inline-block;background:${BRAND.coral};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in Admin</a></p>
</div>`,
    }, { template: 'brand_project.submitted' });
    return 'sent';
  } catch (e) {
    console.error('[brand-project admin email]', e instanceof Error ? e.message : e);
    return 'failed';
  }
}

