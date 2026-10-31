import { apiRoute, isUuid } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { WebhookEndpointUpdate, zodIssues } from '@/lib/contracts';

const COLUMNS = 'id, url, events, active, created_at';
type P = { id: string };

/** GET /api/v1/webhooks/{id} — endpoint with its 20 latest deliveries. */
export const GET = apiRoute<P>({ scopes: ['webhooks:manage'] }, async ({ ctx, params }) => {
  if (!isUuid(params.id)) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const { data } = await ctx.sb.from('webhook_endpoints').select(COLUMNS).eq('id', params.id).eq('org_id', ctx.orgId).maybeSingle();
  if (!data) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const { data: deliveries } = await ctx.sb
    .from('webhook_deliveries')
    .select('id, event_type, response_status, attempts, delivered_at, created_at')
    .eq('endpoint_id', params.id)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(20);
  return json({ data: { ...data, deliveries: deliveries ?? [] } });
});

/** PATCH /api/v1/webhooks/{id} — change url, events or active. */
export const PATCH = apiRoute<P>({ scopes: ['webhooks:manage'], idempotent: false }, async ({ ctx, params, body }) => {
  if (!isUuid(params.id)) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const parsed = WebhookEndpointUpdate.safeParse(body);
  if (!parsed.success) return problem(422, 'VALIDATION_FAILED', 'Invalid update.', { errors: zodIssues(parsed.error) });
  const { data, error } = await ctx.sb
    .from('webhook_endpoints')
    .update(parsed.data)
    .eq('id', params.id)
    .eq('org_id', ctx.orgId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  return json({ data });
});

/** DELETE /api/v1/webhooks/{id} */
export const DELETE = apiRoute<P>({ scopes: ['webhooks:manage'] }, async ({ ctx, params }) => {
  if (!isUuid(params.id)) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const { data, error } = await ctx.sb.from('webhook_endpoints').delete().eq('id', params.id).eq('org_id', ctx.orgId).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) return problem(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  return new Response(null, { status: 204 });
});
