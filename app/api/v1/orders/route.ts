import { apiRoute, pageMeta, range, simId } from '@/lib/api/handler';
import { publicSuppliers } from '@/lib/api/data';
import { ORDER_COLUMNS, publicOrder } from '@/lib/api/trade';
import { json, problem, problemFromDb } from '@/lib/api/problem';
import { ApproveQuote, Pagination, zodIssues } from '@/lib/contracts';

/** GET /api/v1/orders — the organization's orders (filter with ?status=). */
export const GET = apiRoute({ scopes: ['orders:read'] }, async ({ ctx, url }) => {
  const pg = Pagination.parse(Object.fromEntries(url.searchParams));
  let q = ctx.sb.from('orders').select(ORDER_COLUMNS, { count: 'exact' }).eq('org_id', ctx.orgId);
  const status = url.searchParams.get('status');
  if (status) q = q.eq('status', status);
  const [from, to] = range(pg.page, pg.per_page);
  const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to);
  if (error) return error.code === '22P02' ? problem(400, 'INVALID_QUERY', 'Unknown status.') : problemFromDb(error);
  const sups = await publicSuppliers(ctx.sb, (data ?? []).map((o) => o.supplier_id));
  return json({ data: (data ?? []).map((o) => publicOrder(o, sups.get(o.supplier_id) ?? null)), meta: pageMeta(pg.page, pg.per_page, count) });
});

/** POST /api/v1/orders — create an order by approving a quote (issues the proforma invoice). Test keys: simulated. */
export const POST = apiRoute({ scopes: ['orders:write'] }, async ({ ctx, body }) => {
  const parsed = ApproveQuote.safeParse(body);
  if (!parsed.success) return problem(422, 'VALIDATION_FAILED', 'Invalid request.', { errors: zodIssues(parsed.error) });
  const { quoteId, acceptTermsVersionId } = parsed.data;

  if (ctx.mode === 'test') {
    const { data: q } = await ctx.sb
      .from('quotes')
      .select('id, code, status, valid_until, unit_price_cents, quantity, shipping_cents, incoterm, supplier_id, rfq:rfqs!inner(id, org_id, title)')
      .eq('id', quoteId)
      .eq('rfq.org_id', ctx.orgId)
      .maybeSingle();
    if (!q) return problem(404, 'NOT_FOUND', 'Quote not found.');
    if (!['sent', 'viewed'].includes(q.status)) return problem(409, 'QUOTE_NOT_APPROVABLE', `Quote is ${q.status}.`);
    if (new Date(q.valid_until) < new Date()) return problem(409, 'QUOTE_EXPIRED', 'This quote has expired.');
    const { data: pct } = await ctx.sb.from('site_settings').select('value').eq('key', 'deposit_pct').maybeSingle();
    const depositPct = Number(pct?.value ?? 30);
    const total = q.unit_price_cents * q.quantity + q.shipping_cents;
    const rfq = q.rfq as unknown as { id: string; title: string };
    const sups = await publicSuppliers(ctx.sb, [q.supplier_id]);
    return json(
      {
        data: {
          id: simId('ord'),
          code: 'ORD-TEST-' + Math.floor(1000 + Math.random() * 9000),
          pi_number: `PI-${new Date().getFullYear()}-TEST`,
          status: 'deposit_pending',
          title: rfq.title,
          quantity: q.quantity,
          unit_price_cents: q.unit_price_cents,
          shipping_cents: q.shipping_cents,
          total_cents: total,
          deposit_pct: depositPct,
          deposit_cents: Math.round((total * depositPct) / 100),
          paid_cents: 0,
          balance_cents: total,
          currency: 'USD',
          incoterm: q.incoterm,
          quote_id: q.id,
          rfq_id: rfq.id,
          supplier: sups.get(q.supplier_id) ?? null,
          created_at: new Date().toISOString(),
        },
        simulated: true,
      },
      { status: 201 },
    );
  }

  const { data: res, error } = await ctx.sb.rpc('api_approve_quote', {
    p_org: ctx.orgId,
    p_quote: quoteId,
    p_terms_version: acceptTermsVersionId ?? null,
  });
  if (error) return problemFromDb(error);
  const r = res as { order_id: string; order_code: string; pi_number: string };
  const { data: o } = await ctx.sb.from('orders').select(ORDER_COLUMNS).eq('id', r.order_id).eq('org_id', ctx.orgId).single();
  const sups = await publicSuppliers(ctx.sb, [o?.supplier_id]);
  return json(
    { data: { ...publicOrder(o ?? {}, sups.get(o?.supplier_id) ?? null), pi_number: r.pi_number } },
    { status: 201, headers: { Location: `/api/v1/orders/${r.order_id}` } },
  );
});
