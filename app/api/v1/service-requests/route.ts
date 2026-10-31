import { apiRoute, pageMeta, range, simId } from '@/lib/api/handler';
import { json, problem, problemFromDb } from '@/lib/api/problem';
import { Pagination, ServiceRequest, zodIssues } from '@/lib/contracts';
import { loadFx } from '@/lib/api/money';
import { publicServiceRequest } from '@/lib/api/trade';

const COLUMNS = 'id, code, service_code, product_id, order_id, status, details, fee_minor, currency, fx_rate_id, paid_via, created_at, updated_at';

/** GET /api/v1/service-requests — samples, QC, certification, 3PL, dropship requests of the organization. */
export const GET = apiRoute({ scopes: ['orders:read'] }, async ({ ctx, url }) => {
  const pg = Pagination.parse(Object.fromEntries(url.searchParams));
  const [from, to] = range(pg.page, pg.per_page);
  const { data, count, error } = await ctx.sb
    .from('service_requests')
    .select(COLUMNS, { count: 'exact' })
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return json({ data: (data ?? []).map(publicServiceRequest), meta: pageMeta(pg.page, pg.per_page, count) });
});

/** POST /api/v1/service-requests — request a service; fee from Services & charges (wallet when on). Test keys: simulated. */
export const POST = apiRoute({ scopes: ['orders:write'] }, async ({ ctx, body, req }) => {
  const parsed = ServiceRequest.safeParse(body);
  if (!parsed.success) return problem(422, 'VALIDATION_FAILED', 'Invalid service request.', { errors: zodIssues(parsed.error) });
  const s = parsed.data;
  const { data: svc } = await ctx.sb.from('services').select('code, active').eq('code', s.serviceCode).maybeSingle();
  if (!svc?.active) return problem(422, 'SERVICE_INACTIVE', `Service "${s.serviceCode}" is not available.`);
  if (s.productId) {
    const { data: p } = await ctx.sb.from('products').select('id').eq('id', s.productId).eq('status', 'live').maybeSingle();
    if (!p) return problem(422, 'VALIDATION_FAILED', 'productId is not a live product.');
  }

  if (ctx.mode === 'test') {
    const fx = await loadFx(ctx.sb);
    const [{ data: fee }, { data: w }] = await Promise.all([
      ctx.sb.rpc('current_service_price', { p_code: s.serviceCode, p_currency: fx.currency }),
      ctx.sb.from('site_settings').select('value').eq('key', 'wallet_enabled').maybeSingle(),
    ]);
    const f = Number(fee ?? 0);
    const wallet = w?.value === true;
    const now = new Date().toISOString();
    return json(
      {
        data: publicServiceRequest({
          id: simId('srv'),
          code: 'SRV-TEST',
          service_code: s.serviceCode,
          product_id: s.productId ?? null,
          order_id: null,
          status: f === 0 || wallet ? 'paid' : 'requested',
          details: s.details,
          fee_minor: f,
          currency: fx.currency,
          fx_rate_id: fx.fxRateId,
          paid_via: f === 0 ? 'free' : wallet ? 'wallet' : 'invoice',
          created_at: now,
          updated_at: now,
        }),
        simulated: true,
      },
      { status: 201 },
    );
  }

  const { data: id, error } = await ctx.sb.rpc('api_request_service', {
    p_org: ctx.orgId,
    p_service: s.serviceCode,
    p_details: s.details,
    p_product: s.productId ?? null,
    p_idem: `${ctx.orgId}:${req.headers.get('idempotency-key')}`,
  });
  if (error) return problemFromDb(error);
  const { data } = await ctx.sb.from('service_requests').select(COLUMNS).eq('id', id).eq('org_id', ctx.orgId).single();
  return json({ data: data ? publicServiceRequest(data) : null }, { status: 201 });
});
