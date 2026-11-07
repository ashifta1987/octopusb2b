import { apiRoute, isUuid } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { serviceName } from '@/lib/service-names';

/** GET /api/v1/shipments/{id|SHP-code|tracking_no}/tracking — shipment status and carrier events (newest first). */
export const GET = apiRoute<{ id: string }>({ scopes: ['shipments:read', 'orders:read'] }, async ({ ctx, params }) => {
  const id = params.id;
  const col = isUuid(id) ? 'id' : id.toUpperCase().startsWith('SHP-') ? 'code' : 'tracking_no';
  const { data: s } = await ctx.sb
    .from('shipments')
    .select('id, code, order_id, service_code, tracking_no, status, eta, parcels, weight_kg, last_event_at, created_at')
    .eq(col, id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!s) return problem(404, 'NOT_FOUND', 'Shipment not found.');
  const [{ data: events }, { data: order }] = await Promise.all([
    ctx.sb.from('tracking_events').select('status, description, location, occurred_at').eq('shipment_id', s.id).eq('org_id', ctx.orgId).order('occurred_at', { ascending: false }),
    ctx.sb.from('orders').select('code').eq('id', s.order_id).eq('org_id', ctx.orgId).maybeSingle(),
  ]);
  return json({ data: { ...s, service: serviceName(s.service_code), order_code: order?.code ?? null, events: events ?? [] } }); // white-label: no carrier
});
