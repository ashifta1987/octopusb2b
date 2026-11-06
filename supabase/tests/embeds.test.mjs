// Regression (6 Nov 2026): products ↔ suppliers has two relationships since ADDON-27 (products.supplier_id and the
// supplier_products link table). An un-hinted `suppliers(...)` embed on products fails with PGRST201 and pages showed
// empty lists. Checks every products→suppliers embed used by the app through the real REST API.
import { config } from 'dotenv'; import fs from 'node:fs'; import path from 'node:path';
config({ path: '.env.local', quiet: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let failed = 0; const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) failed++; };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = ['app', 'components', 'lib'].flatMap(walk);
const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\('products'\)\s*\.select\((['`])([^'`]*)\1/g)) {
    if (/(^|[\s,(])suppliers\(/.test(m[2])) bad.push(`${f}: ${m[2].slice(0, 80)}`);
  }
}
ok(bad.length === 0, `no un-hinted suppliers(...) embed on products in the code${bad.length ? ': ' + bad.join(' | ') : ''}`);
const r = await fetch(`${URL_}/rest/v1/products?select=id,suppliers!products_supplier_id_fkey(code)&limit=1`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
ok(r.ok, `hinted embed works through the REST API (${r.status})`);
console.log(failed ? `\nembeds: ${failed} check(s) failed` : '\nembeds: all passed');
process.exitCode = failed ? 1 : 0;
