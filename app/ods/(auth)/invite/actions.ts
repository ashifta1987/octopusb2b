'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';
import { ensureOwnProfile, refuseStaff } from '@/lib/ods-auth-server';

export type AcceptInviteResult = { ok: true } | { ok: false; code: 'expired' | 'has-company' | 'forbidden' | 'failed'; message: string };

/**
 * Accept a Dropship team invitation from the ODS invite page. Same database call as today's
 * app/account/dropship/ds12-actions.ts acceptInviteAction (ds_team_invite_accept: confirmed e-mail must match, pending,
 * not expired, no company yet — all checked in the database), but WITHOUT requireCustomer(): that guard sends anyone
 * without a company to /onboarding, and the RPC refuses anyone WITH a company, so the old action can never succeed for a
 * new teammate. After joining, the missing profile is created from the Google name (ensureOwnProfile), so the Shop and
 * My account open without the setup step (invited users skip setup, Part 4.5). No new database code.
 */
export async function acceptTeamInvite(id: string): Promise<AcceptInviteResult> {
  const p = z.string().uuid().safeParse(id);
  if (!p.success) return { ok: false, code: 'expired', message: 'This invitation is not valid for your sign-in.' };
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user || (await refuseStaff(user.id, user.email))) return { ok: false, code: 'forbidden', message: 'Sign in with the customer email the invitation was sent to.' };
  const { error } = await sb.rpc('ds_team_invite_accept', { p_id: p.data });
  if (error) {
    const code = error.message.split(':')[0].trim();
    if (code === 'NOT_FOUND') return { ok: false, code: 'expired', message: 'This invitation is no longer valid. It may have expired or been cancelled.' };
    if (code === 'HAS_COMPANY') return { ok: false, code: 'has-company', message: 'Your login already belongs to a company. Ask the owner to invite another email address.' };
    if (code === 'FORBIDDEN') return { ok: false, code: 'forbidden', message: 'Sign in with the customer email the invitation was sent to.' };
    return { ok: false, code: 'failed', message: rpcMessage(error) };
  }
  await ensureOwnProfile(user);
  revalidatePath('/account/dropship');
  return { ok: true };
}
