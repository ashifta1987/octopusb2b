import { getSession, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/components/admin/server';

/** Minor units → decimal string (USD and CNY both have 2 decimals). The currency is in its own column. */
const minor = (v: number | null | undefined) => (Number(v ?? 0) / 100).toFixed(2);

/** CSV exports for finance: ?type=journals|payments|revenue[&month=YYYY-MM]. Requires finance:export. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!can(s, 'finance', 'export')) return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'journals';
  const month = url.searchParams.get('month');
  let from: string | null = null; let to: string | null = null;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const f = new Date(month + '-01T00:00:00Z'); const t = new Date(f); t.setUTCMonth(t.getUTCMonth() + 1);
    from = f.toISOString(); to = t.toISOString();
  }
  const sb = await createClient();
  let csv: string;

  if (type === 'revenue') {
    const { data, error } = await sb.rpc('admin_revenue_by_stream', { p_from: from, p_to: to });
    if (error) return new Response(error.message, { status: 400 });
    const { data: pc } = await sb.rpc('current_platform_currency');
    const platform = String(pc ?? 'USD');
    csv = toCsv(['month', 'stream', 'currency', 'credit', 'debit', 'net', `net_converted_${platform}`],
      ((data ?? []) as { month: string; stream: string; credit_cents: number; debit_cents: number; net_cents: number; currency: string; net_converted_minor: number }[])
        .map((r) => [String(r.month).slice(0, 7), r.stream, r.currency, minor(r.credit_cents), minor(r.debit_cents), minor(r.net_cents), minor(r.net_converted_minor)]));
  } else if (type === 'payments') {
    let q = sb.from('payments').select('id, created_at, confirmed_at, purpose, method, amount_cents, currency, reference, status, organizations(name, country), orders(code)').order('created_at', { ascending: false }).limit(10000);
    if (from && to) q = q.gte('created_at', from).lt('created_at', to);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 400 });
    csv = toCsv(['payment_id', 'created_at', 'confirmed_at', 'customer', 'country', 'order', 'purpose', 'method', 'currency', 'amount', 'reference', 'status'],
      (data ?? []).map((p) => {
        const org = p.organizations as unknown as { name: string; country: string | null } | null;
        const ord = p.orders as unknown as { code: string } | null;
        return [p.id, p.created_at, p.confirmed_at, org?.name, org?.country, ord?.code, p.purpose, p.method, p.currency, minor(p.amount_cents), p.reference, p.status];
      }));
  } else if (type === 'journals') {
    let q = sb.from('ledger_entries').select('id, created_at, debit_cents, credit_cents, currency, memo, org_id, journals!inner(number, memo, stream, ref_type, created_at), ledger_accounts(code, name, kind)').order('id', { ascending: false }).limit(20000);
    if (from && to) q = q.gte('created_at', from).lt('created_at', to);
    const { data, error } = await q;
    if (error) return new Response(error.message, { status: 400 });
    csv = toCsv(['journal', 'date', 'journal_memo', 'stream', 'ref_type', 'account_code', 'account_name', 'kind', 'currency', 'debit', 'credit', 'line_memo'],
      (data ?? []).map((e) => {
        const j = e.journals as unknown as { number: string; memo: string; stream: string | null; ref_type: string | null };
        const a = e.ledger_accounts as unknown as { code: string; name: string; kind: string } | null;
        return [j?.number, e.created_at, j?.memo, j?.stream, j?.ref_type, a?.code, a?.name, a?.kind, e.currency, minor(e.debit_cents), minor(e.credit_cents), e.memo];
      }));
  } else {
    return new Response('Unknown export type', { status: 400 });
  }

  const name = `octopus-${type}${month ? '-' + month : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response('\uFEFF' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
