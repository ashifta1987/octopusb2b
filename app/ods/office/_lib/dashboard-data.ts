import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { can, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCurrencyContext } from '@/lib/currency';
import { convertMinor, CURRENCY_PREFIX, humanize } from '@/lib/format';
import { getWorkQueue, type QueueItem } from '@/lib/core/work-queue';
import { getDivisionScope } from '@/lib/divisions/scope';
import { dropSeeds, seedIds } from '@/components/backoffice/hidden-columns';
import { approvalQueue } from '@/lib/office/approvals';
import { ageingBuckets, weeklyMoney, type AgeingResult, type MoneyWeek } from './dashboard-core';

/**
 * ODS T9 · Dashboard loaders (Part 7.3). Every read is one TODAY's screen already makes, on the staff member's own
 * session (RLS applies), behind the same permission today's page checks:
 *  - My work            getWorkQueue(s, scope)                                  (/admin Work queue)
 *  - Receivables + ageing documents commercial_invoice not paid/void/cancelled  (/admin/finance/receivables, finance:view)
 *  - Payables           payouts scheduled / approved                            (/admin/finance "Supplier payouts due")
 *  - Customer wallets   admin_wallet_balances()                                 (/admin/finance "Held in wallets")
 *  - Waiting for approval office_approval_queue() (T8-DATA); before migration 255: finance_approvals 'requested'
 *  - Money in and out   ledger_entries on the bank accounts cash:bank / cash:bank:CNY (debit = in, credit = out), last 8
 *                       weeks — the same ledger_entries ⨝ ledger_accounts read /admin/finance makes for refunds
 *  - Sales pipeline     rfqs / orders / service_requests head counts            (/office Queues, /admin Work queue)
 *  - MOQ pools          pools open, by deadline                                 (/admin/pools, orders:view)
 *  - Recent activity    audit_log (audit:view) + status_history                 (/admin/reports "Recent activity")
 * Amounts in other currencies are converted into the platform currency at the approved rate (today's convertMinor).
 * "Cash in bank" is NOT shown: no screen today has a bank-balance figure (the ledger has no balance read), so the
 * KPI is hidden rather than invented.
 */

/** One panel's result: data, or failed (the panel shows its own error; the rest of the page keeps working). */
export async function settle<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    console.error('[ods/office] dashboard panel failed:', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
};

export type Fx = { currency: 'USD' | 'CNY'; prefix: string; rateText: string };

const fxCtx = cache(async () => {
  const ctx = await getCurrencyContext();
  const step = ctx.rounding[ctx.currency]?.step_minor ?? 1;
  const toPlat = (minor: number, c: string) => convertMinor(minor, c, ctx.currency, ctx.rate, step);
  const fx: Fx = { currency: ctx.currency, prefix: CURRENCY_PREFIX[ctx.currency], rateText: `${Number(ctx.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })} CNY/USD` };
  return { toPlat, fx };
});

/* ───────── KPIs ───────── */

/** One KPI: an amount (minor units, platform currency) or a count; `hintMinor` + `hint` = "US$ 8,200.00 overdue". */
export type KpiFigure = { id: string; label: string; minor?: number; count?: number; hint?: string; hintMinor?: number; href?: string };

/** Today's Receivables read (same filter), shared by the KPI and the ageing panel. */
const openInvoices = cache(async () => {
  const sb = await createClient();
  const r = await sb
    .from('documents')
    .select('id, amount_cents, paid_cents, currency, due_at')
    .eq('doc_type', 'commercial_invoice')
    .not('status', 'in', '("paid","void","cancelled")')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(1000);
  const rows = must(r, 'documents') as { id: string; amount_cents: number | null; paid_cents: number | null; currency: string | null; due_at: string | null }[];
  return rows
    .map((d) => ({ balanceMinor: Math.max(0, Number(d.amount_cents ?? 0) - Number(d.paid_cents ?? 0)), dueAt: d.due_at, currency: (d.currency ?? '').trim() || 'USD' }))
    .filter((d) => d.balanceMinor > 0);
});

export async function loadAgeing(nowMs: number): Promise<{ ageing: AgeingResult; fx: Fx }> {
  const [{ toPlat, fx }, rows] = await Promise.all([fxCtx(), openInvoices()]);
  return { ageing: ageingBuckets(rows, nowMs, toPlat), fx };
}

/** Finance strip (finance:view checked by the caller). Each figure loads on its own; a figure that fails is left out. */
export async function loadFinanceKpis(nowMs: number): Promise<{ items: KpiFigure[]; fx: Fx }> {
  const { toPlat, fx } = await fxCtx();
  const sb = await createClient();
  const [recv, pay, wal, appr] = await Promise.all([
    settle(async (): Promise<KpiFigure> => {
      const { ageing } = await loadAgeing(nowMs);
      return { id: 'receivables', label: 'Receivables', minor: ageing.totalMinor, ...(ageing.overdueMinor > 0 ? { hintMinor: ageing.overdueMinor, hint: 'overdue' } : { hint: `${ageing.count} open invoice${ageing.count === 1 ? '' : 's'}` }), href: '/admin/finance/receivables' };
    }),
    settle(async (): Promise<KpiFigure> => {
      const rows = must(await sb.from('payouts').select('id, amount_cents, currency, status').in('status', ['scheduled', 'approved']).limit(1000), 'payouts') as {
        amount_cents: number; currency: string | null;
      }[];
      const total = rows.reduce((a, p) => a + toPlat(Number(p.amount_cents ?? 0), p.currency ?? 'USD'), 0);
      return { id: 'payables', label: 'Payables', minor: total, hint: `${rows.length} supplier payout${rows.length === 1 ? '' : 's'} due`, href: '/admin/finance' };
    }),
    settle(async (): Promise<KpiFigure> => {
      const rows = must(await sb.rpc('admin_wallet_balances'), 'admin_wallet_balances') as { balance_cents: number; currency: string | null }[];
      const total = (rows ?? []).reduce((a, w) => a + toPlat(Number(w.balance_cents ?? 0), w.currency ?? 'USD'), 0);
      return { id: 'wallets', label: 'Customer wallets', minor: total, hint: 'customer money held', href: '/admin/wallet' };
    }),
    settle(async (): Promise<KpiFigure> => {
      const q = await approvalQueue({ status: 'waiting', limit: 500 });
      if (q.ok) {
        const mineToDecide = q.data.filter((a) => a.canDecide).length;
        return { id: 'approvals', label: 'Waiting for approval', count: q.data.length, hint: `${mineToDecide} you can decide`, href: '/office/approvals' };
      }
      if (!q.unavailable) throw new Error(q.error);
      // before migration 255: today's Finance approvals ("requested", Admin › Finance)
      const r = await sb.from('finance_approvals').select('id', { count: 'exact', head: true }).eq('status', 'requested');
      if (r.error) throw new Error(r.error.message);
      return { id: 'approvals', label: 'Waiting for approval', count: r.count ?? 0, hint: 'finance approvals', href: '/admin/finance' };
    }),
  ]);
  const items = [recv, pay, wal, appr].filter((x): x is { ok: true; data: KpiFigure } => x.ok).map((x) => x.data);
  return { items, fx };
}

/** Sales pipeline strip: today's /office and /admin counts, narrowed by the division switcher like today. */
export async function loadSalesKpis(s: Session): Promise<KpiFigure[]> {
  const scope = await getDivisionScope(s);
  const sb = await createClient();
  const div = scope.all ? null : scope.division.id;
  const head = (t: string) => {
    const q = sb.from(t).select('id', { count: 'exact', head: true });
    return div ? q.eq('division_id', div) : q;
  };
  const seesRequests = can(s, 'requests') || s.roles.includes('account_manager');
  const jobs: Promise<{ ok: true; data: KpiFigure } | { ok: false }>[] = [];
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  };
  if (seesRequests) {
    jobs.push(settle(async () => ({ id: 'rfqs-open', label: 'Sourcing requests to quote', count: await count(head('rfqs').in('status', ['submitted', 'assigned'])), hint: 'new or assigned', href: '/office/rfqs' })));
    jobs.push(settle(async () => ({ id: 'rfqs-quoted', label: 'Waiting for customer', count: await count(head('rfqs').eq('status', 'quoted')), hint: 'quotes sent', href: '/office/rfqs' })));
  }
  if (can(s, 'orders')) {
    jobs.push(settle(async () => ({ id: 'orders-open', label: 'Open orders', count: await count(head('orders').not('status', 'in', '(cancelled,closed)')), hint: 'not closed or cancelled', href: '/office/orders' })));
  }
  if (can(s, 'requests')) {
    jobs.push(settle(async () => ({ id: 'services', label: 'Service requests', count: await count(head('service_requests').in('status', ['requested', 'paid'])), hint: 'requested or paid', href: '/office/services' })));
  }
  return (await Promise.all(jobs)).filter((x): x is { ok: true; data: KpiFigure } => x.ok).map((x) => x.data);
}

/* ───────── money in and out ───────── */

export async function loadMoneyWeeks(nowMs: number): Promise<{ weeks: MoneyWeek[]; fx: Fx }> {
  const { toPlat, fx } = await fxCtx();
  const sb = await createClient();
  const since = new Date(nowMs - 8 * 7 * 86_400_000 - 7 * 86_400_000).toISOString();
  const r = await sb
    .from('ledger_entries')
    .select('debit_cents, credit_cents, currency, created_at, ledger_accounts!inner(code)')
    .in('ledger_accounts.code', ['cash:bank', 'cash:bank:CNY'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(5000);
  const rows = must(r, 'ledger_entries') as { debit_cents: number; credit_cents: number; currency: string | null; created_at: string }[];
  const weeks = weeklyMoney(rows.map((e) => ({ at: e.created_at, inMinor: Number(e.debit_cents ?? 0), outMinor: Number(e.credit_cents ?? 0), currency: e.currency ?? 'USD' })), nowMs, 8, toPlat);
  return { weeks, fx };
}

/* ───────── my work ───────── */

export async function loadMyWork(s: Session): Promise<{ items: QueueItem[]; stats: { open: number; needOwner: number; waitingCustomer: number; dueOrLate: number } }> {
  const scope = await getDivisionScope(s);
  const q = await getWorkQueue(s, scope);
  return { items: q.items, stats: q.stats };
}

/* ───────── pools ───────── */

export type PoolSoon = { id: string; code: string; title: string; filled: number; target: number; pct: number; deadline: string };

export async function loadPoolsClosing(s: Session, nowMs: number): Promise<PoolSoon[]> {
  const scope = await getDivisionScope(s);
  const sb = await createClient();
  let q = sb.from('pools').select('id, code, target_qty, filled_qty, deadline_at, products(title)').eq('status', 'open').gte('deadline_at', new Date(nowMs).toISOString())
    .order('deadline_at', { ascending: true }).limit(20);
  if (!scope.all) q = q.eq('division_id', scope.division.id);
  const [r, seeds] = await Promise.all([q, seedIds('pools')]);
  const rows = dropSeeds(must(r, 'pools') as { id: string; code: string; target_qty: number; filled_qty: number; deadline_at: string; products: unknown }[], seeds, 5);
  return rows.map((p) => {
    const prod = (Array.isArray(p.products) ? p.products[0] : p.products) as { title?: string } | null;
    const target = Math.max(0, Number(p.target_qty ?? 0));
    const filled = Math.max(0, Number(p.filled_qty ?? 0));
    return { id: p.id, code: p.code, title: prod?.title ?? 'Pool', filled, target, pct: target > 0 ? Math.min(100, Math.round((filled / target) * 100)) : 0, deadline: p.deadline_at };
  });
}

/* ───────── recent activity ───────── */

export type ActivityItem = { key: string; at: string; who: string; what: string };

export async function loadActivity(s: Session): Promise<{ items: ActivityItem[]; auditShown: boolean }> {
  const sb = await createClient();
  const auditShown = can(s, 'audit', 'view');
  const [audit, history] = await Promise.all([
    auditShown ? sb.from('audit_log').select('id, actor_id, action, entity, entity_id, created_at').order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as never[], error: null }),
    sb.from('status_history').select('id, entity, entity_id, from_status, to_status, actor_id, reason, created_at').order('created_at', { ascending: false }).limit(8),
  ]);
  const a = must(audit as { data: unknown; error: { message: string } | null }, 'audit_log') as { id: number; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; created_at: string }[];
  const h = must(history as { data: unknown; error: { message: string } | null }, 'status_history') as {
    id: number; entity: string; entity_id: string | null; from_status: string | null; to_status: string; actor_id: string | null; reason: string | null; created_at: string;
  }[];
  const ids = [...new Set([...a.map((x) => x.actor_id), ...h.map((x) => x.actor_id)].filter(Boolean) as string[])];
  const { data: people } = ids.length ? await sb.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  const items: ActivityItem[] = [
    ...a.map((x) => ({ key: `a${x.id}`, at: x.created_at, who: x.actor_id ? name.get(x.actor_id) ?? 'Staff' : 'System', what: `${humanize(x.action.replace('.', ' · '))}${x.entity_id ? ` — ${x.entity_id.slice(0, 40)}` : ''}` })),
    ...h.map((x) => ({
      key: `h${x.id}`, at: x.created_at, who: x.actor_id ? name.get(x.actor_id) ?? 'User' : 'System',
      what: `${humanize(x.entity)} ${x.from_status ? `${humanize(x.from_status)} → ` : ''}${humanize(x.to_status)}${x.reason ? ` (${x.reason})` : ''}`,
    })),
  ].sort((p, q) => q.at.localeCompare(p.at)).slice(0, 8);
  return { items, auditShown };
}
