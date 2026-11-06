import ExcelJS from 'exceljs';
import { median, parsePriceOptions, toPriceMinor } from './parse-prices.ts';
import { parseSpecs, splitSizeNotes } from './parse-specs.ts';
import type {
  Contact, ImportOptions, Incoterm, ListingStatus, NameVariant, StagedImage, StagedPrice, StagedProduct, StagedReview,
  StagedSupplier, StagingBatch, SupplierProductStatus,
} from './types.ts';

/**
 * Supplier workbook → StagingBatch (ADDON-27 §3 step 2 / §4a).
 *  - "Supplier" sheet: key/value rows, then a block of company-name variants and an EXCLUSIVITY block.
 *  - Product sheets: any sheet whose A1 is "Product Id". Columns are read by header name, so column order may vary.
 *  - A sheet without a price column ("Not Quoted") produces needs_quote products with no price rows.
 *  - A blank cell is null, never zero.
 */

type Cell = string | number | null;

function cellText(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const o = v as { richText?: { text: string }[]; text?: string; result?: unknown; hyperlink?: string };
  if (o.richText) { const t = o.richText.map((r) => r.text).join('').trim(); return t || null; }
  if (o.text != null) return String(o.text).trim() || null;
  if (o.result != null) return typeof o.result === 'number' ? o.result : String(o.result).trim() || null;
  return null;
}
const str = (v: Cell) => (v == null ? null : String(v).trim() || null);
const num = (v: Cell) => (v == null ? null : typeof v === 'number' ? v : Number.isFinite(Number(String(v).replace(/,/g, ''))) ? Number(String(v).replace(/,/g, '')) : null);

const PROVINCES: Record<string, string> = {
  GD: 'Guangdong', ZJ: 'Zhejiang', JS: 'Jiangsu', FJ: 'Fujian', SD: 'Shandong', SH: 'Shanghai', BJ: 'Beijing', HB: 'Hubei', HN: 'Hunan', HE: 'Hebei', AH: 'Anhui', SC: 'Sichuan',
};
const CITIES = ['Shenzhen', 'Guangzhou', 'Dongguan', 'Foshan', 'Huizhou', 'Zhongshan', 'Shantou', 'Ningbo', 'Yiwu', 'Hangzhou', 'Wenzhou', 'Taizhou', 'Suzhou', 'Xiamen', 'Shanghai', 'Qingdao'];

function seenIn(label: string): string {
  const l = label.toLowerCase();
  if (/quotation|quote/.test(l)) {
    const d = /(\d{4})[.\-/](\d{1,2})/.exec(label);
    const what = /fan/.test(l) ? 'fan_quotation' : 'quotation';
    return d ? `${what}_${d[1]}_${d[2].padStart(2, '0')}` : what;
  }
  if (/dashboard|platform|octopus/.test(l)) return 'octopus_b2b_dashboard';
  if (/catalogue|catalog|brochure|pptx/.test(l)) return 'catalogue_pptx';
  return l.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'unknown';
}

function parseSupplier(ws: ExcelJS.Worksheet | undefined, warnings: string[]): { supplier: StagedSupplier; exclusivityFlag: string | null } {
  const kv = new Map<string, Cell>();
  const variants: NameVariant[] = [];
  let section = '';
  let exclusivityFlag: string | null = null;
  ws?.eachRow((row) => {
    const k = str(cellText(row.getCell(1).value));
    const v = cellText(row.getCell(2).value);
    if (!k) return;
    if (v == null) { section = k.toUpperCase(); return; }
    if (/NAMES IN CIRCULATION|NAME VARIANTS|COMPANY NAMES/.test(section) && !/^why/i.test(k)) {
      const [name, ...addr] = String(v).split(/\s+[—–]\s+/);
      // "Weite Shijia (深圳市维特世嘉科技有限公司)" → "Weite Shijia 深圳市维特世嘉科技有限公司"
      const clean = name.replace(/\s*[（(]([^）)]*[\u3400-\u9fff][^）)]*)[）)]/g, ' $1').replace(/\s+/g, ' ').trim();
      variants.push({ variant_name: clean, variant_address: addr.join(' — ').trim() || null, seen_in: seenIn(k) });
      return;
    }
    if (/EXCLUSIVITY/.test(section) && /status/i.test(k)) {
      const q = /["“]([^"”]{6,80})["”]/.exec(String(v));
      if (q) exclusivityFlag = q[1].trim();
      return;
    }
    kv.set(k.toLowerCase(), v);
  });
  const get = (...keys: string[]) => { for (const k of keys) { const v = kv.get(k.toLowerCase()); if (v != null) return str(v); } return null; };
  const external = get('Supplier ID', 'Supplier Id') ?? 'UNKNOWN-SUPPLIER';
  if (external === 'UNKNOWN-SUPPLIER') warnings.push('Supplier sheet has no "Supplier ID" — using UNKNOWN-SUPPLIER');
  const contactRaw = get('Contact');
  const [contactName, ...roleParts] = (contactRaw ?? '').split(/,\s*/);
  const phone = get('Phone / WeChat', 'Phone', 'Mobile');
  const wechat = get('WeChat') ?? (/(we\s*chat)/i.test([...kv.keys()].join(' ')) ? phone : null);
  const email = get('Email', 'E-mail');
  const idParts = external.split('-');
  const country = /^[A-Z]{2}$/.test(idParts[0] ?? '') ? idParts[0] : null;
  const province = PROVINCES[idParts[1] ?? ''] ?? null;
  const firstAddr = variants[0]?.variant_address ?? '';
  const city = CITIES.find((c) => firstAddr.includes(c)) ?? null;
  const distinctNames = new Set(variants.map((x) => x.variant_name.toLowerCase()));
  const contacts: Contact[] = contactName ? [{ name: contactName.trim(), role: roleParts.join(', ').trim() || null, phone, wechat, email, is_primary: true }] : [];
  return {
    exclusivityFlag,
    supplier: {
      external_id: external,
      manufacturer_code: get('Manufacturer code'),
      legal_name: variants[0]?.variant_name ?? get('Legal name', 'Company') ?? external,
      country, province, city,
      handle: get('Handle'),
      status: distinctNames.size > 1 ? 'needs_identity_review' : 'ok',
      notes: distinctNames.size > 1 ? `${distinctNames.size === 3 ? 'Three' : distinctNames.size} legal-name variants in circulation; confirm the entity that signs contracts before first order ships.` : null,
      contact_name: contacts[0]?.name ?? null, contact_email: email, contact_phone: phone,
      name_variants: variants,
      contacts,
    },
  };
}

function headerMap(ws: ExcelJS.Worksheet) {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => { const h = str(cellText(c.value)); if (h) map.set(h.toLowerCase(), col); });
  return map;
}

function sheetIncoterm(sheet: string): Incoterm {
  return /fan/i.test(sheet) ? 'EXW' : 'FOB';
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer, opts: ImportOptions): Promise<StagingBatch> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const warnings: string[] = [];
  const { supplier, exclusivityFlag } = parseSupplier(wb.getWorksheet('Supplier'), warnings);
  const validTo = (() => {
    if (!opts.validDays) return null;
    const d = new Date(`${opts.validFrom}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + opts.validDays - 1);
    return d.toISOString().slice(0, 10);
  })();

  const products: StagedProduct[] = [];
  const prices: StagedPrice[] = [];
  const images: StagedImage[] = [];
  const review: StagedReview[] = [];
  const seen = new Set<string>();

  for (const ws of wb.worksheets) {
    if (str(cellText(ws.getCell('A1').value))?.toLowerCase() !== 'product id') continue;
    const h = headerMap(ws);
    const col = (...names: string[]) => { for (const n of names) { const i = h.get(n.toLowerCase()); if (i) return i; } return 0; };
    const c = {
      id: col('Product Id'), model: col('Factory model'), name: col('Product name (live on platform)', 'Product name'), cat: col('Category'),
      price: col('Price USD', 'Price'), quote: col('Price options as quoted', 'Price options'), moq: col('MOQ'), image: col('Image file'),
      net: col('Net weight'), size: col('Product size (mm)'), box: col('Colour box (mm)'), carton: col('Carton size (mm)'),
      qty: col('Qty / carton'), gross: col('Gross weight'), spec: col('Specification (supplier)', 'Specification (from catalogue)', 'Specification'),
      selling: col('Selling points (supplier)', 'Selling points'), excl: col('Exclusive channels'), platform: col('Platform status'),
      notes: col('Notes / discrepancies', 'Why it is not listable yet', 'Notes'),
    };
    const quoted = c.price > 0 || c.quote > 0;
    const defaultInc = sheetIncoterm(ws.name);
    const sheetPrices: { external_id: string; price: number }[] = [];

    ws.eachRow((row, r) => {
      if (r === 1) return;
      const v = (i: number) => (i ? cellText(row.getCell(i).value) : null);
      const id = str(v(c.id));
      if (!id) return;
      if (seen.has(id)) { warnings.push(`${ws.name} row ${r}: duplicate Product Id ${id} skipped`); return; }
      seen.add(id);
      const notes = str(v(c.notes));
      const size = splitSizeNotes(str(v(c.size)));
      const model = str(v(c.model));
      const priceParse = quoted
        ? parsePriceOptions(str(v(c.quote)), { priceColumn: num(v(c.price)), defaultIncoterm: defaultInc, defaultMoq: num(v(c.moq)) })
        : { rows: [], noPrice: true, warnings: [] as string[] };
      priceParse.warnings.forEach((w) => warnings.push(`${id}: ${w}`));
      const inDev = /in development/i.test(`${model ?? ''} ${notes ?? ''}`);
      const listing: ListingStatus = !quoted ? 'needs_quote' : inDev ? 'in_development' : priceParse.noPrice ? 'needs_quote' : 'draft';
      const supStatus: SupplierProductStatus = !quoted ? 'needs_quote' : priceParse.noPrice ? 'no_price' : 'quoted';
      const moqs = priceParse.rows.map((p) => p.moq);
      products.push({
        external_id: id, sheet: ws.name, factory_model: model, supplier_model: model, name: str(v(c.name)), category: str(v(c.cat)),
        image_file: str(v(c.image)), net_weight: str(v(c.net)), product_size_mm: size.value, size_notes: size.notes,
        colour_box_mm: str(v(c.box)), carton_size_mm: str(v(c.carton)), qty_per_carton: str(v(c.qty)), gross_weight: str(v(c.gross)),
        specification_raw: str(v(c.spec)), selling_points_raw: str(v(c.selling)), exclusive_channels: str(v(c.excl)),
        exclusivity_flag: quoted ? exclusivityFlag : null, platform_status: str(v(c.platform)),
        listing_status: listing, supplier_status: supStatus,
        moq: moqs.length ? Math.max(...moqs) : num(v(c.moq)),
        incoterm: priceParse.rows[0]?.incoterm ?? (quoted ? defaultInc : null),
        notes, specs: parseSpecs(str(v(c.spec))),
      });
      for (const p of priceParse.rows) {
        prices.push({ external_id: id, incoterm: p.incoterm, moq_tier_min: p.moq, variant_label: p.variant, price_minor: toPriceMinor(p.price),
          currency: 'USD', valid_from: opts.validFrom, valid_to: validTo });
      }
      if (priceParse.rows.length) sheetPrices.push({ external_id: id, price: Math.min(...priceParse.rows.map((p) => p.price)) });
      const img = str(v(c.image));
      if (img) images.push({ external_id: id, file: img, sort: 1, role: 'primary' });
      if (notes && quoted) review.push({ external_id: id, kind: inDev ? 'in_development' : 'note', issue: notes, evidence: `${ws.name} sheet — Notes / discrepancies` });
    });

    // outlier rule: lowest quoted price above X × the sheet median
    const med = median(sheetPrices.map((s) => s.price));
    for (const sp of sheetPrices) {
      if (med > 0 && sp.price > opts.outlierX * med) {
        review.push({ external_id: sp.external_id, kind: 'outlier',
          issue: `Price ${sp.price} is ${(sp.price / med).toFixed(1)}× the ${ws.name} median (${med}). Confirm with the supplier before publishing.`,
          evidence: `${ws.name} sheet — price outlier rule (> ${opts.outlierX}× median)` });
      }
    }
  }

  const available = opts.imageFiles ? new Set(opts.imageFiles.map((f) => f.split('/').pop()!.toLowerCase())) : null;
  const referenced = new Set(images.map((i) => i.file.toLowerCase()));
  const missing = available ? images.filter((i) => !available.has(i.file.toLowerCase())).map((i) => i.file) : [];
  const unmatched = opts.imageFiles ? opts.imageFiles.map((f) => f.split('/').pop()!).filter((f) => f && !f.startsWith('.') && !referenced.has(f.toLowerCase())) : [];
  if (missing.length) warnings.push(`${missing.length} image file(s) named in the workbook are not in the ZIP: ${missing.slice(0, 10).join(', ')}`);

  return {
    supplier, products, prices,
    images: available ? images.filter((i) => available.has(i.file.toLowerCase())) : images,
    review, valid_from: opts.validFrom, valid_to: validTo, warnings, unmatched_images: unmatched, missing_images: missing,
  };
}
