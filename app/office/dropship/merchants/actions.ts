'use server';

import { revalidatePath } from 'next/cache';
import { toCents } from '@/lib/format';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';

export type StaffActionResult = {
  ok: boolean;
  code?: string;
  message?: string;
  error?: string;
};

function mapRpcError(errMsg: string): StaffActionResult {
  const m = errMsg.match(/^([A-Z0-9_]+):?\s*(.*)$/);
  if (m) {
    return {
      ok: false,
      code: m[1],
      error: m[2] || errMsg,
    };
  }
  return { ok: false, error: errMsg };
}

export async function decideDropshipAccessRequestAction(
  formData: FormData,
): Promise<StaffActionResult> {
  await requireDropshipV2Staff(false, '/office/dropship/merchants');
  const requestId = String(formData.get('request_id') ?? '').trim();
  const decision = String(formData.get('decision') ?? '').trim().toLowerCase();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!requestId) return { ok: false, error: 'Missing request ID.' };
  if (!['approve', 'reject'].includes(decision)) {
    return { ok: false, error: 'Invalid decision.' };
  }
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', error: 'Enter a reason for this decision.' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('decide_dropship_access_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath('/office/dropship/merchants');
  return {
    ok: true,
    message:
      decision === 'approve'
        ? 'Access request approved — Dropshipping switched on and markets seeded.'
        : 'Access request rejected and logged.',
  };
}

export async function setDropshipMerchantStatusAction(
  formData: FormData,
): Promise<StaffActionResult> {
  await requireDropshipV2Staff(false, '/office/dropship/merchants');
  const orgId = String(formData.get('org_id') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim().toLowerCase();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!orgId) return { ok: false, error: 'Missing merchant organization ID.' };
  if (!['on', 'paused', 'off'].includes(status)) {
    return { ok: false, error: 'Status must be on, paused, or off.' };
  }
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', error: 'Enter a reason (required and audit-logged).' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_merchant_status', {
    p_org_id: orgId,
    p_status: status,
    p_reason: reason,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath('/office/dropship/merchants');
  return {
    ok: true,
    message: `Merchant status updated to "${status}".`,
  };
}

export async function reviewDropshipMerchantProfileAction(
  formData: FormData,
): Promise<StaffActionResult> {
  await requireDropshipV2Staff(true, '/office/dropship/merchants');
  const orgId = String(formData.get('org_id') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim().toLowerCase();
  const reason = String(formData.get('reason') ?? '').trim();
  const internalNote = String(formData.get('internal_note') ?? '').trim() || null;

  if (!orgId) return { ok: false, error: 'Missing merchant organization ID.' };
  if (!['approved', 'rejected'].includes(status)) {
    return { ok: false, error: 'Status must be approved or rejected.' };
  }
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', error: 'Enter a message/reason for the merchant.' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('review_dropship_merchant_profile', {
    p_org_id: orgId,
    p_status: status,
    p_reason: reason,
    p_internal_note: internalNote,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath('/office/dropship/merchants');
  return {
    ok: true,
    message:
      status === 'approved'
        ? 'Brand & return address approved for shipping labels.'
        : 'Brand & return address rejected — merchant notified.',
  };
}

export async function updateDropshipMerchantMarketsAction(
  formData: FormData,
): Promise<StaffActionResult> {
  await requireDropshipV2Staff(false, '/office/dropship/merchants');
  const orgId = String(formData.get('org_id') ?? '').trim();
  const rawCountries = String(formData.get('countries') ?? '');
  const lock = formData.get('locked_by_staff') === 'on' || formData.get('locked_by_staff') === 'true';

  const countries = rawCountries
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (!orgId) return { ok: false, error: 'Missing merchant organization ID.' };
  if (countries.length === 0 || countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    return { ok: false, error: 'Enter at least one 2-letter ISO country code (e.g. AE, SA).' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('set_dropship_markets', {
    p_countries: [...new Set(countries)],
    p_org_id: orgId,
    p_lock: lock,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath('/office/dropship/merchants');
  return { ok: true, message: 'Selling countries updated.' };
}

export async function proposeMerchantWalletAdjustmentAction(
  formData: FormData,
): Promise<StaffActionResult> {
  await requireDropshipV2Staff(false, '/office/dropship/merchants');
  const orgId = String(formData.get('org_id') ?? '').trim();
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!orgId) return { ok: false, error: 'Select a merchant first.' };
  const cents = toCents(amountRaw);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: 'Enter a positive USD amount.' };
  }
  if (reason.length < 5) {
    return { ok: false, error: 'Enter a reason of at least 5 characters (shown to the merchant).' };
  }

  const sb = await createClient();
  const { error } = await sb.rpc('request_finance_approval', {
    p_kind: 'adjustment',
    p_amount: cents,
    p_reason: reason,
    p_org: orgId,
    p_order: null,
    p_supplier: null,
  });

  if (error) return mapRpcError(error.message);

  revalidatePath('/office/dropship/merchants');
  revalidatePath('/admin/finance');
  return {
    ok: true,
    message: 'Wallet adjustment proposed — a second Finance approver must approve it.',
  };
}
