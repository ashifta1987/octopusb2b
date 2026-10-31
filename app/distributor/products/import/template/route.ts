import ExcelJS from 'exceljs';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getManagedSuppliers } from '@/components/backoffice/server-utils';
import { IMPORT_COLUMNS } from '@/components/backoffice/import-columns';
import { INCOTERMS, UNITS } from '@/components/backoffice/product-schema';

/** Excel template for bulk upload (BulkUpload.png): Products sheet + Instructions + lookup lists. */
export async function GET() {
  const s = await getSession();
  if (!s || (!s.isAdmin && !s.roles.includes('distributor'))) return new Response('Forbidden', { status: 403 });
  const sb = await createClient();
  const suppliers = await getManagedSuppliers(s);
  const { data: cats } = await sb.from('categories').select('id, name, parent_id, level').eq('active', true).order('sort');
  const byId = new Map((cats ?? []).map((c) => [c.id, c]));
  const pathOf = (id: string) => { const out: string[] = []; let c = byId.get(id); while (c) { out.unshift(c.name); c = c.parent_id ? byId.get(c.parent_id) : undefined; } return out.join(' > '); };
  const paths = (cats ?? []).map((c) => pathOf(c.id)).sort();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octopus B2B';
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11133C' } };
  const sample = suppliers[0]?.code ?? 'OCT-1101';
  ws.addRow({
    title: 'Stainless steel hex bolts, M10 × 40 mm, A2-70', category_path: paths.find((p) => p.split(' > ').length >= 3) ?? paths[0] ?? 'Fasteners > Bolts > Hex bolts',
    supplier_code: sample, unit: 'pcs', moq: 1000, lead_time_days: 15, incoterm: 'FOB', origin_country: 'CN', hs_code: '7318.15',
    tier1_qty: 1000, tier1_price_usd: 0.19, tier2_qty: 5000, tier2_price_usd: 0.16, tier3_qty: 10000, tier3_price_usd: 0.14,
    octopus_dropship: 'no', ready_to_ship: 'yes', description: 'Full-thread hex head bolts in A2-70 stainless steel to DIN 933 / ISO 4017.',
  });

  // lookup sheets + data validation drop-downs
  const lists = wb.addWorksheet('Lists');
  lists.getColumn(1).values = ['category_path', ...paths];
  lists.getColumn(2).values = ['supplier_code', ...suppliers.map((x) => x.code)];
  lists.getColumn(3).values = ['unit', ...UNITS];
  lists.getColumn(4).values = ['incoterm', ...INCOTERMS];
  lists.getColumn(5).values = ['yes_no', 'yes', 'no'];
  [1, 2, 3, 4, 5].forEach((i) => (lists.getColumn(i).width = i === 1 ? 60 : 16));
  lists.getRow(1).font = { bold: true };
  const colLetter = (key: string) => ws.getColumn(key).letter;
  const dv = (key: string, ref: string) => {
    for (let r = 2; r <= 1000; r++) ws.getCell(`${colLetter(key)}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref] };
  };
  dv('category_path', `Lists!$A$2:$A$${paths.length + 1}`);
  if (suppliers.length) dv('supplier_code', `Lists!$B$2:$B$${suppliers.length + 1}`);
  dv('unit', `Lists!$C$2:$C$${UNITS.length + 1}`);
  dv('incoterm', `Lists!$D$2:$D$${INCOTERMS.length + 1}`);
  dv('octopus_dropship', 'Lists!$E$2:$E$3');
  dv('ready_to_ship', 'Lists!$E$2:$E$3');

  const ins = wb.addWorksheet('Instructions');
  ins.getColumn(1).width = 22; ins.getColumn(2).width = 12; ins.getColumn(3).width = 90;
  ins.addRow(['Column', 'Required', 'Notes']).font = { bold: true };
  IMPORT_COLUMNS.forEach((c) => ins.addRow([c.key, c.required ? 'Required' : 'Optional', c.note]));
  ins.addRow([]);
  ins.addRow(['', '', 'One row per product. Rows are validated first; valid rows are imported as drafts, then you can submit them for moderation.']);
  ins.addRow(['', '', 'Tier quantities must go up (tier1 < tier2 < tier3). Prices are USD per unit.']);
  ins.addRow(['', '', 'Only suppliers assigned to you (with “product upload” switched on) are accepted.']);

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="octopus-product-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
