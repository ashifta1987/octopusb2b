#!/usr/bin/env node
// Restore checks against the TARGET database (SPEC §16.3 step 2/5):
//   row_counts (vs manifest) · ledger_balanced (journal_id + currency, totals vs manifest) · migration_version · integration_keys
//   node scripts/backup/checks.mjs --db-url "$TARGET_DB_URL" --manifest work/files/manifest.json --append work/checks.json [--only row_counts,ledger_balanced]
// Appends checks to the JSON array file. Exit code is always 0 unless the DB is unreachable (the callback decides the outcome).
import fs from 'node:fs';
import pg from 'pg';
import { integrationKeysNote, ledgerCheck, migrationCheck, rowCountCheck } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dbUrl = flag('--db-url') ?? process.env.TARGET_DB_URL;
const manifest = JSON.parse(fs.readFileSync(flag('--manifest') ?? 'manifest.json', 'utf8'));
const only = flag('--only') ? new Set(flag('--only').split(',')) : null;
const want = (k) => !only || only.has(k);
const out = flag('--append') ?? 'checks.json';

const db = new pg.Client({ connectionString: dbUrl, ssl: dbUrl?.includes('localhost') ? false : { rejectUnauthorized: false } });
await db.connect();
const checks = [];
const safe = async (kind, fn) => {
  try { checks.push(await fn()); } catch (e) { checks.push({ kind, status: 'fail', detail: `Check could not run: ${e.message}`.slice(0, 500) }); }
};

if (want('row_counts')) {
  await safe('row_counts', async () => {
    const actual = {};
    const { rows } = await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    for (const { table_name } of rows) {
      actual[table_name] = Number((await db.query(`select count(*)::bigint n from public.${pg.escapeIdentifier(table_name)}`)).rows[0].n);
    }
    return rowCountCheck(manifest.tables, actual);
  });
}

if (want('ledger_balanced')) {
  await safe('ledger_balanced', async () => {
    const unbalanced = (await db.query(`select journal_id, currency, sum(debit_cents)::text debit, sum(credit_cents)::text credit
        from public.ledger_entries group by journal_id, currency having sum(debit_cents) <> sum(credit_cents) limit 100`)).rows;
    const totals = (await db.query(`select currency, sum(debit_cents)::text debit_minor, sum(credit_cents)::text credit_minor, count(*)::int entries
        from public.ledger_entries group by currency order by currency`)).rows.map((r) => ({ ...r, currency: r.currency.trim() }));
    return ledgerCheck(unbalanced, totals, manifest.ledger?.totals);
  });
}

if (want('migration_version')) {
  await safe('migration_version', async () => {
    const known = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
    let target;
    if (args.includes('--after-migrate')) target = (await db.query('select max(name) v from public._migrations')).rows[0].v;
    return migrationCheck(manifest.migration_version, known, target);
  });
}

if (want('integration_keys')) {
  await safe('integration_keys', async () => {
    const { rows } = await db.query(`select code, coalesce(enabled, true) enabled from public.integrations order by code`).catch(async () => db.query(`select code from public.integrations order by code`));
    return integrationKeysNote(rows);
  });
}

await db.end();
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
fs.writeFileSync(out, JSON.stringify([...prev, ...checks], null, 2));
for (const c of checks) console.log(`${c.status.toUpperCase()} ${c.kind} — ${c.detail}`);
