import { describe, expect, it } from 'vitest';
import {
  backupCode, bucketOf, checksumCheck, copyStats, decodeCopyField, fileKind, integrationKeysNote, ledgerCheck, migrationCheck, outcome, parseCopyHeader,
  recoveryRewriter, retentionClass, rowCountCheck, tablesForModules,
} from '@/scripts/backup/lib.mjs';

describe('backup code + retention (China time)', () => {
  it('formats BK-YYYY-MMDD-HHMM in Asia/Shanghai', () => {
    expect(backupCode(new Date('2026-10-31T18:00:00Z'))).toBe('BK-2026-1101-0200');
    expect(backupCode(new Date('2026-12-31T16:05:00Z'))).toBe('BK-2027-0101-0005');
  });
  it('monthly on the 1st, weekly on Sundays, else daily; manual stays manual', () => {
    expect(retentionClass(new Date('2026-10-31T18:00:00Z'))).toBe('monthly'); // 1 Nov China time
    expect(retentionClass(new Date('2026-11-07T18:00:00Z'))).toBe('weekly'); // Sun 8 Nov China time
    expect(retentionClass(new Date('2026-11-09T18:00:00Z'))).toBe('daily');
    expect(retentionClass(new Date('2026-11-07T18:00:00Z'), 'manual')).toBe('manual');
  });
});

describe('modules → tables', () => {
  it('maps modules and passes through table identifiers', () => {
    expect(tablesForModules(['products', 'cms'])).not.toContain('content_blocks');
    expect(tablesForModules(['products', 'cms'])).toEqual(expect.arrayContaining(['products', 'price_tiers', 'pages', 'banners']));
    expect(tablesForModules(['categories', 'categories', 'tags'])).toEqual(['categories', 'tags']);
    expect(tablesForModules(['drop table x;'])).toEqual([]);
  });
});

const DUMP = [
  'SET session_replication_role = replica;',
  'COPY "public"."_migrations" ("name", "applied_at") FROM stdin;',
  '20261101000060_currency.sql\t2026-11-01',
  '20261101000080_backup_restore.sql\t2026-11-01',
  '\\.',
  'COPY "public"."ledger_entries" ("id", "journal_id", "account_id", "org_id", "debit_cents", "credit_cents", "memo", "created_at", "currency") FROM stdin;',
  '1\tj1\ta\t\\N\t1000\t0\tTop-up\\twith tab\t2026-11-01\tUSD',
  '2\tj1\tb\t\\N\t0\t1000\t\\N\t2026-11-01\tUSD',
  '3\tj2\ta\t\\N\t500\t0\t\\N\t2026-11-01\tCNY',
  '4\tj2\tb\t\\N\t0\t400\t\\N\t2026-11-01\tCNY',
  '\\.',
  'COPY "public"."products" ("id", "title") FROM stdin;',
  'p1\tBolt',
  'p2\tNut',
  '\\.',
  'COPY "public"."tags" ("id") FROM stdin;',
  '\\.',
  'COPY "auth"."users" ("id") FROM stdin;',
  'u1',
  '\\.',
];

describe('COPY parsing + manifest stats', () => {
  it('parses headers and fields', () => {
    expect(parseCopyHeader('COPY "public"."products" ("id", "title") FROM stdin;')).toEqual({ schema: 'public', table: 'products', columns: ['id', 'title'] });
    expect(parseCopyHeader('COPY public.tags (id) FROM stdin;')?.table).toBe('tags');
    expect(parseCopyHeader('SELECT 1;')).toBeNull();
    expect(decodeCopyField('\\N')).toBeNull();
    expect(decodeCopyField('a\\tb\\\\c\\n')).toBe('a\tb\\c\n');
  });

  it('counts rows per table, ledger totals per currency, unbalanced journals, migration version', () => {
    const s = copyStats();
    DUMP.forEach((l) => s.line(l));
    const r = s.result();
    expect(r.tables).toEqual({ _migrations: 2, ledger_entries: 4, products: 2, tags: 0 });
    expect(r.other_tables).toEqual({ 'auth.users': 1 });
    expect(r.migration_version).toBe('20261101000080_backup_restore.sql');
    expect(r.ledger_totals).toEqual([
      { currency: 'CNY', debit_minor: '500', credit_minor: '400', entries: 2 },
      { currency: 'USD', debit_minor: '1000', credit_minor: '1000', entries: 2 },
    ]);
    expect(r.unbalanced_journals).toBe(1);
  });

  it('rewrites only the chosen tables into the recovery schema', () => {
    const rw = recoveryRewriter(['products', 'categories']);
    const out = [...rw.header(), ...DUMP.flatMap((l) => rw.line(l)), ...rw.footer()].join('\n');
    expect(out).toContain('create table recovery."products" (like public."products" including defaults including generated);');
    expect(out).toContain('COPY recovery."products" ("id", "title") FROM stdin;\np1\tBolt\np2\tNut\n\\.');
    expect(out).not.toContain('ledger_entries');
    expect([...rw.found]).toEqual(['products']);
  });
});

describe('restore checks', () => {
  const files = [
    { path: 'db/data.sql.gz.age', kind: 'db_data', size_bytes: 10, sha256: 'aa' },
    { path: 'storage/kyc.tar.gz.age', kind: 'storage', size_bytes: 5, sha256: 'bb' },
    { path: 'manifest.json', kind: 'manifest', sha256: null },
  ];
  it('checksums: pass, mismatch, missing', () => {
    expect(checksumCheck(files, { 'db/data.sql.gz.age': { sha256: 'aa', size_bytes: 10 }, 'storage/kyc.tar.gz.age': { sha256: 'bb', size_bytes: 5 } }).status).toBe('pass');
    const bad = checksumCheck(files, { 'db/data.sql.gz.age': { sha256: 'xx', size_bytes: 10 } });
    expect(bad.status).toBe('fail');
    expect(bad.data).toMatchObject({ missing: ['storage/kyc.tar.gz.age'], mismatched: ['db/data.sql.gz.age'] });
    expect(checksumCheck([], {}).status).toBe('fail');
  });

  it('row counts vs manifest', () => {
    expect(rowCountCheck({ products: 2, tags: 0 }, { products: 2, tags: 0, extra: 9 }).status).toBe('pass');
    const r = rowCountCheck({ products: 2, tags: 0 }, { products: 1 });
    expect(r.status).toBe('fail');
    expect(r.data.diffs).toEqual([{ table: 'products', expected: 2, actual: 1 }, { table: 'tags', expected: 0, actual: null }]);
  });

  it('ledger balanced per journal + currency, totals vs manifest', () => {
    const totals = [{ currency: 'USD', debit_minor: '1000', credit_minor: '1000' }, { currency: 'CNY', debit_minor: '500', credit_minor: '500' }];
    expect(ledgerCheck([], totals, totals).status).toBe('pass');
    expect(ledgerCheck([], totals, totals).detail).toContain('CNY, USD');
    expect(ledgerCheck([{ journal_id: 'j2', currency: 'CNY', debit: '500', credit: '400' }], totals).status).toBe('fail');
    expect(ledgerCheck([], totals, [{ currency: 'USD', debit_minor: '999', credit_minor: '999' }]).detail).toContain('USD: totals differ');
  });

  it('migration version known + target at latest', () => {
    const known = ['20261101000060_currency.sql', '20261101000080_backup_restore.sql', '20261101000081_x.sql'];
    expect(migrationCheck('20261101000060_currency.sql', known).status).toBe('pass');
    expect(migrationCheck('20991231000000_future.sql', known).status).toBe('fail');
    expect(migrationCheck(null, known).status).toBe('fail');
    expect(migrationCheck('20261101000060_currency.sql', known, '20261101000081_x.sql').status).toBe('pass');
    expect(migrationCheck('20261101000060_currency.sql', known, '20261101000080_backup_restore.sql').status).toBe('fail');
  });

  it('integration keys note + outcome', () => {
    const n = integrationKeysNote([{ code: 'yunexpress' }, { code: 'ai' }, { code: 'dropship', enabled: false }]);
    expect(n.status).toBe('note');
    expect(n.detail).toContain('OPENAI_API_KEY');
    expect(n.detail).not.toContain('dropship');
    expect(outcome([{ kind: 'checksums', status: 'pass' }, n], 'verified')).toEqual({ status: 'verified', error: null });
    expect(outcome([{ kind: 'row_counts', status: 'fail' }], 'completed').status).toBe('failed');
  });

  it('file kinds', () => {
    expect(fileKind('db/roles.sql.gz.age')).toBe('db_roles');
    expect(fileKind('db/schema.sql.gz.age')).toBe('db_schema');
    expect(fileKind('db/data.sql.gz.age')).toBe('db_data');
    expect(fileKind('storage/product-media.tar.gz.age')).toBe('storage');
    expect(bucketOf('storage/product-media.tar.gz.age')).toBe('product-media');
  });
});
