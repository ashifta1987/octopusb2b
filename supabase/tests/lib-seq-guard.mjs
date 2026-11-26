// Sequences are NOT transactional: setval/nextval survive a rollback. Tests that call wipe_demo_data() (it resets the
// code sequences to the highest remaining non-demo number) inside a rolled-back transaction must put them back.
import pg from 'pg';
import { assertStagingDatabase } from '../../scripts/lib-staging-guard.mjs';

export async function snapshotSequences(db) {
  return (await db.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows;
}

/** Restores on a fresh connection (works even if the test's connection dropped). Never moves a sequence backwards below rows that exist. */
export async function restoreSequences(snapshot) {
  const fix = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await fix.connect();
  try {
    await assertStagingDatabase(fix);
    const now = new Map((await fix.query(`select sequencename, last_value from pg_sequences where schemaname = 'public'`)).rows.map((r) => [r.sequencename, r.last_value]));
    for (const r of snapshot) {
      const cur = now.get(r.sequencename);
      if (r.last_value == null || cur == null) continue;
      if (BigInt(cur) < BigInt(r.last_value)) await fix.query(`select setval($1, $2, true)`, [r.sequencename, r.last_value]);
    }
  } finally {
    await fix.end();
  }
}
