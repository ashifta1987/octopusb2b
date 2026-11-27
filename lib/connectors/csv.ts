/**
 * C0 · CSV file connector (client-safe, pure). Reuses the Warehouse OS CSV splitter (lib/warehouse-orders.ts splitCsv) and the
 * Dropship CSV writer (lib/dropship-ds12-shared.ts toCsv, formula-safe). Orders: one row per product line; rows with the same
 * order_id form one order. Every problem names its CSV row number (row 1 = the header).
 */
import { splitCsv } from '@/lib/warehouse-orders';
import { decimalToMinor } from './formats';
import type { InternalOrder } from './types';

export const ORDERS_CSV_MAX_BYTES = 1_000_000;
export const ORDERS_CSV_MAX_ORDERS = 200;

export type OrderField =
  | 'order_id' | 'order_name' | 'buyer_name' | 'buyer_phone' | 'address1' | 'address2' | 'city' | 'region' | 'postcode' | 'country'
  | 'currency' | 'fx_rate_to_usd' | 'sku' | 'qty' | 'unit_price' | 'line_paid' | 'shipping_method';

export const ORDER_FIELDS: { key: OrderField; label: string; required: boolean; hint: string; aliases: string[] }[] = [
  { key: 'order_id', label: 'Order ID', required: true, hint: 'Your store order number. Rows with the same ID form one order.', aliases: ['order_id', 'order', 'order number', 'order_number', 'order no', 'name', 'id'] },
  { key: 'order_name', label: 'Order name', required: false, hint: 'Shown to you, e.g. #1001.', aliases: ['order_name', 'order name', 'reference'] },
  { key: 'buyer_name', label: 'Buyer name', required: true, hint: '', aliases: ['buyer_name', 'buyer', 'customer', 'customer name', 'shipping name', 'ship_name', 'full name'] },
  { key: 'buyer_phone', label: 'Buyer phone', required: false, hint: '', aliases: ['buyer_phone', 'phone', 'shipping phone', 'telephone'] },
  { key: 'address1', label: 'Address line 1', required: true, hint: '', aliases: ['address1', 'address 1', 'address', 'street', 'shipping address1', 'shipping street'] },
  { key: 'address2', label: 'Address line 2', required: false, hint: '', aliases: ['address2', 'address 2', 'shipping address2', 'apartment'] },
  { key: 'city', label: 'City', required: true, hint: '', aliases: ['city', 'shipping city', 'town'] },
  { key: 'region', label: 'Region / state', required: false, hint: '', aliases: ['region', 'state', 'province', 'shipping province', 'emirate'] },
  { key: 'postcode', label: 'Postcode', required: false, hint: '', aliases: ['postcode', 'zip', 'postal code', 'shipping zip', 'post code'] },
  { key: 'country', label: 'Country (2 letters)', required: true, hint: 'AE, SA, GB, US …', aliases: ['country', 'country code', 'shipping country', 'shipping country code'] },
  { key: 'currency', label: 'Currency', required: true, hint: 'The currency the buyer paid in (USD, AED …).', aliases: ['currency', 'order currency'] },
  { key: 'fx_rate_to_usd', label: 'FX rate to USD', required: false, hint: 'Needed when the currency is not USD: 1 unit of the currency in USD.', aliases: ['fx_rate_to_usd', 'fx rate', 'rate to usd', 'usd rate'] },
  { key: 'sku', label: 'DS variant model no.', required: true, hint: 'Like DS-000001-01. Other SKUs are counted as "not from Octopus".', aliases: ['sku', 'model_no', 'model no', 'variant sku', 'lineitem sku', 'ds model'] },
  { key: 'qty', label: 'Quantity', required: true, hint: '', aliases: ['qty', 'quantity', 'lineitem quantity'] },
  { key: 'unit_price', label: 'Price the buyer paid (each)', required: true, hint: 'Required: customs declares what the buyer paid.', aliases: ['unit_price', 'price', 'unit price', 'lineitem price', 'item price'] },
  { key: 'line_paid', label: 'Line total paid (after discount)', required: false, hint: 'When set, this is the customs value of the line.', aliases: ['line_paid', 'line total', 'line_total', 'paid', 'lineitem total'] },
  { key: 'shipping_method', label: 'Shipping method', required: false, hint: 'economy, standard or express (else your default).', aliases: ['shipping_method', 'shipping', 'shipping method', 'method'] },
];

export const ORDERS_CSV_TEMPLATE = [
  ORDER_FIELDS.map((f) => f.key).join(','),
  '1001,#1001,Sara Ahmed,+971500000000,12 Marina Walk,,Dubai,Dubai,,AE,AED,0.2723,DS-000001-01,1,99.00,,standard',
].join('\r\n') + '\r\n';

export type ColumnMap = Partial<Record<OrderField, number>>;
const norm = (s: string) => s.toLowerCase().replace(/^\ufeff/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Guesses which CSV column holds each field from the header names. */
export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  const h = header.map(norm);
  for (const f of ORDER_FIELDS) {
    for (const alias of f.aliases) {
      const i = h.findIndex((x, idx) => !used.has(idx) && x === norm(alias));
      if (i >= 0) { map[f.key] = i; used.add(i); break; }
    }
  }
  return map;
}

export function missingRequired(map: ColumnMap): OrderField[] {
  return ORDER_FIELDS.filter((f) => f.required && map[f.key] == null).map((f) => f.key);
}

export type ParsedCsvOrder = { rows: number[]; order: InternalOrder };
export type OrdersCsvParse = { header: string[]; totalRows: number; orders: ParsedCsvOrder[]; errors: { row: number; message: string }[] };

/** Reads an orders CSV with a column map. Checks the shape (required cells, numbers, one address per order, buyer price on every line). */
export function parseOrdersCsv(text: string, map?: ColumnMap, maxOrders = ORDERS_CSV_MAX_ORDERS): OrdersCsvParse {
  const rows = splitCsv(text.replace(/^\ufeff/, ''));
  const header = (rows[0] ?? []).map((c) => c.trim());
  const errors: OrdersCsvParse['errors'] = [];
  const cols = map ?? guessColumns(header);
  const miss = missingRequired(cols);
  const body = rows.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => r.some((c) => c.trim() !== ''));
  if (miss.length) {
    errors.push({ row: 1, message: `Choose a column for: ${miss.map((k) => ORDER_FIELDS.find((f) => f.key === k)!.label).join(', ')}.` });
    return { header, totalRows: body.length, orders: [], errors };
  }
  const cell = (r: string[], k: OrderField) => (cols[k] == null ? '' : (r[cols[k]!] ?? '').trim());
  const byId = new Map<string, ParsedCsvOrder & { addrKey: string }>();
  for (const { r, row } of body) {
    const id = cell(r, 'order_id');
    const problems: string[] = [];
    if (!id) problems.push('the order ID is empty');
    else if (id.length > 64) problems.push('the order ID is longer than 64 characters');
    const country = cell(r, 'country').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) problems.push('the country must be a 2-letter code like AE');
    const currency = cell(r, 'currency').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) problems.push('the currency must be a 3-letter code like USD');
    const qtyRaw = cell(r, 'qty');
    const qty = /^\d{1,4}$/.test(qtyRaw) ? Number(qtyRaw) : NaN;
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) problems.push('the quantity must be a whole number from 1 to 999');
    const sku = cell(r, 'sku');
    if (!sku) problems.push('the SKU is empty');
    const unit = decimalToMinor(cell(r, 'unit_price'), currency || 'USD');
    if (unit == null) problems.push('the price the buyer paid is missing or not a number (customs declares what the buyer paid)');
    const paidRaw = cell(r, 'line_paid');
    const paid = paidRaw === '' ? null : decimalToMinor(paidRaw, currency || 'USD');
    if (paidRaw !== '' && paid == null) problems.push('the line total is not a number');
    const fxRaw = cell(r, 'fx_rate_to_usd');
    const fx = fxRaw === '' ? null : Number(fxRaw.replace(',', '.'));
    if (fxRaw !== '' && !(fx != null && Number.isFinite(fx) && fx > 0 && fx < 100000)) problems.push('the FX rate must be a number above 0');
    if (currency && currency !== 'USD' && fx == null) problems.push(`the FX rate to USD is needed for ${currency}`);
    const method = cell(r, 'shipping_method').toLowerCase();
    if (method && !['economy', 'standard', 'express'].includes(method)) problems.push('the shipping method must be economy, standard or express');
    if (!cell(r, 'buyer_name')) problems.push('the buyer name is empty');
    if (!cell(r, 'address1')) problems.push('address line 1 is empty');
    if (!cell(r, 'city')) problems.push('the city is empty');
    if (problems.length) { errors.push({ row, message: `${problems.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) }); continue; }
    const addrKey = [cell(r, 'buyer_name'), cell(r, 'address1'), cell(r, 'address2'), cell(r, 'city'), cell(r, 'postcode'), country, currency].join('|').toLowerCase();
    let o = byId.get(id);
    if (!o) {
      if (byId.size >= maxOrders) { errors.push({ row, message: `More than ${maxOrders} orders in one file. Split the file.` }); continue; }
      o = {
        rows: [], addrKey,
        order: {
          externalOrderId: id, externalOrderName: cell(r, 'order_name') || null, currency, fxRateToUsd: currency === 'USD' ? null : fx,
          buyerName: cell(r, 'buyer_name'), buyerPhone: cell(r, 'buyer_phone') || null,
          address: { name: cell(r, 'buyer_name'), phone: cell(r, 'buyer_phone') || null, line1: cell(r, 'address1'), line2: cell(r, 'address2') || null,
            city: cell(r, 'city'), region: cell(r, 'region') || null, postcode: cell(r, 'postcode') || null, country },
          shippingMethod: (method || null) as InternalOrder['shippingMethod'],
          lines: [],
        },
      };
      byId.set(id, o);
    } else if (o.addrKey !== addrKey) {
      errors.push({ row, message: `Order ${id} has a different buyer, address or currency than its first row.` });
      continue;
    }
    o.rows.push(row);
    o.order.lines.push({ modelNo: sku.toUpperCase(), qty, buyerUnitPriceMinor: unit, buyerPaidMinor: paid });
  }
  // an order with a bad row is not imported half: drop it and say which rows
  const badRows = new Set(errors.map((e) => e.row));
  const orders: ParsedCsvOrder[] = [];
  for (const o of byId.values()) {
    const rowsOfOrder = body.filter(({ r }) => cell(r, 'order_id') === o.order.externalOrderId).map((x) => x.row);
    const bad = rowsOfOrder.filter((n) => badRows.has(n));
    if (bad.length) {
      errors.push({ row: o.rows[0], message: `Order ${o.order.externalOrderId} is skipped because row${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'have' : 'has'} a problem.` });
      continue;
    }
    orders.push({ rows: o.rows, order: o.order });
  }
  errors.sort((a, b) => a.row - b.row);
  return { header, totalRows: body.length, orders, errors };
}

/** Product feed CSV (the merchant's copy, for stores without a connector). */
export const PRODUCT_FEED_HEADERS = ['Handle (DS model no.)', 'Variant SKU', 'DS variant model no.', 'Title', 'Description', 'Option', 'Price', 'Compare-at price', 'Currency', 'Weight (g)', 'Type', 'Vendor', 'Tags'];
/** Tracking CSV (to upload into the store): the company comes from carrier_tracking_names, the link is the merchant-branded /t/ page. */
export const TRACKING_CSV_HEADERS = ['Store order ID', 'Store order name', 'Octopus order', 'Tracking number', 'Tracking company', 'Tracking URL', 'Shipped (UTC)'];
