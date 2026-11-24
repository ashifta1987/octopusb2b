#!/usr/bin/env node
// Standard migration schema round-trip verifier (STAGING ONLY, rolled-back transaction).
// Usage: node scripts/check-migration-roundtrip.mjs <migration_filename_or_prefix> [...]
// Example: node scripts/check-migration-roundtrip.mjs 209 210
//
// For each target migration M:
//  1. Inside BEGIN ... ROLLBACK on staging:
//     - If M is already applied, unwinds any applied migrations newer than M (newest first) + M.down.sql
//       so the database is in the exact pre-M state.
//  2. Dumps canonical public schema snapshot BEFORE (columns, sequences, constraints, indexes, views,
//     functions [def + ACL], triggers, RLS + policies, table/column/sequence/routine grants).
//  3. Applies M.sql (up) -> applies M.down.sql (down).
//  4. Dumps canonical public schema snapshot AFTER and computes a line-by-line diff.
//  5. Fails (exit 1) if ANY difference exists. Everything rolls back at the end.
import fs from 'node:fs';
import pg from 'pg';
import { loadStagingEnvOrExit, assertStagingDatabase } from './lib-staging-guard.mjs';

loadStagingEnvOrExit();

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/check-migration-roundtrip.mjs <migration_number_or_filename> [...]');
  process.exit(1);
}

const allFiles = fs
  .readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();

function resolveMigration(q) {
  const exact = allFiles.find((f) => f === q);
  if (exact) return exact;
  const padded = /^\d+$/.test(q) ? q.padStart(4, '0') : q;
  const matches = allFiles.filter((f) => f.includes(padded) || f.includes(q));
  if (matches.length !== 1) {
    throw new Error(`Ambiguous or missing migration "${q}" (matches: ${matches.join(', ') || 'none'})`);
  }
  return matches[0];
}

async function dumpSchema(db) {
  const q = async (sql) => (await db.query(sql)).rows;

  const columns = await q(`
    select table_name, column_name, data_type, udt_name,
           coalesce(character_maximum_length::text, '') as char_len,
           coalesce(numeric_precision::text, '') as num_prec,
           coalesce(numeric_scale::text, '') as num_scale,
           is_nullable,
           coalesce(column_default, '') as col_default
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, column_name
  `);

  const sequences = await q(`
    select sequencename, data_type::text, start_value::text, min_value::text, max_value::text, increment_by::text, cycle
      from pg_sequences
     where schemaname = 'public'
     order by sequencename
  `);

  const constraints = await q(`
    select c.relname as table_name, con.conname, con.contype::text, pg_get_constraintdef(con.oid, true) as def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     order by c.relname, con.conname
  `);

  const indexes = await q(`
    select tablename, indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
     order by tablename, indexname
  `);

  const views = await q(`
    select table_name, btrim(view_definition) as def
      from information_schema.views
     where table_schema = 'public'
     order by table_name
  `);

  const functions = await q(`
    select p.oid::regprocedure::text as sig,
           pg_get_function_result(p.oid) as ret,
           p.prosecdef,
           p.provolatile::text,
           coalesce((
             select array_agg(x order by x)::text
               from unnest(coalesce(p.proacl::text[], '{}')) x
           ), '{}') as acl,
           regexp_replace(btrim(pg_get_functiondef(p.oid)), '\\s+', ' ', 'g') as def_norm
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     order by 1
  `);

  const triggers = await q(`
    select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid, true) as def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where not t.tgisinternal
     order by c.relname, t.tgname
  `);

  const rlsTables = await q(`
    select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
     order by c.relname
  `);

  const policies = await q(`
    select tablename, policyname, permissive, roles::text, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname
  `);

  const tableGrants = await q(`
    select table_name, grantee, privilege_type, is_grantable
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
     order by table_name, grantee, privilege_type
  `);

  const columnGrants = await q(`
    select table_name, column_name, grantee, privilege_type
      from information_schema.column_privileges
     where table_schema = 'public'
       and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
     order by table_name, column_name, grantee, privilege_type
  `);

  const seqGrants = await q(`
    select object_name as sequence_name, grantee, privilege_type
      from information_schema.usage_privileges
     where object_schema = 'public'
       and object_type = 'SEQUENCE'
       and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
     order by 1, 2, 3
  `);

  const lines = [];
  const pushSection = (label, rows) => {
    for (const r of rows) lines.push(`${label} | ${JSON.stringify(r)}`);
  };
  pushSection('COL', columns);
  pushSection('SEQ', sequences);
  pushSection('CON', constraints);
  pushSection('IDX', indexes);
  pushSection('VIEW', views);
  pushSection('FN', functions);
  pushSection('TRG', triggers);
  pushSection('RLS', rlsTables);
  pushSection('POL', policies);
  pushSection('TGRANT', tableGrants);
  pushSection('CGRANT', columnGrants);
  pushSection('SGRANT', seqGrants);
  return lines;
}

function diffLines(beforeLines, afterLines) {
  const bSet = new Set(beforeLines);
  const aSet = new Set(afterLines);
  const removed = beforeLines.filter((l) => !aSet.has(l)).map((l) => `- ${l}`);
  const added = afterLines.filter((l) => !bSet.has(l)).map((l) => `+ ${l}`);
  return [...removed, ...added];
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);

let failed = 0;
try {
  for (const rawArg of args) {
    const migFile = resolveMigration(rawArg);
    const downPath = `supabase/migrations/down/${migFile.replace(/\.sql$/, '.down.sql')}`;
    const upPath = `supabase/migrations/${migFile}`;
    if (!fs.existsSync(downPath)) {
      console.error(`✘ Missing down file: ${downPath}`);
      failed++;
      continue;
    }

    await db.query('begin');
    try {
      const applied = new Set(
        (await db.query(`select name from public._migrations`)).rows.map((r) => r.name),
      );
      // Unwind any applied migrations newer than migFile (newest first), and migFile itself if applied
      const toUnwind = allFiles
        .filter((f) => f >= migFile && applied.has(f))
        .sort()
        .reverse();
      for (const f of toUnwind) {
        const dp = `supabase/migrations/down/${f.replace(/\.sql$/, '.down.sql')}`;
        await db.query(fs.readFileSync(dp, 'utf8'));
      }

      const before = await dumpSchema(db);
      await db.query(fs.readFileSync(upPath, 'utf8'));
      await db.query(fs.readFileSync(downPath, 'utf8'));
      const after = await dumpSchema(db);

      const diffs = diffLines(before, after);
      if (diffs.length === 0) {
        console.log(`✔ ${migFile}: up → down schema diff is EMPTY (${before.length} schema items verified identical)`);
      } else {
        failed++;
        console.error(`✘ ${migFile}: ${diffs.length} schema diff line(s) found:`);
        for (const d of diffs.slice(0, 60)) console.error(`  ${d}`);
        if (diffs.length > 60) console.error(`  ... (${diffs.length - 60} more)`);
      }

      if (migFile.includes('0210')) {
        const hsGuard = (await db.query(`
          select tg.tgname, pg_get_triggerdef(tg.oid, true) as tgdef, pg_get_functiondef('public.guard_hs_code()'::regprocedure) as fndef
            from pg_trigger tg
            join pg_class c on c.oid = tg.tgrelid
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
           where c.relname = 'products' and tg.tgname = 'trg_guard_hs_code'
        `)).rows[0];
        console.log(
          hsGuard
            ? `✔ 210.down: products HS guard restored -> ${hsGuard.tgdef}`
            : `✘ 210.down: trg_guard_hs_code missing on products`,
        );
        if (!hsGuard) failed++;
      }
    } finally {
      await db.query('rollback');
    }
  }
} finally {
  await db.end();
}

process.exitCode = failed ? 1 : 0;
