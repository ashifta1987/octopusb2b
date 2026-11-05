// ADDON-24: remove the demo dataset from THIS database in one transaction (wipe_demo_data + optional duplicate merge).
// Refuses unless (1) --env matches site_settings.app_environment of the target and (2) the operator types exactly
// "DELETE DEMO DATA FOR <project-ref>". Idempotent — a second run deletes nothing.
// Usage: pnpm db:wipe-demo --env production --operator admin@demo.octopusb2b.com [--merge-duplicates "SOUTHFIELD BIOCHEM PVT LTD"]
//        (add --confirm "DELETE DEMO DATA FOR <ref>" to skip the prompt, e.g. in a supervised terminal session)
import { config } from 'dotenv'; import pg from 'pg'; import readline from 'node:readline/promises';
import { environmentOf } from './lib-env-guard.mjs';
config({ path: '.env.local', quiet: true });
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const phrase = `DELETE DEMO DATA FOR ${ref}`;
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const env = await environmentOf(c);
  const wanted = arg('--env');
  if (!wanted || wanted !== env) {
    console.error(`✘ refused: target database environment is "${env}". Re-run with --env ${env} to confirm you mean this database (${ref}).`);
    process.exit(1);
  }
  const opEmail = arg('--operator');
  const op = opEmail ? (await c.query('select id from auth.users where lower(email) = lower($1)', [opEmail])).rows[0]?.id : null;
  if (!op) { console.error('✘ refused: --operator <staff email> is required (written to the audit log).'); process.exit(1); }

  const seed = (await c.query('select tag_seed_rows() r')).rows[0].r;
  console.log(`Target: ${ref} (${env}). Rows marked as demo:`, JSON.stringify(seed));
  let typed = arg('--confirm');
  if (!typed) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    typed = await rl.question(`Type exactly "${phrase}" to delete them: `);
    rl.close();
  }
  if (typed !== phrase) { console.error('✘ refused: confirmation text did not match. Nothing was deleted.'); process.exit(1); }

  await c.query('begin');
  const counts = (await c.query('select wipe_demo_data($1, $2) c', [typed, op])).rows[0].c;
  const merges = [];
  const dupName = arg('--merge-duplicates');
  if (dupName) {
    const orgs = (await c.query('select id from organizations where name = $1 order by buyer_code', [dupName])).rows;
    for (const o of orgs.slice(1)) merges.push((await c.query('select merge_duplicate_org($1, $2) m', [orgs[0].id, o.id])).rows[0].m);
  }
  await c.query('commit');
  console.log('✔ demo data removed:', JSON.stringify(counts));
  if (dupName) console.log(`✔ merged ${merges.length} duplicate "${dupName}" compan${merges.length === 1 ? 'y' : 'ies'}`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('✘ wipe failed — nothing was changed:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
