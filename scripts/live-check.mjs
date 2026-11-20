// Read-only live diagnostics: counts and migration status only (zero secrets, zero customer PII).
// Requires BOTH the explicit --live flag AND .env.live pointing at the live project (marked "production").
// Refuses unless --live is given. Runs inside `BEGIN READ ONLY` with `statement_timeout = '30s'`.
// Usage: node scripts/live-check.mjs --live
import pg from 'pg';
import { loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';

loadLiveEnvOrExit();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await assertLiveDatabase(db);
  await db.query('begin read only');
  await db.query(`set local statement_timeout = '30s'`);
  const one = async (s) => (await db.query(s)).rows[0];
  const latestMig = (await one(`select max(name) m, count(*)::int n from public._migrations`)) ?? {};
  const apiKeys = (await one(`select count(*)::int active, count(*) filter (where mode = 'live')::int live from api_keys where revoked_at is null`)) ?? {};
  const docs = (await one(`select count(*)::int total, count(*) filter (where number ~ '^(OCT|CN|PF)-')::int new_series from documents`)) ?? {};
  const unplaced = (await one(`select to_regprocedure('division_unplaced()') is not null has_fn`))?.has_fn
    ? (await db.query(`select * from division_unplaced()`)).rows
    : 'not installed yet';
  await db.query('commit');
  console.log(JSON.stringify({ environment: 'production', migrations: latestMig, apiKeys, docs, division_unplaced: unplaced }, null, 2));
} catch (e) {
  await db.query('rollback').catch(() => {});
  console.error('✘ live-check failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
