#!/usr/bin/env node
// Creates (or refreshes) a named STAGING back-office account for the owner: admin role (Turnkey, Warehouse OS, Dropship
// back office), a fresh password and its own verified TOTP (2FA) factor. Prints the sign-in details once.
// STAGING ONLY. Not a demo address, so the staging demo wipe keeps it.
//   node --env-file=.env.staging scripts/create-staging-office-user.mjs [email]
import crypto, { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { assertStagingOrThrow } from './lib-staging-guard.mjs';

const email = (process.argv[2] ?? 'turnkey.office@staging.octopusb2b.com').toLowerCase();
await assertStagingOrThrow();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingOrThrow(db);
await db.end();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = `Oct-${crypto.randomBytes(6).toString('base64url')}-${crypto.randomInt(100, 999)}!`;

function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// user (create or reset password)
let id;
const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Turnkey Office (staging)' } });
if (ce) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  id = list.users.find((u) => u.email === email)?.id;
  if (!id) throw new Error(`createUser: ${ce.message}`);
  const { error } = await admin.auth.admin.updateUserById(id, { password, ban_duration: 'none' });
  if (error) throw new Error(`reset: ${error.message}`);
  // remove old TOTP factors so the new secret is the only one
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: id });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
} else id = created.user.id;
await admin.from('profiles').upsert({ id, full_name: 'Turnkey Office (staging)', email });
const { data: hasRole } = await admin.from('user_roles').select('user_id').eq('user_id', id).eq('role_code', 'admin').maybeSingle();
if (!hasRole) {
  const { error } = await admin.from('user_roles').insert({ user_id: id, role_code: 'admin' });
  if (error) throw new Error(`user_roles: ${error.message}`);
}

// own TOTP factor, enrolled and verified
const user = createClient(URL, anon, { auth: { persistSession: false } });
const { error: se } = await user.auth.signInWithPassword({ email, password });
if (se) throw new Error(`signIn: ${se.message}`);
const { data: f, error: fe } = await user.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
if (fe || !f) throw new Error(`enroll: ${fe?.message}`);
const { error: ve } = await user.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
if (ve) throw new Error(`verify: ${ve.message}`);
await user.auth.signOut();

console.log(JSON.stringify({ email, password, totp_secret: f.totp.secret, otpauth_uri: f.totp.uri }));
