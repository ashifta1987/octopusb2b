import 'server-only';
import { cache } from 'react';
import { isOptimizableImage } from '@octopus/ui/image-url';
import { createClient, createPublicClient } from '@/lib/supabase/server';
import { getShopViewer } from '@/lib/shop/data';
import { shopCan, ROLE_REASON } from '@/lib/shop/shared';
import { countryName } from '@/lib/factory-label';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { nowIso } from '@/lib/core/account';
import { priceForQuantity } from '../products/_lib/price';
import {
  BUY_KINDS, depositMinor, estimateDuty, fmtMinor, isBelowMoq, isMissingFunction, isMissingRelationOrColumn, lineTotalMinor,
  parseRecheck, pickNotice, summarise, type DutyInput, type RecheckNotice,
} from './cart-logic';
import { CUSTOMISATION_OPTIONS, type BuyKind, type BuyLine, type CartImage, type CartView, type QuoteLine } from './cart-types';

/**
 * ODS T5a · the company's cart (server only; call inside <Suspense> — it reads the session).
 *
 *   getCart({ recheck }) → CartView     React-cached per request and per `recheck`. `recheck: true` runs shop_cart_recheck()
 *                                       first (owner / buyer only — it changes lines) and puts its notices on the lines.
 *   buildCart(recheck)   → CartView     the same without React cache (server actions use it after a change).
 *
 * One cart per company: Buy now = shop_cart_items (via shop_cart_lines(), which also returns the current min / step / max and
 * availability from the source), Get a quote = quote_list_items, Saved for later = either kind with saved_for_later.
 * Before migration 253 exists the cart RPCs / tables are missing: the cart then shows the quote list only (today's
 * quote_list_items columns), ship-to = the company's country, and never throws for that.
 *
 * Data read (customer-safe only, Part 1 rule 7): shop_cart_lines() (ids, titles, slug, image, pool code, prices, limits),
 * shop_carts (ship_to_country, ship_to_city), quote_list_items (id, product_id, quantity, target_price_minor, customisation,
 * saved_for_later), products (id, slug, title, unit, moq, image_url, status, archived_at, hs_code), price_tiers (min_qty,
 * unit_price_cents, currency — next-tier note), pools (code, product_id — open pools), lookup_duty_rate (duty estimate).
 * Never supplier / factory names or codes, model numbers, cost or margin.
 */

type LineRow = {
  id: string; kind: string; ref_id: string; product_id: string | null; pool_id: string | null; qty: number; unit_price_minor: number | string;
  currency: string; saved_for_later: boolean; title: string | null; slug: string | null; image_url: string | null; unit: string | null;
  pool_code: string | null; deposit_pct: number | null; deposit_minor: number | string | null; min_qty: number | null; step_qty: number | null;
  max_qty: number | null; available: boolean | null; reason: string | null;
};
type QuoteRow = { id: string; product_id: string; quantity: number; target_price_minor?: number | string | null; customisation?: string | null; saved_for_later?: boolean | null };
type ProductRow = { id: string; slug: string; title: string; unit: string | null; moq: number | null; image_url: string | null; status: string; archived_at: string | null; hs_code: string | null };

const CUSTOM_IDS = new Set<string>(CUSTOMISATION_OPTIONS.map((o) => o.id));

function plural(unit: string | null | undefined, qty: number): string {
  const u = (unit || 'piece').trim().toLowerCase();
  const one = u === 'pcs' || u === 'pc' || u === 'pieces' ? 'piece' : u.length > 2 && u.endsWith('s') ? u.slice(0, -1) : u;
  return qty === 1 ? one : `${one}s`;
}

const image = (src: string | null | undefined, alt: string): CartImage | null =>
  src ? { src, alt, unoptimized: !isOptimizableImage(src) } : null;

function hrefFor(kind: BuyKind, slug: string | null, poolCode: string | null): string | null {
  if (kind === 'pool') return poolCode ? `/shop/pools/${encodeURIComponent(poolCode)}` : null;
  if (kind === 'brand') return '/shop/brand';
  if (kind === 'service') return '/shop/warehouse';
  return slug ? `/shop/products/${encodeURIComponent(slug)}` : null;
}

function subLineFor(kind: BuyKind, r: LineRow): string {
  switch (kind) {
    case 'sample': return `Sample · ${r.qty.toLocaleString('en-US')} ${plural('piece', r.qty)}`;
    case 'stock': return `Ready stock · minimum ${(r.min_qty ?? 1).toLocaleString('en-US')} ${plural(r.unit, r.min_qty ?? 1)}`;
    case 'pool': return `Pool ${r.pool_code ?? ''} · deposit ${r.deposit_pct ?? 0} % held`.replace('Pool  ·', 'Pool ·');
    case 'brand': return 'Make My Brand';
    case 'service': return 'Warehouse service';
  }
}

async function readRecheck(): Promise<{ notices: RecheckNotice[]; ready: boolean }> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('shop_cart_recheck');
  if (error) return { notices: [], ready: !isMissingFunction(error) };
  return { notices: parseRecheck(data), ready: true };
}

async function readQuoteRows(orgId: string): Promise<{ rows: QuoteRow[]; extended: boolean }> {
  const sb = await createClient();
  const full = await sb.from('quote_list_items').select('id, product_id, quantity, target_price_minor, customisation, saved_for_later').eq('org_id', orgId).order('seq');
  if (!full.error) return { rows: (full.data ?? []) as QuoteRow[], extended: true };
  if (!isMissingRelationOrColumn(full.error)) throw new Error('Your quote list could not be loaded.');
  const old = await sb.from('quote_list_items').select('id, product_id, quantity').eq('org_id', orgId).order('seq');
  if (old.error) throw new Error('Your quote list could not be loaded.');
  return { rows: (old.data ?? []) as QuoteRow[], extended: false };
}

async function readDuty(country: string | null, goods: { productId: string; valueMinor: number }[], hsBy: Map<string, string | null>): Promise<{ minor: number } | null> {
  if (!country || !goods.length) return null;
  const sb = await createClient();
  const codes = [...new Set(goods.map((g) => hsBy.get(g.productId) ?? ''))];
  const rates = new Map<string, DutyInput | null>();
  await Promise.all(codes.map(async (hs) => {
    const { data, error } = await sb.rpc('lookup_duty_rate', { p_country: country, p_hs_code: hs || null });
    const d = (error ? null : data) as { duty_bp?: number; tax_bp?: number; de_minimis_cents?: number | null } | null;
    rates.set(hs, d && d.duty_bp != null ? { valueMinor: 0, dutyBp: Number(d.duty_bp), taxBp: Number(d.tax_bp ?? 0), deMinimisMinor: d.de_minimis_cents == null ? null : Number(d.de_minimis_cents) } : null);
  }));
  return estimateDuty(goods.map((g) => {
    const r = rates.get(hsBy.get(g.productId) ?? '');
    return r ? { ...r, valueMinor: g.valueMinor } : null;
  }));
}

export async function buildCart(recheck = false): Promise<CartView> {
  const v = await getShopViewer();
  const org = v.org;
  const canAct = shopCan(v.role);
  const sb = await createClient();

  const re = recheck && canAct ? await readRecheck() : { notices: [] as RecheckNotice[], ready: true };
  const [linesRes, cartRes, quote] = await Promise.all([
    re.ready ? sb.rpc('shop_cart_lines') : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'missing' } }),
    sb.from('shop_carts').select('ship_to_country, ship_to_city').eq('org_id', org.id).maybeSingle(),
    readQuoteRows(org.id),
  ]);
  let lineRows: LineRow[] = [];
  if (linesRes.error) {
    if (!isMissingFunction(linesRes.error)) throw new Error('Your cart could not be loaded.');
  } else lineRows = (linesRes.data ?? []) as LineRow[];
  if (cartRes.error && !isMissingRelationOrColumn(cartRes.error)) throw new Error('Your cart could not be loaded.');
  const shipCountry = ((cartRes.data?.ship_to_country as string | null | undefined) ?? org.country ?? null)?.trim().toUpperCase() || null;
  const shipCity = (cartRes.data ? (cartRes.data.ship_to_city as string | null) : org.city) ?? null;

  // products behind the quote lines + the goods lines (titles / slugs for quote lines, MOQ, HS code for the duty estimate)
  const productIds = [...new Set([...quote.rows.map((q) => q.product_id), ...lineRows.filter((l) => l.product_id).map((l) => l.product_id as string)])];
  const stockIds = [...new Set(lineRows.filter((l) => l.kind === 'stock' && l.product_id).map((l) => l.product_id as string))];
  const now = nowIso();
  const [prodRes, poolRes, tierRes, ctx] = await Promise.all([
    productIds.length ? sb.from('products').select('id, slug, title, unit, moq, image_url, status, archived_at, hs_code').in('id', productIds) : Promise.resolve({ data: [], error: null }),
    quote.rows.length
      ? createPublicClient().from('pools').select('code, product_id, deadline_at').in('product_id', [...new Set(quote.rows.map((q) => q.product_id))]).eq('status', 'open').gt('deadline_at', now).order('deadline_at')
      : Promise.resolve({ data: [], error: null }),
    stockIds.length ? sb.from('price_tiers').select('product_id, min_qty, unit_price_cents, currency').in('product_id', stockIds) : Promise.resolve({ data: [], error: null }),
    getCurrencyContext(),
  ]);
  const products = new Map(((prodRes.data ?? []) as ProductRow[]).map((p) => [p.id, p]));
  const poolBy = new Map<string, string>();
  for (const p of (poolRes.data ?? []) as { code: string; product_id: string }[]) if (!poolBy.has(p.product_id)) poolBy.set(p.product_id, p.code);
  const tiersBy = new Map<string, { minQty: number; unitCents: number }[]>();
  for (const t of (tierRes.data ?? []) as { product_id: string; min_qty: number; unit_price_cents: number; currency: string | null }[]) {
    const list = tiersBy.get(t.product_id) ?? [];
    list.push({ minQty: Number(t.min_qty), unitCents: toPlatform(ctx, Number(t.unit_price_cents), t.currency) ?? 0 });
    tiersBy.set(t.product_id, list);
  }

  const buyAll: BuyLine[] = [];
  for (const r of lineRows) {
    if (!(BUY_KINDS as readonly string[]).includes(r.kind)) continue;
    const kind = r.kind as BuyKind;
    const unit = Number(r.unit_price_minor);
    const total = lineTotalMinor(kind, unit, r.qty);
    const deposit = kind === 'pool' ? (r.deposit_minor != null ? Number(r.deposit_minor) : depositMinor(unit, r.qty, r.deposit_pct ?? 0)) : null;
    let note: string | null = null;
    if (kind === 'sample') note = 'One sample fee per request, whatever the number of pieces.';
    if (kind === 'pool' && deposit != null) note = `Deposit ${fmtMinor(deposit, r.currency)} held until the pool fills. The balance is due only if it fills.`;
    if (kind === 'stock' && r.product_id) {
      const pr = priceForQuantity(tiersBy.get(r.product_id) ?? [], r.qty, r.min_qty ?? 1);
      if (pr.status === 'ok' && pr.next && (r.max_qty == null || pr.next.tier.minQty <= r.max_qty)) {
        note = `Order ${pr.next.unitsToGo.toLocaleString('en-US')} more for ${fmtMinor(pr.next.tier.unitCents, r.currency)} each.`;
      }
    }
    const title = r.title ?? 'Item';
    buyAll.push({
      line: 'buy', id: r.id, kind, refId: r.ref_id, title, subLine: subLineFor(kind, r), href: hrefFor(kind, r.slug, r.pool_code),
      image: image(r.image_url, title), qty: r.qty, minQty: r.min_qty ?? 1, step: r.step_qty ?? 1, maxQty: r.max_qty ?? null,
      unitPriceMinor: unit, lineTotalMinor: total, depositMinor: deposit, note,
      notice: pickNotice(re.notices, 'buy', r.id) ?? (r.available === false ? { kind: 'unavailable', reason: r.reason ?? 'unknown' } : null),
      savedForLater: !!r.saved_for_later,
    });
  }

  const quoteAll: QuoteLine[] = quote.rows.map((q) => {
    const p = products.get(q.product_id);
    const moq = Math.max(1, Number(p?.moq ?? 1));
    const live = !!p && p.status === 'live' && !p.archived_at;
    const title = p?.title ?? 'Product no longer available';
    const custom = q.customisation && CUSTOM_IDS.has(q.customisation) ? q.customisation : null;
    return {
      line: 'quote', id: q.id, productId: q.product_id, title, href: p ? `/shop/products/${encodeURIComponent(p.slug)}` : '/shop/products',
      image: image(p?.image_url, title), qty: q.quantity, moq, unit: plural(p?.unit, q.quantity),
      targetPriceMinor: q.target_price_minor == null ? null : Number(q.target_price_minor), customisation: custom,
      belowMoq: isBelowMoq(q.quantity, moq), poolHref: poolBy.has(q.product_id) ? `/shop/pools/${encodeURIComponent(poolBy.get(q.product_id) as string)}` : null,
      notice: pickNotice(re.notices, 'quote', q.id) ?? (live ? null : { kind: 'unavailable', reason: 'PRODUCT_UNAVAILABLE' }),
      savedForLater: !!q.saved_for_later,
    };
  });

  const buy = buyAll.filter((l) => !l.savedForLater);
  const quoteLines = quoteAll.filter((l) => !l.savedForLater);
  const saved: (BuyLine | QuoteLine)[] = [...buyAll.filter((l) => l.savedForLater), ...quoteAll.filter((l) => l.savedForLater)];
  const hsBy = new Map([...products.values()].map((p) => [p.id, p.hs_code]));
  const goods = buy.filter((l) => (l.kind === 'stock' || l.kind === 'pool') && l.notice?.kind !== 'unavailable')
    .map((l) => ({ productId: lineRows.find((r) => r.id === l.id)?.product_id ?? '', valueMinor: l.lineTotalMinor }))
    .filter((g) => g.productId);
  const duty = await readDuty(shipCountry, goods, hsBy).catch(() => null);

  return {
    shipTo: { country: shipCountry, countryName: countryName(shipCountry), city: shipCity },
    canAct,
    roleReason: canAct ? null : ROLE_REASON,
    verified: org.kyc_status === 'verified',
    buy,
    quote: quoteLines,
    saved,
    summary: summarise(buy, quoteLines, saved, duty),
    notices: re.notices.map((n) => n.notice),
  };
}

const loadCart = cache((recheck: boolean) => buildCart(recheck));

/** The company's cart for this request (React cache per `recheck`). */
export function getCart(opts: { recheck?: boolean } = {}): Promise<CartView> {
  return loadCart(!!opts.recheck);
}
