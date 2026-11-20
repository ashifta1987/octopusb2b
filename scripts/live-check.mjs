// Read-only live diagnostics: counts, sums and migration status only (zero secrets, zero rows of customer data).
// Requires BOTH the explicit --live flag AND .env.live pointing at the live project (marked "production").
// Refuses unless --live is given. Runs inside `BEGIN READ ONLY` with `statement_timeout = '30s'` (per query).
// Usage: node scripts/live-check.mjs --live [--snapshot <file.json outside the repo>]
//   --snapshot also records: row count of every public table, wallet balance sums, ledger totals per stream,
//   number of public tables with RLS on, and which migrations on disk live has not applied yet.
import fs from 'node:fs';
import pg from 'pg';
import { loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';

loadLiveEnvOrExit();
const snapIdx = process.argv.indexOf('--snapshot');
const snapPath = snapIdx > 0 ? process.argv[snapIdx + 1] : null;
if (snapPath && fs.realpathSync('.') && (snapPath.startsWith('.') || !snapPath.startsWith('/') || snapPath.startsWith(process.cwd()))) {
  console.error('✘ --snapshot needs an absolute path outside the repository');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await assertLiveDatabase(db);
  await db.query('begin read only');
  await db.query(`set local statement_timeout = '30s'`);
  const rows = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await rows(s, p))[0];

  const applied = (await rows(`select name from public._migrations order by name`)).map((r) => r.name);
  const disk = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  const pending = disk.filter((f) => !applied.includes(f));
  const unknownOnLive = applied.filter((f) => !disk.includes(f));
  const apiKeys = await one(`select count(*)::int active, count(*) filter (where mode = 'live')::int live from api_keys where revoked_at is null`);
  const docs = await one(`select count(*)::int total, count(*) filter (where number ~ '^(OCT|CN|PF)-')::int new_series from documents`);
  const unplaced = (await one(`select to_regprocedure('division_unplaced()') is not null has_fn`)).has_fn
    ? await rows(`select * from division_unplaced()`) : 'not installed yet';

  const out = {
    at: new Date().toISOString(), environment: 'production',
    migrations: { applied_count: applied.length, latest: applied.at(-1), pending, unknown_on_live: unknownOnLive },
    apiKeys, docs, division_unplaced: unplaced,
  };

  if (snapPath) {
    const tables = (await rows(`select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') order by 1`));
    const counts = {};
    for (const { t } of tables) counts[t] = Number((await one(`select count(*) n from public."${t}"`)).n);
    out.snapshot = {
      table_count: tables.length,
      rls_on: tables.filter((t) => t.rls).length,
      rls_off: tables.filter((t) => !t.rls).map((t) => t.t),
      row_counts: counts,
      // wallet balances: the ledger is the source of truth (credit − debit on wallet:* accounts), per currency
      wallet_ledger: await rows(`select la.currency, count(distinct la.org_id)::int wallets, coalesce(sum(le.credit_cents - le.debit_cents), 0)::bigint balance_sum
        from ledger_accounts la left join ledger_entries le on le.account_id = la.id where la.code like 'wallet:%' group by la.currency order by 1`),
      wallets_table: (await one(`select to_regclass('public.wallets') is not null t`)).t
        ? await rows(`select currency, count(*)::int n, coalesce(sum(balance_minor), 0)::bigint balance_sum from wallets group by currency order by 1`) : null,
      ledger_by_stream: await rows(`select coalesce(j.stream::text, '(none)') stream, count(distinct j.id)::int journals,
        coalesce(sum(le.debit_cents), 0)::bigint debit, coalesce(sum(le.credit_cents), 0)::bigint credit
        from journals j left join ledger_entries le on le.journal_id = j.id group by 1 order by 1`),
      ledger_total: await one(`select coalesce(sum(debit_cents), 0)::bigint debit, coalesce(sum(credit_cents), 0)::bigint credit from ledger_entries`),
    };
    fs.writeFileSync(snapPath, JSON.stringify(out, null, 1), { mode: 0o600 });
  }
  await db.query('commit');
  const { snapshot, ...summary } = out;
  console.log(JSON.stringify(summary, null, 2));
  if (snapshot) {
    console.log(`snapshot → ${snapPath}`);
    console.log(JSON.stringify({ table_count: snapshot.table_count, rls_on: snapshot.rls_on, rls_off: snapshot.rls_off,
      total_rows: Object.values(snapshot.row_counts).reduce((a, b) => a + b, 0), wallet_ledger: snapshot.wallet_ledger,
      wallets_table: snapshot.wallets_table, ledger_by_stream: snapshot.ledger_by_stream, ledger_total: snapshot.ledger_total }, null, 2));
  }
} catch (e) {
  await db.query('rollback').catch(() => {});
  console.error('✘ live-check failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
