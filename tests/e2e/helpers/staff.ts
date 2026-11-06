import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

/**
 * Temporary staff user for E2E (never the owner's account): created with the admin API, given a role, its own TOTP
 * factor enrolled + verified here, signed in through the real /staff/login → 2FA flow, deleted afterwards.
 */
config({ path: '.env.local', quiet: true });
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export type TempStaff = { id: string; email: string; password: string; secret: string; admin: SupabaseClient };

export async function createTempStaff(role: string): Promise<TempStaff> {
  const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });
  const email = `e2e.${role}+${Date.now()}@demo.octopusb2b.com`;
  const password = `E2e-${Math.random().toString(36).slice(2, 10)}-${Date.now() % 1000}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const id = data.user.id;
  await admin.from('profiles').upsert({ id, full_name: `E2E ${role}`, email });
  const { error: re } = await admin.from('user_roles').insert({ user_id: id, role_code: role });
  if (re) throw new Error(`user_roles: ${re.message}`);
  // enrol + verify this test user's own TOTP factor
  const user = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { error: se } = await user.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  const { data: f, error: fe } = await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e' });
  if (fe || !f) throw new Error(`enroll: ${fe?.message}`);
  const secret = f.totp.secret;
  const { error: ve } = await user.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(secret) });
  if (ve) throw new Error(`verify: ${ve.message}`);
  await user.auth.signOut();
  return { id, email, password, secret, admin };
}

export async function deleteTempStaff(t: TempStaff | null) {
  if (!t) return;
  await t.admin.from('distributor_suppliers').delete().eq('distributor_id', t.id);
  await t.admin.auth.admin.deleteUser(t.id);
}

/** Real staff sign-in: password → 6-digit code → (workspace chooser) → target path. */
export async function staffLogin(page: Page, t: TempStaff, next: string) {
  await page.goto(`/staff/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Work email').fill(t.email);
  await page.getByLabel('Password', { exact: true }).fill(t.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/staff\/verify|\/staff\/workspace|\/distributor|\/office|\/admin/);
  if (/\/staff\/verify/.test(page.url())) {
    // wait for a fresh 30 s window if we are at the very end of one (the enrolment used the current code)
    if (Date.now() / 1000 % 30 > 26) await page.waitForTimeout(4500);
    await page.getByLabel('Digit 1 of 6').click();
    await page.keyboard.type(totp(t.secret));
    const btn = page.getByRole('button', { name: /verify|continue/i }).first();
    if (await btn.isEnabled().catch(() => false)) await btn.click().catch(() => {});
  }
  await page.waitForURL((u) => !/\/staff\/(login|verify)/.test(u.pathname), { timeout: 20_000 });
  if (/\/staff\/workspace/.test(page.url())) await page.goto(next);
  await expect(page).not.toHaveURL(/\/staff\//);
}

