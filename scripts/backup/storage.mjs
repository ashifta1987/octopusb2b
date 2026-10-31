#!/usr/bin/env node
// Supabase Storage backup/restore through the service-role REST API (no separate S3 keys needed).
//   download: node scripts/backup/storage.mjs download --out work/storage [--stats work/buckets.json] [--exclude a,b]
//             → work/storage/<bucket>/<object path> + work/storage/<bucket>/.octopus-objects.json (content types)
//   upload:   node scripts/backup/storage.mjs upload --dir work/storage [--manifest manifest.json] [--out check.json]
//             → creates missing buckets (same public flag) and upserts every object; writes a 'storage' restore check.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for restore: the TARGET project's values).
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const INDEX = '.octopus-objects.json';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('storage: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function listAll(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const o of data ?? []) {
      const p = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id === null) out.push(...(await listAll(bucket, p))); // folder
      else out.push({ path: p, size: o.metadata?.size ?? null, content_type: o.metadata?.mimetype ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function withRetry(fn, label) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
  }
  throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
}

async function download() {
  const outDir = flag('--out') ?? 'storage';
  const exclude = new Set((flag('--exclude') ?? process.env.BACKUP_EXCLUDE_BUCKETS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) throw new Error(error.message);
  const stats = [];
  for (const b of buckets ?? []) {
    if (exclude.has(b.id)) continue;
    const dir = path.join(outDir, b.id);
    fs.mkdirSync(dir, { recursive: true });
    const objects = await listAll(b.id);
    let bytes = 0;
    for (const o of objects) {
      const buf = await withRetry(async () => {
        const { data, error: e } = await sb.storage.from(b.id).download(o.path);
        if (e) throw new Error(e.message);
        return Buffer.from(await data.arrayBuffer());
      }, `download ${b.id}/${o.path}`);
      const dest = path.join(dir, o.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      bytes += buf.length;
    }
    fs.writeFileSync(path.join(dir, INDEX), JSON.stringify({ bucket: b.id, public: b.public, objects }, null, 0));
    stats.push({ name: b.id, public: b.public, objects: objects.length, bytes });
    console.log(`storage: ${b.id} ${objects.length} objects, ${bytes} bytes`);
  }
  fs.writeFileSync(flag('--stats') ?? path.join(outDir, 'buckets.json'), JSON.stringify(stats, null, 2));
}

async function upload() {
  const dir = flag('--dir') ?? 'storage';
  const manifest = flag('--manifest') && fs.existsSync(flag('--manifest')) ? JSON.parse(fs.readFileSync(flag('--manifest'), 'utf8')) : null;
  const expected = Object.fromEntries((manifest?.buckets ?? []).map((b) => [b.name, b.objects]));
  const { data: existing } = await sb.storage.listBuckets();
  const have = new Set((existing ?? []).map((b) => b.id));
  const result = [];
  for (const name of fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort()) {
    const idxPath = path.join(dir, name, INDEX);
    const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { public: false, objects: [] };
    if (!have.has(name)) {
      const { error } = await sb.storage.createBucket(name, { public: !!idx.public });
      if (error && !/exists/i.test(error.message)) throw new Error(`create bucket ${name}: ${error.message}`);
    }
    const types = Object.fromEntries((idx.objects ?? []).map((o) => [o.path, o.content_type]));
    let n = 0;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const abs of walk(path.join(dir, name))) {
      const rel = path.relative(path.join(dir, name), abs).split(path.sep).join('/');
      if (rel === INDEX) continue;
      await withRetry(async () => {
        const { error } = await sb.storage.from(name).upload(rel, fs.readFileSync(abs), { upsert: true, contentType: types[rel] ?? undefined });
        if (error) throw new Error(error.message);
      }, `upload ${name}/${rel}`);
      n++;
    }
    result.push({ bucket: name, objects: n, expected: expected[name] ?? idx.objects?.length ?? null });
    console.log(`storage: restored ${name} (${n} objects)`);
  }
  const bad = result.filter((r) => r.expected != null && r.expected !== r.objects);
  const check = {
    kind: 'storage',
    status: bad.length ? 'fail' : 'pass',
    detail: bad.length ? `${bad.length} bucket(s) differ: ${bad.map((b) => `${b.bucket} ${b.objects}/${b.expected}`).join(', ')}` : `${result.length} buckets, ${result.reduce((a, r) => a + r.objects, 0)} objects restored`,
    data: { buckets: result },
  };
  if (flag('--out')) fs.writeFileSync(flag('--out'), JSON.stringify([check], null, 2));
}

const run = cmd === 'download' ? download : cmd === 'upload' ? upload : null;
if (!run) { console.error('usage: storage.mjs download|upload …'); process.exit(1); }
run().catch((e) => { console.error(e.message); process.exit(1); });
