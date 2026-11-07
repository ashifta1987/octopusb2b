import { apiRoute, isUuid } from '@/lib/api/handler';
import { serviceName } from '@/lib/service-names';
import { publicSuppliers } from '@/lib/api/data';
import { ORDER_COLUMNS, publicDocument, publicOrder } from '@/lib/api/trade';
import { amt } from '@/lib/api/money';
import { json, problem } from '@/lib/api/problem';

/** GET /api/v1/orders/{id|code} — order with status timeline, documents and shipments. */
export const GET = apiRoute<{ id: string }>({ scopes: ['orders:read'] }, async ({ ctx, params }) => {
  const { data: o } = await ctx.sb
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq(isUuid(params.id) ? 'id' : 'code', params.id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!o) return problem(404, 'NOT_FOUND', 'Order not found.');

  const [events, docs, ships, sups] = await Promise.all([
    ctx.sb.from('order_events').select('kind, title, body, created_at').eq('order_id', o.id).eq('org_id', ctx.orgId).order('created_at'),
    ctx.sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, emailed_at, created_at').eq('order_id', o.id).eq('org_id', ctx.orgId).order('created_at'),
    ctx.sb.from('shipments').select('id, code, service_code, tracking_no, status, eta, rate_cents, currency, last_event_at, created_at').eq('order_id', o.id).eq('org_id', ctx.orgId),
    publicSuppliers(ctx.sb, [o.supplier_id]),
  ]);
  return json({
    data: {
      ...publicOrder(o, sups.get(o.supplier_id) ?? null),
      events: events.data ?? [],
      documents: (docs.data ?? []).map(publicDocument),
      shipments: (ships.data ?? []).map(({ rate_cents, currency, ...s }) => ({ ...s, service: serviceName(s.service_code), shipping_rate: amt(rate_cents, currency) })),
    },
  });
});
