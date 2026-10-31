#!/usr/bin/env node
// Restore step 1: verify downloaded (still encrypted) backup files against manifest.json (SHA-256 + size).
//   node scripts/backup/verify-files.mjs --dir work/files [--manifest work/files/manifest.json] --out work/checks.json
// Writes a JSON array with one 'checksums' check; exits 1 when it fails (the restore must not continue).
import fs from 'node:fs';
import path from 'node:path';
import { checksumCheck } from './lib.mjs';
import { sha256File, walk } from './manifest.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dir = flag('--dir') ?? 'files';
const manifest = JSON.parse(fs.readFileSync(flag('--manifest') ?? path.join(dir, 'manifest.json'), 'utf8'));
const actual = {};
for (const rel of walk(dir)) {
  if (rel === 'manifest.json') continue;
  const abs = path.join(dir, rel);
  actual[rel] = { sha256: await sha256File(abs), size_bytes: fs.statSync(abs).size };
}
const check = checksumCheck(manifest.files, actual);
const out = flag('--out') ?? 'checks.json';
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
fs.writeFileSync(out, JSON.stringify([...prev, check], null, 2));
console.log(`${check.status.toUpperCase()} checksums — ${check.detail}`);
process.exit(check.status === 'pass' ? 0 : 1);
