#!/usr/bin/env node
// Phase 2 Batch 1 (F-04 + Public Sourcing URLs):
// Copies leaky product images (SKU/factory/supplier tokens in path) to random UUID paths,
// updates product_media.url / products.image_url, strips SKUs/factory tokens from products.slug,
// and populates product_slug_redirects for permanent HTTP 301 redirects.
//
// STAGING ONLY by default (.env.local / .env.staging + assertStagingDatabase).
// Refuses LIVE unless BOTH `--env .env.live` AND `--allow-live` are passed.
// Usage:
//   node scripts/migrate-public-sourcing-urls.mjs [--dry-run] [--delete-old] [--verify-url http://localhost:3000]
//   node scripts/migrate-public-sourcing-urls.mjs --env .env.live --allow-live [--dry-run] [--delete-old]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { cleanProductSlug, extractForbiddenSlugTokens } from '../lib/slug.ts';
import {
  LIVE_PROJECT_REF,
  assertLiveDatabase,
  assertStagingDatabase,
  loadLiveEnvOrExit,
  stagingEnvProblem,
} from './lib-staging-guard.mjs';
import { config } from 'dotenv';

const argv = process.argv.slice(2);
const argVal = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const envFile = argVal('--env') || '.env.local';
const allowLive = argv.includes('--allow-live');
const dryRun = argv.includes('--dry-run');
const deleteOld = argv.includes('--delete-old');
const verifyBaseUrl = (argVal('--verify-url') || '').replace(/\/+$/, '');
const explicitBackupDir = argVal('--backup-dir');

const isLiveMode = envFile === '.env.live' || allowLive;
if (isLiveMode) {
  if (!(envFile === '.env.live' && allowLive)) {
    console.error('✘ refused: LIVE mode requires BOTH `--env .env.live` AND `--allow-live`.');
    process.exit(1);
  }
  loadLiveEnvOrExit(['--live']);
} else {
  if (!fs.existsSync(envFile)) {
    console.error(`✘ refused: env file "${envFile}" not found`);
    process.exit(1);
  }
  config({ path: envFile, quiet: true, override: true });
  const why = stagingEnvProblem(process.env);
  if (why) {
    console.error(`✘ refused: ${why} — default mode only runs against STAGING.`);
    process.exit(1);
  }
}

const TARGET_SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!TARGET_SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error('✘ missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL');
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

if (isLiveMode) {
  await assertLiveDatabase(db);
} else {
  await assertStagingDatabase(db);
  if (TARGET_SUPABASE_URL.includes(LIVE_PROJECT_REF)) {
    console.error('✘ refused: target Supabase URL points to LIVE in staging mode.');
    process.exit(1);
  }
}

const sb = createClient(TARGET_SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const toSlugPart = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLeakyUrl(url, extraTokens = []) {
  if (!url) return false;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const m = /\/storage\/v1\/object\/public\/[^/]+\/(.+)$/.exec(pathname);
  const relPath = m ? decodeURIComponent(m[1]) : decodeURIComponent(pathname);

  if (/^import\//i.test(relPath) || /\/import\//i.test(relPath)) return true;
  if (/\bcn-[a-z]{2}-[a-z0-9-]+/i.test(relPath)) return true;
  if (/\boct-[a-z0-9-]+/i.test(relPath)) return true;

  const lowerRel = relPath.toLowerCase();
  const baseName = (relPath.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase();
  for (const raw of extraTokens) {
    if (!raw) continue;
    const rawStr = String(raw).trim().toLowerCase();
    if (!rawStr || rawStr.length < 3) continue;
    // Exact UUID folder (e.g. `${supplierId}/...`) or SKU/manufacturer token in path/filename
    if (rawStr.length >= 8 && lowerRel.includes(rawStr)) return true;
    const norm = toSlugPart(rawStr);
    if (norm.length >= 3 && (lowerRel.includes(norm) || baseName === norm || baseName.startsWith(`${norm}-`) || baseName.startsWith(`${norm}_`))) {
      return true;
    }
  }
  return false;
}

function isLeakySlug(slug, p) {
  const sl = String(slug || '').toLowerCase();
  if (!sl) return false;
  if (/(^|-)cn-[a-z]{2}-/i.test(sl)) return true;
  if (/(^|-)oct-[a-z0-9-]+/i.test(sl)) return true;

  const tokens = extractForbiddenSlugTokens([
    p.sku,
    p.external_id,
    p.factory_model,
    p.sup_code,
    p.sup_ext,
    p.manufacturer_code,
  ]);
  for (const tok of tokens) {
    if (new RegExp(`(^|-)${escapeRegex(tok)}(?=-|$)`).test(sl)) return true;
  }

  // Detect old commit_import_run() truncation where external_id got cut to a trailing prefix like "-c", "-cn", "-cn-gd"
  const extNorm = toSlugPart(p.external_id || '');
  const titleNorm = toSlugPart(p.title || '');
  if (extNorm && titleNorm && sl.startsWith(titleNorm) && sl.length > titleNorm.length + 1) {
    const tail = sl.slice(titleNorm.length + 1);
    if (tail && extNorm.startsWith(tail)) return true;
  }
  return false;
}

function parseStorageRef(url) {
  try {
    const u = new URL(url);
    const m = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (!m) return null;
    return {
      origin: u.origin,
      bucket: m[1],
      objectPath: decodeURIComponent(m[2]),
    };
  } catch {
    return null;
  }
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

const envLabel = isLiveMode ? 'live' : 'staging';
const defaultBackupDir = `/Users/ashifabdulkhadar/.gemini/antigravity/brain/c63540fe-3817-4890-b5da-ff5fb71cd375/scratch/batch1-media-backup-${envLabel}`;
const backupDir = explicitBackupDir || defaultBackupDir;
const filesBackupDir = path.join(backupDir, 'files');

const products = (
  await db.query(`
    select p.id, p.slug, p.title, p.status, p.sku, p.external_id, p.factory_model, p.image_url, p.supplier_id,
           s.code as sup_code, s.external_id as sup_ext, s.manufacturer_code
      from public.products p
      left join public.suppliers s on s.id = p.supplier_id
     order by p.slug
  `)
).rows;

const productById = new Map(products.map((p) => [p.id, p]));

const mediaRows = (
  await db.query(`
    select id, product_id, url, storage_path, source_file_name
      from public.product_media
     order by product_id, sort, id
  `)
).rows;

const dropshipRows = (
  await db.query(`
    select dp.id, dp.model_no, dp.images, dp.supplier_id, dp.supplier_sku, dp.octopus_sku, dp.legacy_sku
      from public.dropship_products dp
     order by dp.id
  `)
).rows;

// Collect every leaky image URL across products.image_url, product_media.url, and dropship_products.images
const urlToMeta = new Map();
const addLeakyUrl = (url, prodTokens) => {
  if (!url) return;
  if (!isLeakyUrl(url, prodTokens)) return;
  if (!urlToMeta.has(url)) {
    const parsed = parseStorageRef(url);
    const baseName = decodeURIComponent(String(url).split('/').pop() || '').split('?')[0];
    const ext = (baseName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    urlToMeta.set(url, {
      oldUrl: url,
      bucket: parsed?.bucket || 'product-media',
      oldOrigin: parsed?.origin || null,
      oldObjectPath: parsed?.objectPath || null,
      sourceFileName: baseName || null,
      ext: ext === 'jpeg' ? 'jpg' : ext,
      newKey: null,
      newUrl: null,
      sha256: null,
      bytes: null,
      backupFile: null,
    });
  }
};

for (const p of products) {
  if (p.image_url) {
    addLeakyUrl(p.image_url, [p.supplier_id, p.sku, p.external_id, p.sup_code, p.sup_ext, p.manufacturer_code]);
  }
}
for (const m of mediaRows) {
  const p = productById.get(m.product_id);
  const tokens = p ? [p.supplier_id, p.sku, p.external_id, p.sup_code, p.sup_ext, p.manufacturer_code] : [];
  addLeakyUrl(m.url, tokens);
}
for (const d of dropshipRows) {
  for (const img of Array.isArray(d.images) ? d.images : []) {
    addLeakyUrl(img, [d.supplier_id, d.supplier_sku, d.octopus_sku, d.legacy_sku]);
  }
}

// Compute leaky slug updates (collision-safe via unique product id suffix if needed)
const existingSlugs = new Set(products.map((p) => p.slug));
const slugUpdates = [];
for (const p of products) {
  if (!isLeakySlug(p.slug, p)) continue;
  const suffix = String(p.id).replace(/-/g, '').slice(0, 8);
  let newSlug = cleanProductSlug(
    p.title || 'product',
    [p.sku, p.external_id, p.factory_model, p.sup_code, p.sup_ext, p.manufacturer_code],
    suffix,
  );
  if (existingSlugs.has(newSlug) && newSlug !== p.slug) {
    newSlug = `${newSlug}-${crypto.randomUUID().slice(0, 4)}`;
  }
  existingSlugs.add(newSlug);
  slugUpdates.push({
    id: p.id,
    status: p.status,
    title: p.title,
    oldSlug: p.slug,
    newSlug,
  });
}

// Also list target storage objects currently under import/ (important for live release backup/cleanup)
const storageImportObjects = (
  await db.query(`
    select bucket_id, name
      from storage.objects
     where bucket_id in ('product-media', 'dropship-media')
       and (name like 'import/%' or name ~* '(^|/)(cn-[a-z]{2}-|oct-)')
     order by bucket_id, name
  `)
).rows;

console.log(
  JSON.stringify(
    {
      mode: isLiveMode ? 'LIVE' : 'STAGING',
      dryRun,
      deleteOld,
      leakyUniqueImageUrls: urlToMeta.size,
      leakySlugCount: slugUpdates.length,
      leakyLiveSlugCount: slugUpdates.filter((s) => s.status === 'live').length,
      targetStorageLeakyObjects: storageImportObjects.length,
    },
    null,
    2,
  ),
);

if (dryRun) {
  console.log('\nSample slug updates (first 10):');
  console.log(JSON.stringify(slugUpdates.slice(0, 10), null, 2));
  console.log('\nAll truncated/non-cn slug updates:');
  console.log(JSON.stringify(slugUpdates.filter((s) => !/(^|-)cn-[a-z]{2}-/i.test(s.oldSlug)), null, 2));
  await db.end();
  process.exit(0);
}

// Ensure target bucket `product-media` exists and is public
const { data: buckets } = await sb.storage.listBuckets();
if (!buckets?.some((b) => b.id === 'product-media')) {
  const { error: bErr } = await sb.storage.createBucket('product-media', { public: true });
  if (bErr) throw new Error(`createBucket product-media failed: ${bErr.message}`);
}

// 1. BACKUP FIRST (referenced leaky URLs + any additional target storage leaky objects)
fs.mkdirSync(filesBackupDir, { recursive: true });

for (const entry of urlToMeta.values()) {
  const res = await fetch(entry.oldUrl);
  if (!res.ok) {
    throw new Error(`Backup download failed (${res.status}) for ${entry.oldUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`Downloaded 0 bytes for ${entry.oldUrl}`);
  }
  entry.bytes = buf.byteLength;
  entry.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const safeSub = (entry.oldObjectPath || `${entry.sha256}.${entry.ext}`).replace(/[^a-zA-Z0-9._/-]/g, '_');
  const dest = path.join(filesBackupDir, entry.bucket, safeSub);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  entry.backupFile = dest;
  entry._buf = buf;
}

// Back up any unreferenced leaky objects sitting in target storage.objects too
const backedTargetOrphans = [];
for (const obj of storageImportObjects) {
  const relDest = path.join(filesBackupDir, 'target-storage-orphans', obj.bucket_id, obj.name.replace(/[^a-zA-Z0-9._/-]/g, '_'));
  if (!fs.existsSync(relDest)) {
    const { data, error } = await sb.storage.from(obj.bucket_id).download(obj.name);
    if (error || !data) {
      throw new Error(`Failed backing up target storage object ${obj.bucket_id}/${obj.name}: ${error?.message || 'empty'}`);
    }
    const buf = Buffer.from(await data.arrayBuffer());
    fs.mkdirSync(path.dirname(relDest), { recursive: true });
    fs.writeFileSync(relDest, buf);
  }
  backedTargetOrphans.push({ bucket: obj.bucket_id, name: obj.name, backupFile: relDest });
}

// 2. COPY TO RANDOM UUID PATHS ON TARGET STORAGE ONLY
for (const entry of urlToMeta.values()) {
  const newKey = `products/${crypto.randomUUID()}.${entry.ext}`;
  const contentType = MIME_BY_EXT[entry.ext] || 'image/jpeg';
  const up = await sb.storage.from(entry.bucket).upload(newKey, entry._buf, {
    contentType,
    upsert: false,
  });
  if (up.error) {
    throw new Error(`Upload to ${entry.bucket}/${newKey} failed: ${up.error.message}`);
  }
  const { data: pub } = sb.storage.from(entry.bucket).getPublicUrl(newKey);
  entry.newKey = newKey;
  entry.newUrl = pub.publicUrl;
  delete entry._buf;
}

// 3. UPDATE TARGET DB INSIDE ONE TRANSACTION
const updatedProductsImages = [];
const updatedMediaRows = [];
const updatedDropshipImages = [];

await db.query('begin');
try {
  for (const m of mediaRows) {
    const entry = urlToMeta.get(m.url);
    if (!entry) continue;
    await db.query(
      `update public.product_media
          set url = $2,
              storage_path = $3,
              source_file_name = coalesce(source_file_name, $4)
        where id = $1`,
      [m.id, entry.newUrl, entry.newKey, entry.sourceFileName],
    );
    updatedMediaRows.push({ id: m.id, product_id: m.product_id, oldUrl: m.url, newUrl: entry.newUrl, newKey: entry.newKey });
  }

  for (const p of products) {
    const entry = urlToMeta.get(p.image_url);
    if (!entry) continue;
    await db.query(`update public.products set image_url = $2, updated_at = now() where id = $1`, [p.id, entry.newUrl]);
    updatedProductsImages.push({ id: p.id, oldUrl: p.image_url, newUrl: entry.newUrl });
  }

  for (const d of dropshipRows) {
    const imgs = Array.isArray(d.images) ? d.images : [];
    let changed = false;
    const nextImgs = imgs.map((u) => {
      const entry = urlToMeta.get(u);
      if (entry) {
        changed = true;
        return entry.newUrl;
      }
      return u;
    });
    if (changed) {
      await db.query(`update public.dropship_products set images = $2::text[], updated_at = now() where id = $1`, [d.id, nextImgs]);
      updatedDropshipImages.push({ id: d.id, model_no: d.model_no, images: nextImgs });
    }
  }

  for (const s of slugUpdates) {
    await db.query(
      `insert into public.product_slug_redirects(old_slug, product_id)
       values ($1, $2)
       on conflict (old_slug) do update set product_id = excluded.product_id`,
      [s.oldSlug.toLowerCase(), s.id],
    );
    await db.query(`update public.products set slug = $2, updated_at = now() where id = $1`, [s.id, s.newSlug]);
  }

  await db.query('commit');
} catch (err) {
  await db.query('rollback');
  throw err;
}

// 4. VERIFY EVERY NEW IMAGE RETURNS HTTP 200 BEFORE ANY DELETION
const imageChecks = [];
for (const entry of urlToMeta.values()) {
  const r = await fetch(entry.newUrl);
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !ct.startsWith('image/')) {
    throw new Error(`New image verification failed (${r.status}, ${ct}) for ${entry.newUrl}`);
  }
  imageChecks.push({ newUrl: entry.newUrl, status: r.status, contentType: ct });
}

// Optional live HTTP page + 301 + canonical + sitemap checks when `--verify-url` is supplied
const routeChecks = [];
if (verifyBaseUrl) {
  const smRes = await fetch(`${verifyBaseUrl}/sitemap.xml`);
  if (!smRes.ok) throw new Error(`Sitemap check failed (${smRes.status})`);
  const smXml = await smRes.text();
  for (const s of slugUpdates.filter((x) => x.status === 'live')) {
    if (smXml.includes(`/p/${s.oldSlug}</loc>`)) {
      throw new Error(`Sitemap still contains old slug /p/${s.oldSlug}`);
    }
    if (!smXml.includes(`/p/${s.newSlug}</loc>`)) {
      throw new Error(`Sitemap missing new slug /p/${s.newSlug}`);
    }
    const rOld = await fetch(`${verifyBaseUrl}/p/${s.oldSlug}`, { redirect: 'manual' });
    const loc = rOld.headers.get('location') || '';
    if (rOld.status !== 301 || !loc.endsWith(`/p/${s.newSlug}`)) {
      throw new Error(`301 redirect check failed for /p/${s.oldSlug}: got ${rOld.status} -> ${loc}`);
    }
    const rNew = await fetch(`${verifyBaseUrl}/p/${s.newSlug}`);
    const html = await rNew.text();
    if (rNew.status !== 200 || !html.includes(`/p/${s.newSlug}`)) {
      throw new Error(`New product page check failed (${rNew.status}) for /p/${s.newSlug}`);
    }
    if (/\/import\/|CN-GD-BWJ/i.test(html)) {
      throw new Error(`Rendered HTML for /p/${s.newSlug} still contains /import/ or CN-GD-BWJ`);
    }
    routeChecks.push({ oldSlug: s.oldSlug, newSlug: s.newSlug, redirectStatus: rOld.status, newStatus: rNew.status });
  }
}

// 5. DELETE OLD STORAGE FILES ONLY WHEN `--delete-old` IS EXPLICITLY SET AND ONLY ON TARGET STORAGE
const deletedFromTargetStorage = [];
const skippedCrossProjectDeletes = [];
if (deleteOld) {
  const toDelete = new Map(); // bucket -> Set(objectPath)
  const queueDelete = (bucket, objectPath) => {
    if (!toDelete.has(bucket)) toDelete.set(bucket, new Set());
    toDelete.get(bucket).add(objectPath);
  };
  for (const entry of urlToMeta.values()) {
    if (!entry.oldUrl.startsWith(TARGET_SUPABASE_URL)) {
      skippedCrossProjectDeletes.push({ bucket: entry.bucket, objectPath: entry.oldObjectPath, origin: entry.oldOrigin });
      continue;
    }
    if (entry.oldObjectPath) queueDelete(entry.bucket, entry.oldObjectPath);
  }
  for (const obj of backedTargetOrphans) {
    // Only delete if no remaining DB row references this path in the target project
    const refUrl = `${TARGET_SUPABASE_URL}/storage/v1/object/public/${obj.bucket}/${obj.name}`;
    const stillRef = (
      await db.query(
        `select (exists (select 1 from public.products where image_url = $1)
             or exists (select 1 from public.product_media where url = $1)) as used`,
        [refUrl],
      )
    ).rows[0]?.used;
    if (!stillRef) queueDelete(obj.bucket, obj.name);
  }
  for (const [bucket, pathsSet] of toDelete.entries()) {
    const arr = [...pathsSet];
    for (let i = 0; i < arr.length; i += 100) {
      const chunk = arr.slice(i, i + 100);
      const { error } = await sb.storage.from(bucket).remove(chunk);
      if (error) throw new Error(`Storage remove failed in ${bucket}: ${error.message}`);
      for (const p of chunk) deletedFromTargetStorage.push({ bucket, objectPath: p });
    }
  }
}

const manifest = {
  executedAt: new Date().toISOString(),
  mode: isLiveMode ? 'LIVE' : 'STAGING',
  targetSupabaseUrl: TARGET_SUPABASE_URL,
  backupDir,
  summary: {
    migratedUniqueImages: urlToMeta.size,
    updatedProductImageRows: updatedProductsImages.length,
    updatedProductMediaRows: updatedMediaRows.length,
    updatedDropshipProductRows: updatedDropshipImages.length,
    migratedSlugs: slugUpdates.length,
    migratedLiveSlugs: slugUpdates.filter((s) => s.status === 'live').length,
    verifiedNewImages200: imageChecks.length,
    verifiedRoutes301And200: routeChecks.length,
    deletedFromTargetStorage: deletedFromTargetStorage.length,
    skippedCrossProjectDeletes: skippedCrossProjectDeletes.length,
    backedUpTargetOrphans: backedTargetOrphans.length,
  },
  images: [...urlToMeta.values()].map((e) => ({
    oldUrl: e.oldUrl,
    oldBucket: e.bucket,
    oldObjectPath: e.oldObjectPath,
    newKey: e.newKey,
    newUrl: e.newUrl,
    sourceFileName: e.sourceFileName,
    sha256: e.sha256,
    bytes: e.bytes,
    backupFile: e.backupFile,
  })),
  slugs: slugUpdates,
  deletedFromTargetStorage,
  skippedCrossProjectDeletes,
  backedUpTargetOrphans: backedTargetOrphans,
};

const manifestPath = path.join(backupDir, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('Manifest written:', manifestPath);
console.log(JSON.stringify(manifest.summary, null, 2));

await db.end();
