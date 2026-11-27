'use server';

import { isStaging } from '@/lib/core/account';
import type { EnquiryInput } from '@/app/account/turnkey/actions';
import type { ApplyInput } from '@/app/(store)/3pl/apply/actions';

/**
 * Stand-ins for the real actions on the staging fixtures pages: they write NOTHING (no database, no email) and
 * answer like the real ones, with an "Example" reference. Refused outside staging.
 */
export async function sampleNotifyAction(email: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!isStaging()) return { ok: false, error: 'Not available.' };
  return { ok: true, message: `Example: we would email ${email} when the next pool opens.` };
}

export async function sampleTurnkeySubmit(input: EnquiryInput): Promise<{ ok: boolean; code?: string; error?: string }> {
  if (!isStaging()) return { ok: false, error: 'Not available.' };
  if (input.plan.trim().length < 20) return { ok: false, error: 'Tell us about your plan (at least 20 characters).' };
  return { ok: true, code: 'TKP-00000 (example)' };
}

export async function sampleWarehouseSubmit(input: ApplyInput): Promise<{ ok: boolean; code?: string; sds?: boolean; error?: string }> {
  if (!isStaging()) return { ok: false, error: 'Not available.' };
  return { ok: true, code: 'APP-0000 (example)', sds: input.hasBatteries || input.hasLiquids };
}
