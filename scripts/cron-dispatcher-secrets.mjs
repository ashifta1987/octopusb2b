// Stores the outbox dispatcher's app URL and CRON_SECRET in Supabase Vault (SPEC §10.3, migration 20261101000131).
// Defaults to STAGING (.env.local/.env.staging). Pass --live explicitly to load .env.live and update live Vault.
// Usage: node scripts/cron-dispatcher-secrets.mjs [--url https://octopus-b2b.vercel.app] [--live]
import { config } from 'dotenv';
import pg from 'pg';
import { loadStagingEnvOrExit, assertStagingDatabase, loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';
config({ path: '.env.local', quiet: true });
const isLive = process.argv.includes('--live');
if (isLive) loadLiveEnvOrExit();
else loadStagingEnvOrExit();

const i = process.argv.indexOf('--url');
const url = (i > 0 ? process.argv[i + 1] : process.env.DISPATCH_APP_URL) || 'https://octopus-b2b.vercel.app';
const secret = process.env.CRON_SECRET;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
if (!secret) throw new Error('CRON_SECRET missing in .env.local');
if (!/^https:\/\//.test(url)) throw new Error('--url must be https');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
if (isLive) await assertLiveDatabase(db);
else await assertStagingDatabase(db);
async function put(name, value, description) {
  const { rows } = await db.query('select id from vault.secrets where name = $1', [name]);
  if (rows[0]) await db.query('select vault.update_secret($1, $2, $3, $4)', [rows[0].id, value, name, description]);
  else await db.query('select vault.create_secret($1, $2, $3)', [value, name, description]);
  console.log(`${rows[0] ? 'updated' : 'created'} vault secret ${name}`);
}
try {
  await put('octopus_app_url', url, 'Base URL the outbox dispatcher calls (SPEC §10.3)');
  await put('octopus_cron_secret', secret, 'CRON_SECRET for /api/cron/* (SPEC §10.3)');
} finally {
  await db.end();
}
