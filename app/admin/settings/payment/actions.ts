'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function updatePaymentOptionSettingAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireStaff('finance', 'edit', '/admin/settings/payment');
  if (!s.isAdmin && !s.roles.includes('finance')) {
    return { ok: false, error: 'Only company-wide Admin or Finance can change the payment settings matrix.' };
  }

  const service = String(formData.get('service') ?? '').trim();
  const option = String(formData.get('option') ?? '').trim();
  const enabled = formData.get('enabled') === 'true' || formData.get('enabled') === 'on';
  const minCents = Math.max(0, Math.round(Number(formData.get('min_amount_cents') ?? 0)));
  const maxRaw = String(formData.get('max_amount_cents') ?? '').trim();
  const maxCents = maxRaw ? Math.max(minCents, Math.round(Number(maxRaw))) : null;
  const releaseRule = String(formData.get('release_rule') ?? '').trim() || null;
  const autoDaysRaw = String(formData.get('auto_release_days') ?? '').trim();
  const autoDays = autoDaysRaw ? Math.max(0, Math.min(180, Math.round(Number(autoDaysRaw)))) : null;
  const trigger = String(formData.get('pay_later_invoice_trigger') ?? '').trim() || null;

  const sb = await createClient();
  const { error } = await sb
    .from('payment_option_settings')
    .update({
      enabled,
      min_amount_cents: minCents,
      max_amount_cents: maxCents,
      release_rule: releaseRule,
      auto_release_days: autoDays,
      pay_later_invoice_trigger: trigger,
    })
    .eq('service', service)
    .eq('option', option);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/settings/payment');
  return { ok: true };
}

export async function updatePaymentProviderSettingAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireStaff('finance', 'edit', '/admin/settings/payment');
  if (!s.isAdmin && !s.roles.includes('finance')) {
    return { ok: false, error: 'Only company-wide Admin or Finance can change provider routing.' };
  }

  const provider = String(formData.get('provider') ?? '').trim();
  const enabled = formData.get('enabled') === 'true' || formData.get('enabled') === 'on';
  const feeMode = String(formData.get('fee_mode') ?? 'absorb') === 'surcharge' ? 'surcharge' : 'absorb';
  const priority = Math.max(1, Math.round(Number(formData.get('priority') ?? 10)));
  const legalEntityId = String(formData.get('legal_entity_id') ?? '00000000-0000-0000-0000-000000000001').trim();
  const methodsRaw = String(formData.get('methods') ?? 'card').trim();
  const methods = methodsRaw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const sb = await createClient();
  const { error } = await sb
    .from('payment_provider_settings')
    .update({
      enabled,
      fee_mode: feeMode,
      priority,
      legal_entity_id: legalEntityId,
      methods: methods.length ? methods : ['card'],
      updated_at: new Date().toISOString(),
    })
    .eq('provider', provider);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/settings/payment');
  return { ok: true };
}

export async function saveUpcomingLegalEntityAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireStaff('finance', 'edit', '/admin/settings/payment');
  if (!s.isAdmin) {
    return { ok: false, error: 'Only company-wide Admin can add or update legal entities.' };
  }

  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const legalName = String(formData.get('legal_name') ?? '').trim();
  const regNo = String(formData.get('registration_no') ?? '').trim() || null;
  const taxId = String(formData.get('tax_id') ?? '').trim() || null;
  const address = String(formData.get('address') ?? '').trim() || null;
  const registeredIn = String(formData.get('registered_in') ?? 'Hong Kong').trim();
  const activeFrom = String(formData.get('active_from') ?? '2027-01-01T00:00:00Z').trim();

  if (!code || !legalName) {
    return { ok: false, error: 'Entity code and legal name are required.' };
  }

  const sb = await createClient();
  const { error } = await sb.from('legal_entities').upsert(
    {
      code,
      legal_name: legalName,
      registration_no: regNo,
      tax_id: taxId,
      address,
      registered_in: registeredIn,
      default_currency: 'USD',
      active_from: activeFrom,
      is_default: false, // Never auto-switch default; accountant switch happens explicitly
      status: 'upcoming',
    },
    { onConflict: 'code' },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/settings/payment');
  return { ok: true };
}
