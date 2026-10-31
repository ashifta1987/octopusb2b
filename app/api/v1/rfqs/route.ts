import { apiRoute, pageMeta, range, simId } from '@/lib/api/handler';
import { publicRfq, RFQ_COLUMNS } from '@/lib/api/trade';
import { loadFx } from '@/lib/api/money';
import { json, problem, problemFromDb } from '@/lib/api/problem';
import { Pagination, SubmitRfq, zodIssues } from '@/lib/contracts';

/** GET /api/v1/rfqs — the organization's RFQs. */
export const GET = apiRoute({ scopes: ['quotes:write', 'orders:read'] }, async ({ ctx, url }) => {
  const pg = Pagination.parse(Object.fromEntries(url.searchParams));
  let q = ctx.sb.from('rfqs').select(RFQ_COLUMNS, { count: 'exact' }).eq('org_id', ctx.orgId);
  const status = url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const [from, to] = range(pg.page, pg.per_page);
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to);
  if (error) return error.code === '22P02' ? problem(400, 'INVALID_QUERY', 'Unknown status.') : problemFromDb(error);
  return json({ data: (data ?? []).map(publicRfq), meta: pageMeta(pg.page, pg.per_page, count) });
});

/** POST /api/v1/rfqs — submit an RFQ (RFQ fee charged from the wallet when the wallet is on). Test keys: simulated. */
export const POST = apiRoute({ scopes: ['quotes:write'] }, async ({ ctx, body, req }) => {
  const parsed = SubmitRfq.safeParse(body);
  if (!parsed.success) return problem(422, 'VALIDATION_FAILED', 'Invalid RFQ.', { errors: zodIssues(parsed.error) });
  const r = parsed.data;

  if (r.productId) {
    const { data: p } = await ctx.sb.from('products').select('id').eq('id', r.productId).eq('status', 'live').is('archived_at', null).maybeSingle();
    if (!p) return problem(422, 'VALIDATION_FAILED', 'productId is not a live product.', { errors: [{ path: 'productId', message: 'Not found' }] });
  }

  if (ctx.mode === 'test') {
    const fx = await loadFx(ctx.sb);
    const { data: fee } = await ctx.sb.rpc('current_service_price', { p_code: 'rfq', p_currency: fx.currency });
    const now = new Date();
    return json(
      {
        data: publicRfq({
          id: simId('rfq'),
          code: 'RFQ-TEST-' + Math.floor(1000 + Math.random() * 9000),
          title: r.title,
          details: r.details,
          quantity: r.quantity,
          unit: 'pcs',
          status: 'submitted',
          fee_minor: Number(fee ?? 0),
          currency: fx.currency,
          product_id: r.productId ?? null,
          destination_country: r.destinationCountry ?? null,
          destination_city: r.destinationCity ?? null,
          incoterm: r.incoterm ?? null,
          target_price_cents: r.targetPriceCents ?? null,
          expires_at: new Date(now.getTime() + 14 * 864e5).toISOString(),
          created_at: now.toISOString(),
        }),
        simulated: true,
      },
      { status: 201 },
    );
  }

  const { data: id, error } = await ctx.sb.rpc('api_submit_rfq', {
    p_org: ctx.orgId,
    p_title: r.title,
    p_quantity: r.quantity,
    p_details: r.details,
    p_product: r.productId ?? null,
    p_destination_country: r.destinationCountry ?? null,
    p_destination_city: r.destinationCity ?? null,
    p_target_price_cents: r.targetPriceCents ?? null,
    p_incoterm: r.incoterm ?? null,
    p_idem: `${ctx.orgId}:${req.headers.get('idempotency-key')}`,
  });
  if (error) return problemFromDb(error);
  const { data } = await ctx.sb.from('rfqs').select(RFQ_COLUMNS).eq('id', id).eq('org_id', ctx.orgId).single();
  return json({ data: data ? publicRfq(data) : null }, { status: 201, headers: { Location: `/api/v1/rfqs/${id}` } });
});
