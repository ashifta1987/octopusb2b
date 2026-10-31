#!/usr/bin/env node
// Backup manifest (SPEC §16.2): file list, sizes, SHA-256, row counts per public table, ledger totals per currency,
// migration version, buckets. Row counts / ledger totals come from the plain data dump itself, so they describe exactly
// the snapshot that was dumped (no drift from writes during the run).
//
//   node scripts/backup/manifest.mjs stats --data work/data.sql --out work/stats.json
//   node scripts/backup/manifest.mjs build --dir out --code BK-… --stats work/stats.json [--buckets work/buckets.json] --out out/manifest.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { bucketOf, copyStats, fileKind } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

export async function statsFromDump(file) {
  const s = copyStats();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) s.line(line);
  return s.result();
}

export async function sha256File(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

export function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

async function main() {
  if (cmd === 'stats') {
    const data = flag('--data');
    if (!data) throw new Error('--data required');
    const s = await statsFromDump(data);
    fs.writeFileSync(flag('--out') ?? 'stats.json', JSON.stringify(s, null, 2));
    console.log(`stats: ${Object.keys(s.tables).length} public tables, migration ${s.migration_version}, ledger ${s.ledger_totals.map((t) => t.currency).join('/') || '—'}, unbalanced ${s.unbalanced_journals}`);
    return;
  }
  if (cmd === 'build') {
    const dir = flag('--dir');
    const code = flag('--code');
    if (!dir || !code) throw new Error('--dir and --code required');
    const stats = flag('--stats') ? JSON.parse(fs.readFileSync(flag('--stats'), 'utf8')) : {};
    const buckets = flag('--buckets') && fs.existsSync(flag('--buckets')) ? JSON.parse(fs.readFileSync(flag('--buckets'), 'utf8')) : [];
    const files = [];
    for (const rel of walk(dir)) {
      if (rel === 'manifest.json') continue;
      const abs = path.join(dir, rel);
      files.push({ path: rel, kind: fileKind(rel), bucket: bucketOf(rel), size_bytes: fs.statSync(abs).size, sha256: await sha256File(abs) });
    }
    const manifest = {
      format: 'octopus-backup/1',
      code,
      created_at: new Date().toISOString(),
      encryption: { tool: 'age', compression: 'gzip', recipient_fingerprint: process.env.BACKUP_KEY_FINGERPRINT || null },
      source: { project: process.env.SUPABASE_PROJECT_REF || null, github_run_id: process.env.GITHUB_RUN_ID || null, git_sha: process.env.GITHUB_SHA || null },
      migration_version: stats.migration_version ?? null,
      files,
      total_size_bytes: files.reduce((a, f) => a + f.size_bytes, 0),
      tables: stats.tables ?? {},
      other_tables: stats.other_tables ?? {},
      ledger: { totals: stats.ledger_totals ?? [], unbalanced_journals: stats.unbalanced_journals ?? 0 },
      buckets,
    };
    fs.writeFileSync(flag('--out') ?? path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`manifest: ${files.length} files, ${manifest.total_size_bytes} bytes`);
    return;
  }
  throw new Error('usage: manifest.mjs stats|build …');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
