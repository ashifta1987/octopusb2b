import { apiRoute, isUuid } from '@/lib/api/handler';
import { quotesFor, RFQ_COLUMNS } from '@/lib/api/trade';
import { json, problem } from '@/lib/api/problem';

/** GET /api/v1/rfqs/{id|code} — RFQ with its quotes. */
export const GET = apiRoute<{ id: string }>({ scopes: ['quotes:write', 'orders:read'] }, async ({ ctx, params }) => {
  const { data: rfq } = await ctx.sb
    .from('rfqs')
    .select(RFQ_COLUMNS)
    .eq(isUuid(params.id) ? 'id' : 'code', params.id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!rfq) return problem(404, 'NOT_FOUND', 'RFQ not found.');
  return json({ data: { ...rfq, quotes: await quotesFor(ctx.sb, [rfq.id]) } });
});
