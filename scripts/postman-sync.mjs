#!/usr/bin/env node
/**
 * Postman sync (SPEC §15.2) — the repository is the source of truth.
 *
 *   node scripts/postman-sync.mjs            regenerate postman/*.json (OpenAPI + collections + environments) and,
 *                                            when POSTMAN_API_KEY + POSTMAN_WORKSPACE_ID are set, push them to Postman
 *   node scripts/postman-sync.mjs --check    fail (exit 1) when the committed postman/*.json files are out of date
 *   node scripts/postman-sync.mjs --no-push  regenerate files only
 *   node scripts/postman-sync.mjs --examples refresh postman/examples.json from seed data first (calls the real API
 *                                            handlers with a temporary sandbox key — needs .env.local / Supabase env)
 *
 * Push env: POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID, POSTMAN_COLLECTION_ID_PUBLIC, POSTMAN_COLLECTION_ID_SUPPLIER,
 *           POSTMAN_API_ID, POSTMAN_API_SCHEMA_ID, POSTMAN_ENVIRONMENT_ID_SANDBOX, POSTMAN_ENVIRONMENT_ID_LIVE (optional).
 * The result is logged to integration_logs (integration_code 'postman') when NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are available.
 *
 * Needs Node ≥ 22.18 (built-in TypeScript type stripping + module.registerHooks): the generator itself lives in
 * lib/api/{openapi,postman,postman-sync}.ts and is shared with the Next.js routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'postman');
const args = new Set(process.argv.slice(2));

// Resolve the app's `@/…` alias and extensionless TypeScript imports.
registerHooks({
  resolve(specifier, context, next) {
    let target = null;
    if (specifier.startsWith('@/')) target = path.join(root, specifier.slice(2));
    else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.endsWith('.ts'))
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (target && !path.extname(target)) {
      for (const c of [target + '.ts', path.join(target, 'index.ts')]) if (fs.existsSync(c)) return next(pathToFileURL(c).href, context);
    }
    if (target) return next(pathToFileURL(target).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return next(url, { ...context, format: 'module-typescript' });
    return next(url, context);
  },
});

function loadEnvFile() {
  const f = path.join(root, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function readExamples() {
  const f = path.join(outDir, 'examples.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

const stringify = (v) => JSON.stringify(v, null, 2) + '\n';

async function logResult(row) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 'skipped (no Supabase service-role env)';
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/integration_logs`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  return res.ok ? 'logged' : `log failed: HTTP ${res.status}`;
}

async function main() {
  loadEnvFile();
  if (args.has('--examples')) {
    console.log('› Refreshing postman/examples.json from seed data (real handlers, sandbox key)…');
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', '--config', 'tests/vitest.integration.config.ts', 'tests/integration/postman-examples.test.ts'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, WRITE_POSTMAN_EXAMPLES: '1' },
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  const { runPostmanSync, syncLogRow, syncSummary } = await import(pathToFileURL(path.join(root, 'lib/api/postman-sync.ts')).href);
  const examples = readExamples();
  const env = args.has('--check') || args.has('--no-push') ? {} : process.env;
  const { result, files } = await runPostmanSync({ env, examples });

  if (args.has('--check')) {
    const stale = Object.entries(files).filter(([name, json]) => {
      const f = path.join(outDir, name);
      return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== stringify(json);
    });
    if (stale.length) {
      console.error(`✗ postman/ is out of date: ${stale.map(([n]) => n).join(', ')}\n  Run: node scripts/postman-sync.mjs --no-push`);
      process.exit(1);
    }
    console.log(`✓ postman/ is up to date (${Object.keys(files).length} files)`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, json] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), stringify(json));
  console.log(`✓ wrote ${Object.keys(files).map((n) => 'postman/' + n).join(', ')}`);
  console.log(`› ${syncSummary(result)}`);
  for (const s of result.steps) console.log(`  - ${s.target}: ${s.action}${s.id ? ` (${s.id})` : ''}${s.error ? ` — ${s.error}` : ''}`);
  if (result.pushed) console.log(`› integration_logs: ${await logResult(syncLogRow(result, process.env.GITHUB_ACTIONS ? 'ci' : 'sync'))}`);
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
