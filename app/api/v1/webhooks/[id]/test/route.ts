import { apiRoute, isUuid } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { deliverWebhook, type Endpoint } from '@/lib/api/webhooks';

/** POST /api/v1/webhooks/{id}/test — sends a signed `ping` event now so you can verify your signature check. */
export const POST = apiRoute<{ id: string }>({ scopes: ['webhooks:manage'] }, async ({ ctx, params }) => {
  if (!isUuid(params.id)) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const { data: ep } = await ctx.sb
    .from('webhook_endpoints')
    .select('id, org_id, url, secret, events, active')
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!ep) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const r = await deliverWebhook(ctx.sb, ep as Endpoint, 'ping', { message: 'Hello from Octopus B2B', endpoint_id: ep.id }, { mode: ctx.mode });
  return json({ data: { delivered: r.ok, response_status: r.status || null, error: r.error, event_id: r.eventId } });
});
