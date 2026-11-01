// SPEC §20 "Done when": shipment answer with real tracking data; refund → handoff + Support ticket with transcript;
// account manager replies from the back office and the customer receives it live (Realtime) without reloading.
import { config } from 'dotenv'; import { createClient } from '@supabase/supabase-js'; import pg from 'pg'; import crypto from 'node:crypto';
config({ path: '.env.local', quiet: true });
const BASE = process.env.BASE ?? 'http://localhost:3100';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, PW = process.env.DEMO_PASSWORD;
const ref = new URL(URL_).hostname.split('.')[0];
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
function b32(s) { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }

const buyer = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: bs } = await buyer.auth.signInWithPassword({ email: 'buyer@demo.octopusb2b.com', password: PW });
const val = 'base64-' + Buffer.from(JSON.stringify(bs.session)).toString('base64url');
const cookie = Array.from({ length: Math.ceil(val.length / 3180) }, (_, i) => `sb-${ref}-auth-token.${i}=${val.slice(i * 3180, (i + 1) * 3180)}`).join('; ');
const ask = async (message, session_id) => {
  const r = await fetch(`${BASE}/api/assistant/reply`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ message, session_id, page: '/account/orders' }) });
  return { status: r.status, body: await r.json() };
};
let sessionId; const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let staffUid;
try {
  const r1 = await ask('Where is my order ORD-2202 and when will it arrive?');
  sessionId = r1.body.session_id;
  const botText = (r1.body.messages ?? []).filter((m) => m.author === 'bot').map((m) => m.content).join(' ');
  ok(r1.status === 200 && /YT2530412345678/.test(botText), `shipment question answered with real tracking data: "${botText.slice(0, 140)}…"`);

  const r2 = await ask('The last batch failed RoHS testing. I want a refund on the shipping.', sessionId);
  ok(r2.body.escalated === true, 'refund request is handed to the account manager');
  const esc = (await db.query(`select e.*, t.code from escalations e join tickets t on t.id=e.ticket_id where e.session_id=$1`, [sessionId])).rows[0];
  const tm = esc && (await db.query(`select body from ticket_messages where ticket_id=$1`, [esc.ticket_id])).rows[0];
  ok(esc && /Transcript/.test(tm?.body ?? '') && /ORD-2202/.test(tm?.body ?? ''), `Support ticket ${esc?.code} opened with the transcript attached`);

  // customer listens live
  const received = new Promise((resolve) => {
    const ch = buyer.channel('t-' + sessionId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assistant_messages', filter: `session_id=eq.${sessionId}` },
      (p) => { if (p.new.author === 'staff') resolve(p.new); }).subscribe();
    setTimeout(() => resolve(null), 15000);
  });
  await new Promise((r) => setTimeout(r, 2500));

  // account manager (support@) signs in with 2FA and replies from the back office
  const staff = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: ss } = await staff.auth.signInWithPassword({ email: 'support@demo.octopusb2b.com', password: PW });
  staffUid = ss.user.id;
  const en = await staff.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'e2e-' + Date.now() });
  await staff.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  await staff.rpc('log_assistant_open', { p_session: sessionId });
  const { error } = await staff.rpc('staff_assistant_reply', { p_session: sessionId, p_content: 'Hi, Demo here — I am reviewing the RoHS report and the shipping refund now.' });
  ok(!error, 'account manager replied from the back office' + (error ? ` (${error.message})` : ''));
  const msg = await received;
  ok(msg && /RoHS report/.test(msg.content), 'customer received the reply in the same thread live, without reloading');
} catch (e) {
  ok(false, 'unexpected error: ' + e.message);
} finally {
  // clean up the test conversation, its ticket, notifications, queued notices and the temporary MFA factor
  if (sessionId) {
    const t = (await db.query(`select ticket_id from escalations where session_id=$1`, [sessionId])).rows.map((r) => r.ticket_id).filter(Boolean);
    await db.query(`update assistant_sessions set escalation_id=null where id=$1`, [sessionId]);
    await db.query(`delete from assistant_sessions where id=$1`, [sessionId]);
    if (t.length) { await db.query(`delete from ticket_messages where ticket_id = any($1)`, [t]); await db.query(`delete from tickets where id = any($1)`, [t]); }
    await db.query(`delete from outbox_events where aggregate_id=$1`, [sessionId]);
    await db.query(`delete from notifications where link like $1`, [`%${sessionId}%`]);
  }
  if (staffUid) await db.query(`delete from auth.mfa_factors where user_id=$1`, [staffUid]);
  await db.end();
  console.log(failed ? `\n${failed} failed` : '\nSPEC §20 done-when: all passed');
  process.exit(failed ? 1 : 0);
}
