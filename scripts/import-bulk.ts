// ADDON-27 CLI: re-run a supplier bulk import from a workbook + image ZIP (same pipeline as /admin/import).
// Usage: pnpm import:bulk --xlsx data/bulk/bowijie/source.xlsx --images data/bulk/bowijie/images.zip
//          [--name "Bowijie 2026-11"] [--valid-from 2026-11-01] [--operator admin@demo.octopusb2b.com] [--commit=true]
// Without --commit=true it only prints the diff. With it, it asks for confirmation (or --yes) and commits.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { commitImport, stageImport } from '../lib/import/core.ts';

config({ path: '.env.local', quiet: true });
const arg = (k: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = process.argv.indexOf(k);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? 'true' : next;
};

const xlsxPath = arg('--xlsx');
if (!xlsxPath) { console.error('✘ --xlsx <workbook.xlsx> is required'); process.exit(2); }
const zipPath = arg('--images');
const commit = arg('--commit') === 'true';
const now = new Date();
const validFrom = arg('--valid-from') ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
const name = arg('--name') ?? `${xlsxPath.split('/').pop()} (${validFrom})`;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const opEmail = arg('--operator');
let actor: string | null = null;
if (opEmail) {
  const { data } = await sb.from('profiles').select('id').ilike('email', opEmail).maybeSingle();
  actor = (data?.id as string | undefined) ?? null;
  if (!actor) { console.error(`✘ operator ${opEmail} not found`); process.exit(2); }
}

const xlsx = new Uint8Array(fs.readFileSync(xlsxPath));
const zip = zipPath ? new Uint8Array(fs.readFileSync(zipPath)) : null;
const { runId, batch, diff } = await stageImport(sb, { name, xlsx, zip, validFrom, actor, source: { cli: true, xlsx: xlsxPath, images: zipPath ?? null } });

console.log(`\nImport run ${runId} — "${name}"  (prices valid ${batch.valid_from} → ${batch.valid_to ?? 'open'})`);
console.log(`Supplier ${batch.supplier.external_id} "${batch.supplier.legal_name}"${batch.supplier.status === 'needs_identity_review' ? ` — ${batch.supplier.name_variants.length} legal-name variants, needs identity review` : ''}`);
for (const [t, d] of Object.entries(diff)) {
  if (t === 'review') continue;
  const x = d as { create: number; update: number; skip: number; conflicts?: string[] };
  console.log(`  ${t.padEnd(18)} create ${String(x.create).padStart(3)}   update ${String(x.update).padStart(3)}   skip ${String(x.skip).padStart(3)}`);
  x.conflicts?.slice(0, 5).forEach((c) => console.log(`      ! ${c}`));
}
console.log(`  review items       ${diff.review.total} (${Object.entries(diff.review.by_kind).map(([k, v]) => `${k} ${v}`).join(', ')}; ${diff.review.already_known} already known)`);
batch.warnings.forEach((w) => console.log(`  ⚠ ${w}`));

if (!commit) { console.log('\nDry run — nothing written except the preview record. Re-run with --commit=true to commit.'); process.exit(0); }
if (arg('--yes') !== 'true') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ok = await rl.question('Commit this import? Type "commit": ');
  rl.close();
  if (ok.trim() !== 'commit') { console.log('Not committed.'); process.exit(1); }
}
const report = await commitImport(sb, { runId, actor, zip });
console.log('✔ committed:', JSON.stringify(report));

