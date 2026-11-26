'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dollarsToCents, parseRetentionDays } from '@/lib/turnkey/reports';

type Result = { ok: boolean; message?: string; error?: string };
const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '').replace(/^./, (c) => c.toUpperCase());
const usd = (c: number) => `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Turnkey T7 settings: admins only (the database functions check is_admin() on a 2FA session again and audit each change). */
async function admin(): Promise<Result | null> {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/settings');
  return s.isAdmin ? null : { ok: false, error: 'Only admins change Turnkey settings.' };
}

export async function setExtraTravellerPriceAction(value: string): Promise<Result> {
  const no = await admin(); if (no) return no;
  const cents = dollarsToCents(value);
  if (cents == null) return { ok: false, error: 'Enter the price per day in US dollars, for example 99 or 99.50.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_set_extra_traveller_price', { p_cents: cents });
  if (error) return { ok: false, error: clean(error.message) };
  revalidateTag('turnkey', 'max');
  revalidatePath('/admin/turnkey/settings');
  return { ok: true, message: `Extra traveller price set to ${usd(cents)} per day. New China visit requests use it; requested visits keep their price.` };
}

export async function setPassportRetentionAction(value: string): Promise<Result> {
  const no = await admin(); if (no) return no;
  const days = parseRetentionDays(value);
  if (days == null) return { ok: false, error: 'Enter a whole number of days from 1 to 365.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_set_passport_retention_days', { p_days: days });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey/settings');
  return { ok: true, message: `Passport copies are kept ${days} days after a visit.` };
}

/** An empty value clears the threshold (back to "not set"). */
export async function setAmThresholdAction(value: string): Promise<Result> {
  const no = await admin(); if (no) return no;
  const t = value.trim();
  const cents = t === '' ? null : dollarsToCents(t);
  if (t !== '' && (cents == null || cents <= 0)) return { ok: false, error: 'Enter the project value in US dollars (above 0), or leave it empty to clear it.' };
  const sb = await createClient();
  const { error } = await sb.rpc('tk_set_am_waiver_threshold', { p_cents: cents });
  if (error) return { ok: false, error: clean(error.message) };
  revalidatePath('/admin/turnkey/settings');
  return { ok: true, message: cents == null ? 'Threshold cleared: not set.' : `Account manager fee waived above ${usd(cents)} (project value).` };
}
