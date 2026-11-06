// ADDON-29 round trip (read-only): export Bowijie with the "pre-filled" template → parse it back → diff against the
// live database = zero creates / updates. Then change one price cell → exactly one price UPDATE, everything else SKIP.
import ExcelJS from 'exceljs';
import { config } from 'dotenv'; import { createClient } from '@supabase/supabase-js';
import { exportSupplierWorkbookData } from '../../lib/import/export.ts';
import { buildTemplate } from '../../lib/import/template.ts';
import { parseWorkbook } from '../../lib/import/parse-workbook.ts';
import { computeDiff } from '../../lib/import/core.ts';
config({ path: '.env.local', quiet: true });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ok = (c, m) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };

const { data: sup } = await sb.from('suppliers').select('id, code').eq('external_id', 'CN-GD-BWJ-0010').single();
const { data: pv } = await sb.from('supplier_product_prices').select('valid_from').eq('supplier_id', sup.id).eq('is_superseded', false).limit(1).single();
const data = await exportSupplierWorkbookData(sb, sup.id);
const buf = await buildTemplate(data);
ok(data.rows.length === 69, `pre-filled export has all 69 Bowijie products (${sup.code})`);

const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
ok(wb.worksheets[0].name === 'README' && wb.worksheets[1].name === 'Supplier', `sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);

const opts = { validFrom: pv.valid_from, validDays: 30, outlierX: 3, imageFiles: null };
const batch = await parseWorkbook(buf, opts);
ok(batch.errors.length === 0, `export parses without errors${batch.errors.length ? ': ' + batch.errors.slice(0, 3).map((e) => e.message).join(' | ') : ''}`);
const d = await computeDiff(sb, batch);
const summary = (t) => `${t.create}/${t.update}/${t.skip}`;
ok(d.suppliers.create + d.suppliers.update === 0 && d.products.create + d.products.update === 0 && d.supplier_products.create + d.supplier_products.update === 0
   && d.prices.create + d.prices.update === 0 && d.images.create === 0,
  `unedited round trip changes nothing (create/update/skip — products ${summary(d.products)}, links ${summary(d.supplier_products)}, prices ${summary(d.prices)}, images ${summary(d.images)})`);
if (d.changes?.length) console.log('  first changes:', JSON.stringify(d.changes.slice(0, 5)));

// edit one price cell (F9: EXW 4.61 → 4.70) and re-parse
for (const ws of wb.worksheets) ws.eachRow((row) => { if (row.getCell(1).value === 'CN-GD-BWJ-F9') row.getCell(5).value = 4.7; });
const edited = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), opts);
const d2 = await computeDiff(sb, edited);
const priceChanges = (d2.changes ?? []).filter((c) => c.field.startsWith('price'));
ok(d2.prices.update === 1 && d2.prices.create === 0 && d2.products.update === 0 && d2.products.skip === 69 && priceChanges.length === 1 && priceChanges[0].external_id === 'CN-GD-BWJ-F9',
  `one edited price → exactly 1 price UPDATE (${priceChanges.map((c) => `${c.external_id} ${c.field}: ${c.from} → ${c.to}`).join('')}); all products SKIP`);

// category rule: a filled, different category cell is a (highlighted) change; a blank one keeps the current category
for (const ws of wb.worksheets) ws.eachRow((row) => { if (row.getCell(1).value === 'CN-GD-BWJ-F9') { row.getCell(5).value = 4.61; row.getCell(4).value = 'Kitchen'; } });
const d3 = await computeDiff(sb, await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), opts));
const cat3 = (d3.changes ?? []).filter((c) => c.field === 'category');
ok(cat3.length === 1 && cat3[0].external_id === 'CN-GD-BWJ-F9' && cat3[0].to === 'Kitchen' && d3.products.update === 1, `a different category cell shows as a category change (${cat3.map((c) => `${c.from} → ${c.to}`).join('')})`);
for (const ws of wb.worksheets) ws.eachRow((row) => { if (row.getCell(1).value === 'CN-GD-BWJ-F9') row.getCell(4).value = null; });
const d4 = await computeDiff(sb, await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), opts));
ok(!(d4.changes ?? []).some((c) => c.field === 'category'), 'a blank category cell keeps the current category (no change)');

