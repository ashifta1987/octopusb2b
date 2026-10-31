import { apiRoute, pageMeta, range } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';
import { amt, amt0, cur, loadFx } from '@/lib/api/money';
import { CURRENCY_CODES, Pagination } from '@/lib/contracts';

/**
 * GET /api/v1/wallet — balances per currency (one wallet per org per currency, SPEC §15.1) and the ledger lines of one
 * wallet: `?currency=USD|CNY` (default: the platform currency, which is the wallet charges use).
 */
export const GET = apiRoute({ scopes: ['wallet:read'] }, async ({ ctx, url }) => {
  const pg = Pagination.parse(Object.fromEntries(url.searchParams));
  const want = url.searchParams.get('currency')?.toUpperCase();
  if (want && !(CURRENCY_CODES as readonly string[]).includes(want)) return problem(400, 'INVALID_QUERY', 'currency must be USD or CNY.');

  const [fx, { data: wallets, error }, { data: enabled }] = await Promise.all([
    loadFx(ctx.sb),
    ctx.sb.from('wallets').select('currency, account_id, balance_minor').eq('org_id', ctx.orgId),
    ctx.sb.from('site_settings').select('value').eq('key', 'wallet_enabled').maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const currency = want ? cur(want) : fx.currency;
  const rows = (wallets ?? []) as { currency: string; account_id: string; balance_minor: number }[];
  const acct = rows.find((w) => cur(w.currency) === currency);
  const balances = rows.map((w) => amt0(w.balance_minor, w.currency)).sort((a, b) => a.currency.localeCompare(b.currency));
  if (!balances.some((b) => b.currency === fx.currency)) balances.push(amt0(0, fx.currency));

  let entries: unknown[] = [];
  let total = 0;
  if (acct) {
    const [from, to] = range(pg.page, pg.per_page);
    const { data, count } = await ctx.sb
      .from('ledger_entries')
      .select('id, debit_cents, credit_cents, currency, memo, created_at, journal:journals(number, stream, ref_type)', { count: 'exact' })
      .eq('account_id', acct.account_id)
      .eq('org_id', ctx.orgId)
      .order('id', { ascending: false })
      .range(from, to);
    total = count ?? 0;
    entries = (data ?? []).map((e) => {
      const j = e.journal as unknown as { number: string; stream: string | null; ref_type: string | null } | null;
      return {
        id: e.id,
        direction: e.credit_cents > 0 ? 'credit' : 'debit',
        amount: amt(e.credit_cents > 0 ? e.credit_cents : e.debit_cents, e.currency ?? currency),
        memo: e.memo,
        journal: j?.number ?? null,
        stream: j?.stream ?? null,
        ref_type: j?.ref_type ?? null,
        created_at: e.created_at,
      };
    });
  }
  return json({
    data: {
      currency,
      platform_currency: fx.currency,
      balance: amt0(acct?.balance_minor ?? 0, currency),
      balances,
      wallet_enabled: enabled?.value === true,
      entries,
    },
    meta: pageMeta(pg.page, pg.per_page, total),
  });
});
