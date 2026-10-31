import { apiRoute } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { WebhookEndpointCreate, zodIssues } from '@/lib/contracts';

const COLUMNS = 'id, url, events, active, created_at';

/** GET /api/v1/webhooks — registered endpoints (secrets are only returned on creation). */
export const GET = apiRoute({ scopes: ['webhooks:manage'] }, async ({ ctx }) => {
  const { data, error } = await ctx.sb.from('webhook_endpoints').select(COLUMNS).eq('org_id', ctx.orgId).order('created_at');
  if (error) throw new Error(error.message);
  return json({ data: data ?? [] });
});

/**
 * POST /api/v1/webhooks — register an endpoint. Returns the signing secret once.
 * Allowed for test keys too (endpoint config is not trade data and is needed to test signed deliveries).
 */
export const POST = apiRoute({ scopes: ['webhooks:manage'] }, async ({ ctx, body }) => {
  const parsed = WebhookEndpointCreate.safeParse(body);
  if (!parsed.success) return problem(422, 'VALIDATION_FAILED', 'Invalid webhook endpoint.', { errors: zodIssues(parsed.error) });
  const { count } = await ctx.sb.from('webhook_endpoints').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId);
  if ((count ?? 0) >= 10) return problem(409, 'LIMIT_REACHED', 'At most 10 webhook endpoints per organization.');
  const { data, error } = await ctx.sb
    .from('webhook_endpoints')
    .insert({ org_id: ctx.orgId, url: parsed.data.url, events: parsed.data.events })
    .select(COLUMNS + ', secret')
    .single();
  if (error) throw new Error(error.message);
  return json({ data }, { status: 201, headers: { Location: `/api/v1/webhooks/${(data as unknown as { id: string }).id}` } });
});
