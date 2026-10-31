// Pure helpers shared by the backup / restore workflow scripts (SPEC §16). No dependencies — Node ≥ 20 only.
// Unit-tested in tests/unit/backup-checks.test.ts. Everything here must stay side-effect free.
import crypto from 'node:crypto';

/* ───────── Callback signing (same "t=…,v1=…" HMAC-SHA256 scheme as lib/adapters signPayload) ───────── */
export function signPayload(body, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/* ───────── Backup code + retention class (calendar in Asia/Shanghai) ───────── */
function shanghaiParts(date) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute, weekday: p.weekday };
}

/** BK-YYYY-MMDD-HHMM in China time (matches the DB default on backups.code). */
export function backupCode(date = new Date()) {
  const p = shanghaiParts(date);
  return `BK-${p.y}-${p.m}${p.d}-${p.hh}${p.mm}`;
}

/** monthly on the 1st, weekly on Sundays, else daily; manual "Back up now" runs keep class 'manual' (never auto-expired). */
export function retentionClass(date = new Date(), trigger = 'scheduled') {
  if (trigger === 'manual') return 'manual';
  const p = shanghaiParts(date);
  if (p.d === '01') return 'monthly';
  if (p.weekday === 'Sun') return 'weekly';
  return 'daily';
}

/* ───────── Restore modules → tables (partial restore into the `recovery` schema) ───────── */
// Only tables with an `id` column: recovery_compare / restore_records join on id (composite-key link tables such as
// product_tags, org_members, content_blocks, company_profile, services are left out).
export const MODULE_TABLES = {
  products: ['products', 'price_tiers', 'product_specs', 'product_media', 'tags'],
  categories: ['categories'],
  customers: ['organizations', 'addresses', 'kyc_submissions', 'kyc_documents'],
  suppliers: ['suppliers', 'certificates'],
  cms: ['pages', 'branches', 'banners', 'terms_versions'],
  services: ['service_prices'],
  tickets: ['tickets', 'ticket_messages', 'support_macros'],
  rfqs: ['rfqs', 'quotes'],
  ads: ['ad_campaigns'],
  api: ['api_clients', 'webhook_endpoints'],
  // money modules: loaded for comparison only — restore_records refuses them (corrections go through finance adjustments)
  orders: ['orders', 'order_events', 'shipments'],
  invoices: ['documents', 'proforma_invoices'],
  ledger: ['journals', 'ledger_entries', 'ledger_accounts'],
  wallet: ['wallet_topups', 'wallet_withdrawals'],
  payments: ['payments', 'payouts'],
  finance: ['finance_approvals'],
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Unique table list for the requested modules. Unknown names that look like a table identifier are taken as-is. */
export function tablesForModules(modules) {
  const out = [];
  for (const raw of modules ?? []) {
    const m = String(raw).trim().toLowerCase();
    const list = MODULE_TABLES[m] ?? (IDENT.test(m) ? [m] : []);
    for (const t of list) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/* ───────── COPY data parsing (supabase db dump --data-only --use-copy) ───────── */
const COPY_RE = /^COPY\s+"?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"?\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/i;

export function parseCopyHeader(line) {
  const m = COPY_RE.exec(line);
  if (!m) return null;
  return { schema: m[1], table: m[2], columns: m[3].split(',').map((c) => c.trim().replace(/^"|"$/g, '')) };
}

/** Decodes one field of PostgreSQL COPY text format (\N = null, backslash escapes). */
export function decodeCopyField(s) {
  if (s === '\\N') return null;
  if (!s.includes('\\')) return s;
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }[e] ?? e;
  });
}

/**
 * Streaming statistics over a plain data dump: row counts per table (exact, from the same snapshot as the dump),
 * ledger totals per currency, unbalanced journals, and the migration version (max(_migrations.name)).
 * Usage: const s = copyStats(); for each line s.line(line); s.result().
 */
export function copyStats() {
  const tables = {};
  const ledger = {}; // currency → {debit, credit, entries}
  const journals = new Map(); // journal|currency → net (debit - credit)
  let migration = null;
  let cur = null;
  let idx = null;
  return {
    line(line) {
      if (cur) {
        if (line === '\\.') { cur = null; idx = null; return; }
        tables[cur.key] = (tables[cur.key] ?? 0) + 1;
        if (idx) {
          const f = line.split('\t');
          if (cur.kind === 'ledger') {
            const c = decodeCopyField(f[idx.currency] ?? '') ?? 'USD';
            const d = BigInt(decodeCopyField(f[idx.debit_cents] ?? '') ?? 0);
            const k = BigInt(decodeCopyField(f[idx.credit_cents] ?? '') ?? 0);
            const t = (ledger[c] ??= { debit: 0n, credit: 0n, entries: 0 });
            t.debit += d; t.credit += k; t.entries++;
            const jk = `${decodeCopyField(f[idx.journal_id] ?? '')}|${c}`;
            journals.set(jk, (journals.get(jk) ?? 0n) + d - k);
          } else if (cur.kind === 'migrations') {
            const n = decodeCopyField(f[idx.name] ?? '');
            if (n && (!migration || n > migration)) migration = n;
          }
        }
        return;
      }
      const h = parseCopyHeader(line);
      if (!h) return;
      const key = h.schema === 'public' ? h.table : `${h.schema}.${h.table}`;
      tables[key] ??= 0;
      const pos = (c) => h.columns.indexOf(c);
      if (h.schema === 'public' && h.table === 'ledger_entries') {
        idx = { currency: pos('currency'), debit_cents: pos('debit_cents'), credit_cents: pos('credit_cents'), journal_id: pos('journal_id') };
        cur = { key, kind: 'ledger' };
      } else if (h.schema === 'public' && h.table === '_migrations') {
        idx = { name: pos('name') };
        cur = { key, kind: 'migrations' };
      } else cur = { key, kind: 'rows' };
    },
    result() {
      const unbalanced = [...journals.entries()].filter(([, v]) => v !== 0n).map(([k]) => k);
      return {
        tables: Object.fromEntries(Object.entries(tables).filter(([k]) => !k.includes('.'))),
        other_tables: Object.fromEntries(Object.entries(tables).filter(([k]) => k.includes('.'))),
        ledger_totals: ledgerTotalsJson(ledger),
        unbalanced_journals: unbalanced.length,
        migration_version: migration,
      };
    },
  };
}

function ledgerTotalsJson(ledger) {
  return Object.entries(ledger)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({ currency, debit_minor: t.debit.toString(), credit_minor: t.credit.toString(), entries: t.entries }));
}

/**
 * Partial restore: rewrites COPY blocks of the chosen public tables into the `recovery` schema (drop + recreate).
 * Stateful line filter: const x = recoveryRewriter(tables); x.line(l) → string[] to write; x.header() / x.footer() / x.found.
 */
export function recoveryRewriter(tables) {
  const want = new Set(tables);
  const found = new Set();
  let copying = false;
  return {
    found,
    header() {
      return [
        '-- generated by scripts/backup/partial.mjs — loads backup rows into the recovery schema (SPEC §16.3)',
        'create schema if not exists recovery;',
        ...tables.flatMap((t) => [
          `drop table if exists recovery.${q(t)};`,
          `create table recovery.${q(t)} (like public.${q(t)} including defaults including generated);`,
          // backups may predate newer NOT NULL columns: relax constraints in the staging copy
          `do $$ declare c text; begin for c in select column_name from information_schema.columns where table_schema = 'recovery' and table_name = '${t}' and is_nullable = 'NO' loop execute format('alter table recovery.%I alter column %I drop not null', '${t}', c); end loop; end $$;`,
        ]),
      ];
    },
    line(l) {
      if (copying) {
        if (l === '\\.') copying = false;
        return [l];
      }
      const h = parseCopyHeader(l);
      if (!h || h.schema !== 'public' || !want.has(h.table)) return [];
      found.add(h.table);
      copying = true;
      return [`COPY recovery.${q(h.table)} (${h.columns.map(q).join(', ')}) FROM stdin;`];
    },
    footer() {
      return ['revoke all on all tables in schema recovery from public, anon, authenticated;', 'grant all on all tables in schema recovery to service_role;'];
    },
  };
}

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/* ───────── Restore checks (each → {kind, status: pass|fail|note, detail, data}) ───────── */
export function checksumCheck(manifestFiles, actual) {
  const missing = [];
  const mismatched = [];
  for (const f of manifestFiles ?? []) {
    if (f.kind === 'manifest') continue;
    const got = actual[f.path];
    if (!got) missing.push(f.path);
    else if (got.sha256 !== f.sha256 || (f.size_bytes != null && Number(got.size_bytes) !== Number(f.size_bytes))) mismatched.push(f.path);
  }
  const total = (manifestFiles ?? []).filter((f) => f.kind !== 'manifest').length;
  const ok = total > 0 && !missing.length && !mismatched.length;
  return {
    kind: 'checksums',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `${total} of ${total} files match the manifest (SHA-256)` : total === 0 ? 'Manifest lists no files' : `${missing.length} missing, ${mismatched.length} mismatched of ${total} files`,
    data: { total, missing, mismatched },
  };
}

export function rowCountCheck(expected, actual) {
  const diffs = [];
  let tables = 0;
  let rows = 0;
  for (const [t, n] of Object.entries(expected ?? {})) {
    tables++;
    rows += Number(n);
    const got = actual[t];
    if (got === undefined) diffs.push({ table: t, expected: Number(n), actual: null });
    else if (Number(got) !== Number(n)) diffs.push({ table: t, expected: Number(n), actual: Number(got) });
  }
  const ok = tables > 0 && diffs.length === 0;
  return {
    kind: 'row_counts',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `${tables} tables, ${rows.toLocaleString('en-US')} rows match the manifest` : tables === 0 ? 'Manifest has no row counts' : `${diffs.length} of ${tables} tables differ from the manifest`,
    data: { tables, rows, diffs: diffs.slice(0, 50) },
  };
}

/** unbalanced: [{journal_id, currency, debit, credit}] (journal+currency groups where Σdebit ≠ Σcredit); totals: [{currency, debit_minor, credit_minor}] */
export function ledgerCheck(unbalanced, totals, manifestTotals) {
  const problems = [];
  const currencies = [...new Set((totals ?? []).map((t) => t.currency))].sort();
  if (unbalanced?.length) problems.push(`${unbalanced.length} journal/currency group(s) do not balance`);
  for (const t of totals ?? []) {
    if (String(t.debit_minor) !== String(t.credit_minor)) problems.push(`${t.currency}: debits ${t.debit_minor} ≠ credits ${t.credit_minor}`);
  }
  if (manifestTotals) {
    const byCur = Object.fromEntries((totals ?? []).map((t) => [t.currency, t]));
    for (const m of manifestTotals) {
      const g = byCur[m.currency];
      if (!g || String(g.debit_minor) !== String(m.debit_minor) || String(g.credit_minor) !== String(m.credit_minor)) {
        problems.push(`${m.currency}: totals differ from the manifest`);
      }
    }
  }
  return {
    kind: 'ledger_balanced',
    status: problems.length ? 'fail' : 'pass',
    detail: problems.length ? problems.join('; ') : currencies.length ? `Every journal balances per currency (${currencies.join(', ')})` : 'No ledger entries',
    data: { currencies, unbalanced: (unbalanced ?? []).slice(0, 50), totals },
  };
}

/** The backup's migration version must be one of the repo's migration files; after re-applying, the target must be at the latest. */
export function migrationCheck(backupVersion, knownFiles, targetVersion) {
  const sorted = [...(knownFiles ?? [])].sort();
  const latest = sorted[sorted.length - 1] ?? null;
  if (!backupVersion) return { kind: 'migration_version', status: 'fail', detail: 'Manifest has no migration version', data: { latest } };
  if (!sorted.includes(backupVersion)) {
    return { kind: 'migration_version', status: 'fail', detail: `Unknown migration version ${backupVersion} (newer than this code?)`, data: { backup: backupVersion, latest } };
  }
  const newer = sorted.filter((f) => f > backupVersion).length;
  if (targetVersion !== undefined && targetVersion !== latest) {
    return { kind: 'migration_version', status: 'fail', detail: `Target is at ${targetVersion ?? 'none'}, expected ${latest}`, data: { backup: backupVersion, latest, target: targetVersion } };
  }
  return {
    kind: 'migration_version',
    status: 'pass',
    detail: `Backup at ${backupVersion}; ${newer} newer migration(s) ${targetVersion !== undefined ? 're-applied' : 'to re-apply'}`,
    data: { backup: backupVersion, latest, target: targetVersion ?? null, newer },
  };
}

const SECRET_HINTS = {
  yunexpress: 'YunExpress API key/secret',
  payment: 'payment provider keys + PAYMENT_WEBHOOK_SECRET',
  email: 'EMAIL_API_KEY (Resend) + EMAIL_FROM',
  postman: 'POSTMAN_API_KEY + workspace',
  ai: 'OPENAI_API_KEY',
  source_1688: '1688 Open Platform AppKey',
  source_alibaba: 'Alibaba AppKey',
  dropship: 'Octopus Dropship API key',
};

/** Integration secrets are encrypted with the project key and do not survive a restore into another project. */
export function integrationKeysNote(integrations) {
  const list = (integrations ?? []).map((i) => (typeof i === 'string' ? { code: i } : i));
  const need = list.filter((i) => i.enabled !== false).map((i) => `${i.code}${SECRET_HINTS[i.code] ? ` (${SECRET_HINTS[i.code]})` : ''}`);
  return {
    kind: 'integration_keys',
    status: 'note',
    detail: need.length ? `Re-enter credentials after restore: ${need.join(', ')}; plus Vercel env vars` : 'No integrations configured',
    data: { integrations: list.map((i) => i.code) },
  };
}

/** Final restore status from the checks: any fail → failed, else the requested success status. */
export function outcome(checks, success) {
  const failed = (checks ?? []).filter((c) => c.status === 'fail');
  return failed.length ? { status: 'failed', error: `${failed.length} check(s) failed: ${failed.map((c) => c.kind).join(', ')}` } : { status: success, error: null };
}

/** backup_files kind from a path inside the backup prefix. */
export function fileKind(p) {
  if (p === 'manifest.json') return 'manifest';
  if (/(^|\/)roles\.sql/.test(p)) return 'db_roles';
  if (/(^|\/)schema\.sql/.test(p)) return 'db_schema';
  if (/(^|\/)data\.sql/.test(p)) return 'db_data';
  return 'storage';
}

export function bucketOf(p) {
  const m = /^storage\/(.+)\.tar\.gz\.age$/.exec(p);
  return m ? m[1] : null;
}
