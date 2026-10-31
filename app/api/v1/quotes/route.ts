import { apiRoute, isUuid } from '@/lib/api/handler';
import { quotesFor } from '@/lib/api/trade';
import { json, problem } from '@/lib/api/problem';

/** GET /api/v1/quotes?rfq_id=… — quotes for one of the organization's RFQs (or all open quotes when omitted). */
export const GET = apiRoute({ scopes: ['quotes:write', 'orders:read'] }, async ({ ctx, url }) => {
  const rfqId = url.searchParams.get('rfq_id');
  let q = ctx.sb.from('rfqs').select('id').eq('org_id', ctx.orgId);
  if (rfqId) {
    q = q.eq(isUuid(rfqId) ? 'id' : 'code', rfqId);
  } else {
    q = q.in('status', ['submitted', 'assigned', 'quoting', 'quoted']).limit(200);
  }
  const { data: rfqs, error } = await q;
  if (error) throw new Error(error.message);
  if (rfqId && !rfqs?.length) return problem(404, 'NOT_FOUND', 'RFQ not found.');
  return json({ data: await quotesFor(ctx.sb, (rfqs ?? []).map((r) => r.id)) });
});
