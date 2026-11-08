// Brand kit step 4 · media store — STAGING, one transaction, rolled back.
import { config } from 'dotenv'; import pg from 'pg';
const env = config({ path: process.env.DB_ENV ?? '.env.staging', quiet: true, processEnv: {} }).parsed;
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failed++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];
const as = async (sub) => { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] })]); await db.query('set local role authenticated'); };
const anon = async () => { await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`); await db.query('set local role anon'); };
const owner = () => db.query('reset role');
const tryQ = async (sql, p) => { await db.query('savepoint t'); try { const r = await db.query(sql, p); await db.query('release savepoint t'); return r; } catch (e) { await db.query('rollback to savepoint t'); return e.message; } };
if ((await one(`select value #>> '{}' v from site_settings where key = 'app_environment'`))?.v !== 'staging') { console.error('Refusing: not staging'); process.exit(1); }
try {
  await db.query('begin');
  const n = await one(`select count(*)::int n, count(*) filter (where alt = '' and key <> 'octo.face')::int noalt, count(*) filter (where path is not null)::int uploaded from site_media`);
  ok(n.n >= 18 && n.noalt === 0, `${n.n} picture slots, every non-decorative slot has alt text`);
  ok(n.uploaded >= 18, `${n.uploaded} slots point at the media store`);
  await anon();
  const read = (await db.query(`select key from site_media`)).rows.length;
  const a = await tryQ(`select set_site_media('home.hero.image', null, 'x')`);
  await owner();
  ok(read === n.n && typeof a === 'string', 'anonymous can read the slots but cannot change them');
  const cust = (await one(`select m.user_id from org_members m limit 1`)).user_id;
  await as(cust);
  const c = await tryQ(`select set_site_media('home.hero.image', null, 'Changed by a customer')`);
  const w = await tryQ(`update site_media set alt = 'x' where key = 'home.hero.image'`);
  await owner();
  const still = await one(`select alt from site_media where key = 'home.hero.image'`);
  ok(/FORBIDDEN/.test(String(c)) && still.alt !== 'x' && still.alt !== 'Changed by a customer', 'a customer cannot change a slot (function or direct update)');
  const admin = (await one(`select ur.user_id from user_roles ur where ur.role_code = 'admin' limit 1`)).user_id;
  await as(admin);
  await db.query(`select set_site_media('home.hero.image', 'site/custom/test.webp', 'The Octopus mascot loading a truck (test)')`);
  const bad = await tryQ(`select set_site_media('home.hero.image', '../../etc/passwd', 'x')`);
  await owner();
  const after = await one(`select path, alt from site_media where key = 'home.hero.image'`);
  const aud = await one(`select count(*)::int n from audit_log where action = 'site_media.updated' and created_at > now() - interval '1 minute'`);
  ok(after.path === 'site/custom/test.webp' && /test/.test(after.alt), 'a content editor (admin) can change a slot');
  ok(/BAD_PATH/.test(String(bad)), 'paths outside site/ are rejected');
  ok(aud.n >= 1, 'the change is audit-logged');
} catch (e) { console.error(e); failed++; } finally { await db.query('rollback'); await db.end(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nall media store checks passed');
process.exit(failed ? 1 : 0);
