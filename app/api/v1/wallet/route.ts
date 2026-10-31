import { apiRoute, pageMeta, range } from '@/lib/api/handler';
import { json } from '@/lib/api/problem';
import { Pagination } from '@/lib/contracts';

/** GET /api/v1/wallet — balance (computed from the ledger) and recent wallet ledger lines. */
export const GET = apiRoute({ scopes: ['wallet:read'] }, async ({ ctx, url }) => {
  const pg = Pagination.parse(Object.fromEntries(url.searchParams));
  const [{ data: balance, error }, { data: enabled }, { data: acct }] = await Promise.all([
    ctx.sb.rpc('wallet_balance', { p_org: ctx.orgId }),
    ctx.sb.from('site_settings').select('value').eq('key', 'wallet_enabled').maybeSingle(),
    ctx.sb.from('ledger_accounts').select('id').eq('code', `wallet:${ctx.orgId}`).eq('org_id', ctx.orgId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);

  let entries: unknown[] = [];
  let total = 0;
  if (acct) {
    const [from, to] = range(pg.page, pg.per_page);
    const { data, count } = await ctx.sb
      .from('ledger_entries')
      .select('id, debit_cents, credit_cents, memo, created_at, journal:journals(number, stream, ref_type)', { count: 'exact' })
      .eq('account_id', acct.id)
      .eq('org_id', ctx.orgId)
      .order('id', { ascending: false })
      .range(from, to);
    total = count ?? 0;
    entries = (data ?? []).map((e) => {
      const j = e.journal as unknown as { number: string; stream: string | null; ref_type: string | null } | null;
      return {
        id: e.id,
        direction: e.credit_cents > 0 ? 'credit' : 'debit',
        amount_cents: e.credit_cents > 0 ? e.credit_cents : e.debit_cents,
        memo: e.memo,
        journal: j?.number ?? null,
        stream: j?.stream ?? null,
        ref_type: j?.ref_type ?? null,
        created_at: e.created_at,
      };
    });
  }
  return json({
    data: { balance_cents: Number(balance ?? 0), currency: 'USD', wallet_enabled: enabled?.value === true, entries },
    meta: pageMeta(pg.page, pg.per_page, total),
  });
});
