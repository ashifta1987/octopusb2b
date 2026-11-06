import 'server-only';
import ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_RULES } from './import-columns';
import { INCOTERMS, UNITS } from './product-schema';
import { CURRENCIES } from '@/lib/format';

/**
 * Bulk product workbook v2 (ADDON-33, matches docs/design/octopus-product-template_v2.xlsx): Products (23 columns, SKU first,
 * frozen at C2, drop-downs, duplicate / missing-SKU highlighting, SKU length + no-space check), Lists, Instructions.
 * Used for the blank template and for "Download my products" (same layout → edit and re-upload round-trips).
 */
export async function buildProductWorkbook(opts: { categoryPaths: string[]; supplierCodes: string[]; rows: Record<string, string | number | null>[] }) {
  const { categoryPaths: paths, supplierCodes, rows } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octopus B2B';
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11133C' } };
  for (const r of rows) ws.addRow(r);

  const lists = wb.addWorksheet('Lists');
  lists.getColumn(1).values = ['category_path', ...paths];
  lists.getColumn(2).values = ['supplier_code', ...supplierCodes];
  lists.getColumn(3).values = ['unit', ...UNITS];
  lists.getColumn(4).values = ['incoterm', ...INCOTERMS];
  lists.getColumn(5).values = ['yes_no', 'yes', 'no'];
  lists.getColumn(6).values = ['currency', ...CURRENCIES];
  [1, 2, 3, 4, 5, 6].forEach((i) => (lists.getColumn(i).width = i === 1 ? 60 : 16));
  lists.getRow(1).font = { bold: true };

  const last = Math.max(1000, rows.length + 200);
  const L = (key: string) => ws.getColumn(key).letter;
  const dv = (key: string, ref: string) => { for (let r = 2; r <= last; r++) ws.getCell(`${L(key)}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [ref] }; };
  dv('category_path', `Lists!$A$2:$A$${paths.length + 1}`);
  if (supplierCodes.length) dv('supplier_code', `Lists!$B$2:$B$${supplierCodes.length + 1}`);
  dv('unit', `Lists!$C$2:$C$${UNITS.length + 1}`);
  dv('incoterm', `Lists!$D$2:$D$${INCOTERMS.length + 1}`);
  dv('octopus_dropship', 'Lists!$E$2:$E$3');
  dv('ready_to_ship', 'Lists!$E$2:$E$3');
  dv('currency', `Lists!$F$2:$F$${CURRENCIES.length + 1}`);
  // SKU: 3–40 characters, no spaces (Excel-side help; the server re-checks everything)
  for (let r = 2; r <= last; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'custom', allowBlank: true, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid SKU',
      error: 'SKU: 3-40 characters, letters/digits/dash/dot/underscore, no spaces.',
      formulae: [`AND(LEN(A${r})>=3,LEN(A${r})<=40,ISERROR(FIND(" ",A${r})))`],
    };
  }
  const lastCol = ws.getColumn(IMPORT_COLUMNS.length).letter;
  ws.addConditionalFormatting({
    ref: `A2:A${last}`,
    rules: [
      { type: 'expression', priority: 1, formulae: [`AND($A2<>"",COUNTIF($A$2:$A$${last},$A2)>1)`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' }, fgColor: { argb: 'FFFFC7CE' } }, font: { bold: true, color: { argb: 'FF9C0006' } } } },
      { type: 'expression', priority: 2, formulae: [`AND(COUNTA($B2:$${lastCol}2)>0,$A2="")`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' }, fgColor: { argb: 'FFFFC7CE' } } } },
    ],
  });

  const ins = wb.addWorksheet('Instructions');
  ins.getColumn(1).width = 22; ins.getColumn(2).width = 12; ins.getColumn(3).width = 110;
  const head = ins.addRow(['Column', 'Required', 'Notes']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF11133C' } };
  IMPORT_COLUMNS.forEach((c) => ins.addRow([c.key, c.required ? 'Required' : 'Optional', c.note]));
  ins.addRow([]);
  IMPORT_RULES.forEach((t) => ins.addRow(['', '', t]));
  ins.addRow(['', '', 'On an update, a blank optional cell (unit, lead time, incoterm, origin, HS code, description, image) keeps the current value.']);
  ins.eachRow((r) => { r.alignment = { wrapText: true, vertical: 'top' }; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_HEADERS = (filename: string) => ({
  'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition': `attachment; filename="${filename}"`,
  'Cache-Control': 'no-store',
});

