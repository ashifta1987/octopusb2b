import ExcelJS from 'exceljs';

/**
 * Bulk-update workbook template (ADDON-29). Same structure as data/bulk/bowijie/source.xlsx:
 * README sheet first, a key/value "Supplier" sheet with a name-variants block, then category sheets that all carry
 * exactly the 20 columns below (Product Id = column 1, Image file = column 9). Pure module (relative imports only).
 */
export const TEMPLATE_COLUMNS = [
  'Product Id', 'Factory model', 'Product name (live on platform)', 'Category', 'Price USD', 'Price options as quoted', 'MOQ', 'Sample',
  'Image file', 'Net weight', 'Product size (mm)', 'Colour box (mm)', 'Carton size (mm)', 'Qty / carton', 'Gross weight',
  'Specification (supplier)', 'Selling points (supplier)', 'Exclusive channels', 'Platform status', 'Notes / discrepancies',
] as const;

export const REQUIRED_COLUMNS = new Set(['Product Id', 'Factory model', 'Category']);

const COLUMN_NOTES: Record<string, string> = {
  'Product Id': 'Required. Match key for updates, e.g. CN-GD-BWJ-F8 (<country>-<province>-<supplier code>-<model>). Unknown Id = new product; known Id = update.',
  'Factory model': "Required. The supplier's own model name or code.",
  'Product name (live on platform)': 'Fill only when verified. A blank cell never overwrites the existing product name.',
  Category: 'Required. Category name as shown in Admin → Categories & tags (new names are created switched off).',
  'Price USD': 'Supplier price (cost) in USD. Used when the quote text below has no labelled prices.',
  'Price options as quoted': 'Free text as quoted, e.g. "EXW, MOQ 3000" or "MOQ 3000 / Plug-in: 1.12 / Rechargeable: 1.5 | MOQ 1000 / Plug-in: 1.34 | FOB".',
  'Image file': 'File name in the companion .zip (e.g. F8.jpg), not a path. .jpg .jpeg .png .webp .avif, max 15 MB. Must match exactly, including case.',
  'Platform status': 'Optional: draft | published | needs_quote | in_development | needs_review.',
  'Notes / discrepancies': 'Anything that needs a decision. Every note becomes a review item that must be resolved before publishing.',
};

export const README_ROWS: ([string, string?] | [])[] = [
  ['Octopus B2B — supplier bulk update workbook'],
  [],
  ['HOW TO USE'],
  ['Key column', 'Product Id is the match key for a bulk update. Every other column is a value to write. A Product Id that does not exist yet creates a new (draft) product.'],
  ['Blank cells', 'A blank means the supplier did not provide that figure. It is not zero — do not fill it with one.'],
  ['Product name column', 'Fill only where you verified it. Blank = not verified, so the existing product name is kept.'],
  ['Description', 'Specification and Selling points are the raw supplier text to write from, not finished listing copy.'],
  ['Images', 'Put the photos in a separate .zip (any folder structure). Image file must match a file name in the zip exactly, including case.'],
  ['Sheets', 'One "Supplier" sheet plus one sheet per product category. Every category sheet has "Product Id" in cell A1. Items without a quote go on the "Not Quoted" sheet.'],
  ['Required columns', 'Yellow headers (Product Id, Factory model, Category) are required on every row.'],
  ['Prices', 'Prices are supplier costs (exclude tax and freight). Buyer prices are calculated by Octopus from the cost and the markup setting.'],
  [],
  ['SAVE AS', 'Save the workbook as .xlsx. Upload it at Admin → Bulk import together with the image .zip.'],
];

export type TemplateSupplier = {
  external_id: string | null; manufacturer_code: string | null; contact: string | null; phone: string | null; email: string | null; handle: string | null;
  variants: { variant_name: string; variant_address: string | null; seen_in: string | null; is_canonical: boolean }[];
  exclusivity_flag?: string | null;
};
export type TemplateRow = Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string | number | null>> & { sheet: string };

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } } as const;
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F3' } } as const;

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
export function safeSheetName(name: string) {
  return (name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Products').slice(0, 31);
}

function categorySheet(wb: ExcelJS.Workbook, name: string, rows: TemplateRow[]) {
  const ws = wb.addWorksheet(safeSheetName(name), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow([...TEMPLATE_COLUMNS]);
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  TEMPLATE_COLUMNS.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = REQUIRED_COLUMNS.has(col) ? YELLOW : GREY;
    if (COLUMN_NOTES[col]) cell.note = COLUMN_NOTES[col];
    ws.getColumn(i + 1).width = col.startsWith('Specification') || col.startsWith('Selling') ? 48 : col.startsWith('Product name') || col.startsWith('Price options') || col.startsWith('Notes') ? 36 : 16;
  });
  for (const r of rows) ws.addRow(TEMPLATE_COLUMNS.map((c) => r[c] ?? null));
  ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  return ws;
}

export async function buildTemplate(opts: { supplier?: TemplateSupplier | null; rows?: TemplateRow[] } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Octopus B2B';
  wb.created = new Date();

  const readme = wb.addWorksheet('README');
  README_ROWS.forEach((r) => readme.addRow(r));
  readme.getColumn(1).width = 22; readme.getColumn(2).width = 110;
  readme.getRow(1).font = { bold: true, size: 14 };
  readme.eachRow((row) => { if (row.getCell(2).value == null && row.getCell(1).value) row.font = { bold: true }; row.alignment = { wrapText: true, vertical: 'top' }; });

  const s = opts.supplier;
  const sup = wb.addWorksheet('Supplier');
  sup.addRow(['Supplier record']);
  sup.getRow(1).font = { bold: true };
  const kv: [string, string | null][] = [
    ['Supplier ID', s?.external_id ?? null], ['Manufacturer code', s?.manufacturer_code ?? null], ['Contact', s?.contact ?? null],
    ['Phone / WeChat', s?.phone ?? null], ['Email', s?.email ?? null], ['Handle', s?.handle ?? null],
  ];
  kv.forEach(([k, v]) => sup.addRow([k, v]));
  sup.getCell('A2').fill = YELLOW;
  sup.getCell('A2').note = 'Required. Format <country>-<province>-<supplier code>-<seq>, e.g. CN-GD-BWJ-0010.';
  sup.addRow([]);
  sup.addRow(['NAME VARIANTS IN CIRCULATION']).font = { bold: true };
  sup.addRow(['Variant name', 'Address', 'Seen in', 'Canonical']).font = { bold: true };
  const variants = s?.variants ?? [];
  for (let i = 0; i < 5; i++) {
    const v = variants[i];
    sup.addRow(v ? [v.variant_name, v.variant_address, v.seen_in, v.is_canonical ? 'true' : 'false'] : []);
  }
  sup.addRow([]);
  sup.addRow(['EXCLUSIVITY']).font = { bold: true };
  sup.addRow(['Status', s?.exclusivity_flag ? `Every model in every quotation carries "${s.exclusivity_flag}".` : null]);
  sup.getColumn(1).width = 30; sup.getColumn(2).width = 70; sup.getColumn(3).width = 26; sup.getColumn(4).width = 12;

  const rows = opts.rows ?? [];
  const sheets = new Map<string, TemplateRow[]>();
  for (const r of rows) sheets.set(r.sheet, [...(sheets.get(r.sheet) ?? []), r]);
  if (!sheets.size) { sheets.set('Products', []); sheets.set('Not Quoted', []); }
  for (const [name, list] of sheets) categorySheet(wb, name, list);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { suggestProductId } from './product-id.ts';
