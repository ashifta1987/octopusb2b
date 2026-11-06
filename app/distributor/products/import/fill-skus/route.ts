import ExcelJS from 'exceljs';
import { getSession } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { XLSX_HEADERS } from '@/components/backoffice/product-workbook';
import { categoryCode, nextSkus, normalizeSku } from '@/lib/sku';

/** "Generate SKUs" (ADDON-33 §3): upload your filled template; every row without a SKU gets <CATEGORY CODE>-<running number>
 *  (e.g. FST-000123), checked against every SKU ever used on the platform (sku_reservations) and against the file itself. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || (!s.isAdmin && !s.roles.includes('distributor'))) return new Response('Forbidden', { status: 403 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get('file');
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > 4 * 1024 * 1024) return new Response('Upload the filled template (.xlsx, up to 4 MB).', { status: 400 });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return new Response('Could not read this file.', { status: 400 }); }
  const ws = wb.getWorksheet('Products') ?? wb.worksheets[0];
  if (!ws) return new Response('No Products sheet.', { status: 400 });
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => header.set(String(c.value ?? '').trim().toLowerCase(), col));
  const skuCol = header.get('sku'); const catCol = header.get('category_path');
  if (!skuCol || !catCol) return new Response('The sheet needs "sku" and "category_path" columns — download the latest template.', { status: 400 });

  const blanks: { row: ExcelJS.Row; prefix: string }[] = [];
  const inFile = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const sku = normalizeSku(String(row.getCell(skuCol).text ?? ''));
    const hasData = (row.values as unknown[]).slice(1).some((v, i) => i + 1 !== skuCol && v != null && String(v).trim() !== '');
    if (sku) inFile.add(sku);
    else if (hasData) blanks.push({ row, prefix: categoryCode(String(row.getCell(catCol).text ?? '').split('>')[0]) });
  });
  const admin = createAdminClient();
  const prefixes = [...new Set(blanks.map((b) => b.prefix))];
  const pool = new Map<string, string[]>();
  for (const p of prefixes) {
    const { data } = await admin.rpc('skus_with_prefix', { p_prefix: p });
    const taken = [...((data ?? []) as string[]), ...inFile];
    pool.set(p, nextSkus(p, taken, blanks.filter((b) => b.prefix === p).length));
  }
  for (const b of blanks) { const sku = pool.get(b.prefix)!.shift()!; b.row.getCell(skuCol).value = sku; }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: { ...XLSX_HEADERS(file.name.replace(/\.xlsx$/i, '') + '-with-skus.xlsx'), 'X-Skus-Generated': String(blanks.length) },
  });
}

