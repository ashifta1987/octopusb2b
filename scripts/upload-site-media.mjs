// Uploads the shipped site pictures to the media store and points each Site content key (site_media) at them.
//   node scripts/upload-site-media.mjs --staging      (staging)
//   node scripts/upload-site-media.mjs --live         (production; run at go-live)
// Files: public/images/services/<name>.webp → site-media/site/services/<name>.webp, octo → site/octo/.
// Idempotent (upsert). Each slot change is written to audit_log.
import fs from 'node:fs';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const target = process.argv.includes('--live') ? '.env.local' : process.argv.includes('--staging') ? '.env.staging' : null;
if (!target) throw new Error('Usage: --staging | --live');
const env = config({ path: target, quiet: true, processEnv: {} }).parsed ?? {};
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: slots, error } = await sb.from('site_media').select('key, default_src, path');
if (error) throw new Error(error.message);
let up = 0;
for (const s of slots) {
  const m = /^\/images\/(services|octo)\/([a-z0-9-]+\.webp)$/.exec(s.default_src);
  if (!m) { console.log(`  skip ${s.key} (${s.default_src})`); continue; }
  const local = `public${s.default_src}`;
  if (!fs.existsSync(local)) { console.log(`  missing file ${local}`); continue; }
  const path = `site/${m[1]}/${m[2]}`;
  const { error: e1 } = await sb.storage.from('site-media').upload(path, fs.readFileSync(local), { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
  if (e1) throw new Error(`${path}: ${e1.message}`);
  if (s.path !== path) {
    const { error: e2 } = await sb.from('site_media').update({ path, updated_at: new Date().toISOString() }).eq('key', s.key);
    if (e2) throw new Error(e2.message);
    await sb.from('audit_log').insert({ action: 'site_media.updated', entity: 'site_media', entity_id: null, details: { key: s.key, path, by: 'upload-site-media script' } });
  }
  up++; console.log(`  ✔ ${s.key} → ${path}`);
}
console.log(`uploaded ${up} pictures to ${target === '.env.local' ? 'LIVE' : 'staging'} site-media`);

