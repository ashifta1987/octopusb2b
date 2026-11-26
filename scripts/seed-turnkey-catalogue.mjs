#!/usr/bin/env node
// Loads the owner's 300-project Turnkey catalogue (data/turnkey/catalogue-300.json, from
// "300_Turnkey_Project_Ideas_–_China_Sourcing.xlsx", 26 Nov 2026) and the supplied project photos (data/turnkey/photos,
// projects 25–50) into turnkey_projects and the public site-media bucket (turnkey/catalogue/...).
// STAGING ONLY. Live runs only inside an approved release (the release plan calls the same steps with live credentials).
// Idempotent: existing projects keep their data (only a missing photo is filled) (use Admin › Turnkey › Catalogue › Import to change one).
// Unknown values stay empty (no starting budget, floor area or lead time in the owner's list).
//   node --env-file=.env.staging scripts/seed-turnkey-catalogue.mjs [--dry-run]
//   node scripts/seed-turnkey-catalogue.mjs --live [--dry-run]     (approved live release only)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { assertStagingOrThrow, loadLiveEnvOrExit, assertLiveDatabase } from './lib-staging-guard.mjs';

// --live: only inside an approved live release (loads .env.live and verifies the LIVE project). Default: staging only.
const isLive = process.argv.includes('--live');
const dry = process.argv.includes('--dry-run');
const data = JSON.parse(fs.readFileSync('data/turnkey/catalogue-300.json', 'utf8'));
const rows = data.projects;
if (rows.length !== 300) throw new Error(`expected 300 projects, found ${rows.length}`);

if (isLive) loadLiveEnvOrExit(); else await assertStagingOrThrow();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await (isLive ? assertLiveDatabase(db) : assertStagingOrThrow(db));

// 1. photos → site-media (public bucket used by the catalogue cards)
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let uploaded = 0;
for (const r of rows.filter((x) => x.image)) {
  const file = path.join('data/turnkey/photos', path.basename(r.image));
  if (!fs.existsSync(file)) throw new Error(`photo missing: ${file}`);
  if (dry) continue;
  const { error } = await sb.storage.from('site-media').upload(r.image.replace(/^turnkey\//, 'turnkey/'), fs.readFileSync(file), { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`upload ${r.image}: ${error.message}`);
  uploaded += 1;
}

// 2. projects (new ids only), one transaction, audit-logged
let added = 0;
let photosFilled = 0; // photos sent later in batches fill projects that had none (nothing else is overwritten)
try {
  await db.query('begin');
  for (const r of rows) {
    const res = await db.query(
      `insert into turnkey_projects (project_id, title, category, short_reason, hero_image_path, hero_image_alt, sort_rank, status, is_seed)
       values ($1, $2, $3, $4, $5, $6, $7, 'live', false)
       on conflict (project_id) do update set hero_image_path = excluded.hero_image_path, hero_image_alt = excluded.hero_image_alt, updated_at = now()
        where turnkey_projects.hero_image_path is null and excluded.hero_image_path is not null
       returning (xmax = 0) inserted`,
      [r.project_id, r.title, r.category, r.summary, r.image, r.image_alt, r.sort]);
    if (res.rows[0]?.inserted) added += 1; else if (res.rowCount) photosFilled += 1;
  }
  await db.query(`insert into audit_log (actor_id, action, entity, entity_id, details) values (null, 'turnkey.catalogue_seeded', 'turnkey_projects', null, $1)`,
    [JSON.stringify({ source: data.source, added, photos: uploaded, photos_filled: photosFilled })]);
  if (dry) await db.query('rollback'); else await db.query('commit');
} catch (e) {
  await db.query('rollback').catch(() => {});
  throw e;
} finally {
  await db.end();
}
console.log(`${dry ? '[dry run] ' : ''}projects added: ${added} of ${rows.length}; photos uploaded: ${uploaded}; photos filled on existing projects: ${photosFilled}`);
