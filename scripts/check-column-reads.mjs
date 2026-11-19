// Finds app code that reads a customer-hidden column with a signed-in (session) or public Supabase client.
// The hidden columns are revoked from the `anon` and `authenticated` roles (see migration 195), so such a read would
// fail at runtime; staff screens must read them with the server admin client after their own permission check.
// It also checks that scripts/hidden-columns.mjs matches the grants in the STAGING database. Like every other staging
// script it goes through lib-staging-guard.mjs and refuses unless the Supabase URL and the database are staging.
// Usage: node scripts/check-column-reads.mjs [--json]    (exit 1 when anything is found)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { HIDDEN_COLUMNS } from './hidden-columns.mjs';
import { loadStagingEnvOrExit, assertStagingDatabase } from './lib-staging-guard.mjs';

loadStagingEnvOrExit();                                 // stops unless the Supabase URL + database are the staging project

const roots = ['app', 'components', 'lib'];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
roots.forEach((r) => fs.existsSync(r) && walk(r));

/** Removes the argument of .insert(...) / .update(...) / .upsert(...) (balanced parentheses) from a chain. */
function stripWritePayload(chain) {
  let out = chain;
  for (let guard = 0; guard < 10; guard++) {
    const w = out.match(/\.(insert|update|upsert)\(/);
    if (!w) break;
    let i = w.index + w[0].length, depth = 1;
    while (i < out.length && depth > 0) { if (out[i] === '(') depth++; else if (out[i] === ')') depth--; i++; }
    // keep upsert conflict targets: ON CONFLICT reads those columns
    const conflict = out.slice(w.index, i).match(/onConflict\s*:\s*['`][^'`]*['`]/g) ?? [];
    out = out.slice(0, w.index) + `.${w[1]}__written(${conflict.join(', ')})` + out.slice(i);
  }
  return out;
}

const findings = [];
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  // .select(SOME_CONSTANT): inline string constants declared in the same file, so their columns are checked too
  const consts = new Map();
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string)?\s*=\s*(['`])((?:(?!\2)[\s\S])*?)\2/g)) if (!m[3].includes('${')) consts.set(m[1], m[3]);
  if (consts.size) src = src.replace(/\.select\(\s*([A-Z][A-Z0-9_]*)\b/g, (all, name) => (consts.has(name) ? `.select('${consts.get(name).replace(/'/g, '')}'` : all));
  // which variables hold an admin (service-role) client in this file
  const admin = new Set(['admin', 'adm', 'svc', 'service']);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*(?::\s*[\w<>]+)?\s*=\s*(?:await\s+)?createAdminClient\(\)/g)) admin.add(m[1]);
  // parameters typed as the admin client:  type Sb = ReturnType<typeof createAdminClient>;  fn(sb: Sb)
  for (const t of src.matchAll(/type\s+(\w+)\s*=\s*ReturnType<typeof createAdminClient>/g))
    for (const m of src.matchAll(new RegExp(`(\\w+)\\s*:\\s*${t[1]}\\b`, 'g'))) admin.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?create(?:Public)?Client\(\)/g)) admin.delete(m[1]);
  // every .from('table') call with the text of its chain (up to the end of the statement)
  for (const m of src.matchAll(/(\w+|\))\s*\.from\(\s*'(\w+)'\s*\)/g)) {
    const v = m[1];
    const viaAdmin = admin.has(v) || /createAdminClient\(\)\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index + v.length))
      // public API (app/api/v1/**, lib/api/**): `ctx.sb` is the service-role client from lib/api/auth.ts (ApiContext.sb)
      || (v === 'sb' && /^(app[\\/]api[\\/]v1|lib[\\/]api)[\\/]/.test(f) && /\bctx\.$/.test(src.slice(Math.max(0, m.index - 4), m.index)));
    if (viaAdmin) continue;
    const rest = src.slice(m.index, m.index + 1500);
    const end = rest.search(/;\s*\n|\n\s*\n|,\s*\n\s*(?:sb|admin|supabase)\./);
    const chain = end > 0 ? rest.slice(0, end) : rest.slice(0, 600);
    const line = src.slice(0, m.index).split('\n').length;
    const check = (table, text) => {
      const cols = HIDDEN_COLUMNS[table];
      if (!cols) return;
      if (/\.select\(\s*\)|\.select\(\s*'\*'|\.select\(\s*`\*`|\*\s*,|,\s*\*/.test(text) && table === m[2]) findings.push({ file: f, line, table, column: '*' });
      for (const c of cols) if (new RegExp(`(?<![\\w.])${c}(?![\\w])`).test(text)) findings.push({ file: f, line, table, column: c });
    };
    // writes do not need SELECT on the column unless they return it; only flag reads (select / filters / order)
    const isWrite = /\.(insert|update|upsert|delete)\(/.test(chain) && !/\)\s*\.select\(/.test(chain);
    // a write that returns rows (`.update({...}).select('id')`): the payload is written, not read — check only the rest
    if (!isWrite) check(m[2], stripWritePayload(chain));
    // embedded tables inside a select string:  table(cols) / table!fk(cols) / alias:table(cols)
    const sel = chain.match(/\.select\(\s*['`]([\s\S]*?)['`]/);
    if (sel) for (const e of sel[1].matchAll(/(\w+)(?:!\w+)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      const cols = HIDDEN_COLUMNS[e[1]];
      if (!cols) continue;
      if (/(^|,)\s*\*\s*(,|$)/.test(e[2])) findings.push({ file: f, line, table: e[1], column: '* (embedded)' });
      for (const c of cols) if (new RegExp(`(^|[\\s,])${c}([\\s,]|$)`).test(e[2])) findings.push({ file: f, line, table: e[1], column: `${c} (embedded)` });
    }
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 1));
else for (const x of findings) console.log(`${x.file}:${x.line}  ${x.table}.${x.column}`);
console.error(`${findings.length} session/public read(s) of hidden columns`);

// the list must match what the staging database actually hides
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await assertStagingDatabase(db);
let drift = 0;
for (const [t, cols] of Object.entries(HIDDEN_COLUMNS)) {
  const hidden = (await db.query(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1
    and not has_column_privilege('authenticated', format('public.%I', $1::text), column_name, 'SELECT') order by 1`, [t])).rows.map((r) => r.c);
  if (JSON.stringify(hidden) !== JSON.stringify([...cols].sort())) { drift++; console.error(`✘ ${t}: staging hides [${hidden}] — list says [${[...cols].sort()}]`); }
}
await db.end();
console.error(drift ? `${drift} table(s) differ from the staging database` : `hidden-columns list matches the staging database (${Object.keys(HIDDEN_COLUMNS).length} tables)`);
process.exitCode = findings.length || drift ? 1 : 0;
