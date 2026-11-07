import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtDate, humanize, money } from '@/lib/format';
import { getQuoteFacts, getShipmentFacts } from './facts';
import { redactObject, redactText } from './redact';
import { isToolName, validateToolArgs, type ToolArgs } from './tool-schemas';
import type { AssistantDraft, ToolCallLog } from './types';

/** Server-side execution of Octo's tools with the customer's own Supabase client (RLS applies). draft_* never submit. */

export type ToolResult = { output: string; link?: ToolCallLog['link']; draft?: AssistantDraft | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Current service charge in the platform currency (service_prices via service_price_info), or null. */
export async function servicePrice(sb: SupabaseClient, code: string): Promise<{ minor: number; currency: string } | null> {
  const { data, error } = await sb.rpc('service_price_info', { p_code: code });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { amount_minor?: number | null; currency?: string } | null;
  return row && row.amount_minor != null ? { minor: Number(row.amount_minor), currency: String(row.currency ?? 'USD') } : null;
}

async function listPools(sb: SupabaseClient, a: ToolArgs<'list_pools'>): Promise<ToolResult> {
  let productId: string | null = null;
  const key = a.product_id_or_slug?.trim();
  if (key) {
    const { data: p } = await sb.from('products').select('id').eq(UUID_RE.test(key) ? 'id' : 'slug', key).maybeSingle();
    if (!p) return { output: `No live product matches "${key}".` };
    productId = p.id as string;
  }
  let q = sb.from('pools').select('id, code, product_id, supplier_id, target_qty, filled_qty, min_pledge, deadline_at, status, pool_price_minor, currency, deposit_pct, products(title, slug)')
    .eq('status', 'open').order('deadline_at').limit(8);
  if (productId) q = q.eq('product_id', productId);
  const { data } = await q;
  const pools = (data ?? []) as unknown as { id: string; code: string; supplier_id: string; target_qty: number; filled_qty: number; min_pledge: number; deadline_at: string; pool_price_minor: number; currency: string; deposit_pct: number; products: { title: string; slug: string } | null }[];
  if (!pools.length) return { output: productId ? 'There is no open pool for that product right now.' : 'There are no open group-buy pools right now.', link: { href: '/account/pools', label: 'Group buys →' } };
  const supIds = [...new Set(pools.map((p) => p.supplier_id))];
  const { data: sups } = await sb.from('public_suppliers').select('id, code, country').in('id', supIds);
  const sup = new Map((sups ?? []).map((s) => [s.id as string, s as { code: string; country: string | null }]));
  const lines = pools.map((p) => {
    const s = sup.get(p.supplier_id);
    const pct = p.target_qty ? Math.round((100 * p.filled_qty) / p.target_qty) : 0;
    return `• ${p.code} · ${p.products?.title ?? 'Product'} · supplier ${s?.code ?? 'OCT-?'}${s?.country ? ` (${s.country})` : ''} · pool price ${money(Number(p.pool_price_minor), p.currency)}/unit` +
      ` · ${p.filled_qty.toLocaleString('en-US')}/${p.target_qty.toLocaleString('en-US')} pledged (${pct}%) · min pledge ${p.min_pledge} · deposit ${p.deposit_pct}% · closes ${fmtDate(p.deadline_at)}`;
  });
  return { output: lines.join('\n'), link: { href: '/account/pools', label: 'Group buys →' } };
}

async function draftService(sb: SupabaseClient, a: ToolArgs<'draft_service_request'>): Promise<ToolResult> {
  const { data: svc } = await sb.from('services').select('code, name, active').eq('code', a.service_code).maybeSingle();
  if (!svc || svc.active === false) {
    const { data: all } = await sb.from('services').select('code').eq('active', true);
    return { output: `Unknown service "${a.service_code}". Available: ${(all ?? []).map((s) => s.code).join(', ')}.` };
  }
  let fee: number | null = null;
  let feeCur: string | null = null;
  const price = await servicePrice(sb, a.service_code);
  if (price) { fee = price.minor; feeCur = price.currency; }
  const draft: AssistantDraft = { kind: 'service', service_code: svc.code as string, service_name: svc.name as string, details: a.details, product_id: a.product_id ?? null, fee_minor: fee, fee_currency: feeCur };
  return {
    output: `Draft ${svc.name} request prepared (NOT submitted). Fields: ${JSON.stringify(redactObject(a.details))}.${fee != null ? ` Service charge: ${money(fee, feeCur)}.` : ''} The customer must review it and click Confirm.`,
    draft,
  };
}

async function termsSection(sb: SupabaseClient, a: ToolArgs<'get_terms_section'>): Promise<ToolResult> {
  const { data } = await sb.from('terms_versions').select('version, sections, published_at').eq('status', 'published').eq('kind', 'general')
    .order('published_at', { ascending: false }).limit(1).maybeSingle();
  const sections = ((data?.sections ?? []) as { no: number; title: string; body: string }[]);
  const s = sections.find((x) => Number(x.no) === a.no);
  if (!data || !s) return { output: `Section ${a.no} was not found in the current Terms & Conditions${data ? ` (${data.version}, ${sections.length} sections)` : ''}.`, link: { href: '/legal/terms', label: 'Read the T&C →' } };
  return { output: `Terms & Conditions ${data.version}, section ${s.no} "${s.title}":\n${s.body}`.slice(0, 3000), link: { href: `/legal/terms#s-${s.no}`, label: `T&C section ${s.no} →` } };
}

export async function executeTool(sb: SupabaseClient, name: string, rawArgs: unknown): Promise<{ log: ToolCallLog; output: string; draft?: AssistantDraft | null }> {
  const t0 = Date.now();
  const fail = (error: string, args: unknown = {}) => ({
    log: { tool: name, args: redactObject((args && typeof args === 'object' ? args : {}) as Record<string, unknown>), latency_ms: Date.now() - t0, ok: false, error },
    output: `Tool error: ${error}`,
  });
  if (!isToolName(name)) return fail('unknown tool');
  const v = validateToolArgs(name, rawArgs);
  if (!v.ok) return fail(v.error, typeof rawArgs === 'string' ? {} : rawArgs);
  try {
    let r: ToolResult;
    switch (name) {
      case 'get_shipment': {
        const f = await getShipmentFacts(sb, (v.args as ToolArgs<'get_shipment'>).tracking_or_order);
        const oid = (f.data as { order_id?: string } | null)?.order_id;
        r = { output: f.text, link: oid ? { href: `/account/orders/${oid}`, label: 'Open order timeline →' } : null };
        break;
      }
      case 'list_quotes': {
        const f = await getQuoteFacts(sb, (v.args as ToolArgs<'list_quotes'>).rfq_id_or_code);
        const rid = (f.data as { rfq_id?: string } | null)?.rfq_id;
        r = { output: f.text, link: rid ? { href: `/account/sourcing/${rid}`, label: 'Compare quotes →' } : null };
        break;
      }
      case 'list_pools':
        r = await listPools(sb, v.args as ToolArgs<'list_pools'>);
        break;
      case 'draft_rfq': {
        const a = v.args as ToolArgs<'draft_rfq'>;
        const fee = await servicePrice(sb, 'rfq');
        const draft: AssistantDraft = { kind: 'rfq', ...a, fee_minor: fee?.minor ?? null, fee_currency: fee?.currency ?? null };
        r = { output: `RFQ draft prepared (NOT submitted): ${a.title}, quantity ${a.quantity}${a.destination_country ? `, to ${a.destination_country}` : ''}${a.incoterm ? `, ${a.incoterm}` : ''}.${fee ? ` RFQ service charge: ${money(fee.minor, fee.currency)}.` : ''} The customer must review it and click Confirm.`, draft };
        break;
      }
      case 'draft_service_request':
        r = await draftService(sb, v.args as ToolArgs<'draft_service_request'>);
        break;
      case 'get_terms_section':
        r = await termsSection(sb, v.args as ToolArgs<'get_terms_section'>);
        break;
    }
    const output = redactText(r.output);
    return {
      log: { tool: name, args: redactObject(v.args as Record<string, unknown>), latency_ms: Date.now() - t0, ok: true, link: r.link ?? null, draft: r.draft ?? null },
      output,
      draft: r.draft ?? null,
    };
  } catch (e) {
    return fail(humanize((e as Error).message ?? 'failed'), v.args);
  }
}
