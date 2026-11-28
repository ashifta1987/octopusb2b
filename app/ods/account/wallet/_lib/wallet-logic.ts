/**
 * ODS /account/wallet — pure wallet logic (unit tested): URL state (?view=available|held|due, ?period=month|quarter|year),
 * the statement period, and today's statuses → Appendix C payment names. Display only — balances come from today's
 * my_wallet_summary RPC and ledger; nothing is calculated here.
 */
import { hrefWith, one, type SearchParamsRecord } from '../../orders/_lib/commerce-format';

export type WalletView = 'available' | 'held' | 'due';
export type WalletPeriod = 'month' | 'quarter' | 'year';
export const WALLET_PERIODS: [WalletPeriod, string][] = [
  ['month', 'Month'],
  ['quarter', 'Quarter'],
  ['year', 'Year'],
];
export type WalletState = { view: WalletView; period: WalletPeriod };

export function parseWalletParams(sp: SearchParamsRecord): WalletState {
  const v = one(sp.view);
  const p = one(sp.period);
  return { view: v === 'held' || v === 'due' ? v : 'available', period: p === 'quarter' || p === 'year' ? p : 'month' };
}
export const walletHref = (s: WalletState, patch: Partial<WalletState> = {}, base = '/account/wallet') => {
  const n = { ...s, ...patch };
  return hrefWith(base, { view: n.view === 'available' ? null : n.view, period: n.period === 'month' ? null : n.period });
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Statement range for the period, ending today (UTC dates, the ledger's `from` / `to` format). */
export function periodRange(p: WalletPeriod, nowMs: number): { from: string; to: string } {
  const to = new Date(nowMs);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (p === 'year' ? 12 : p === 'quarter' ? 3 : 1), to.getUTCDate()));
  return { from: iso(from), to: iso(to) };
}

/** Today's CSV statement route with the range (app/account/ledger/statement). */
export const statementHref = (r: { from: string; to: string }, account: 'wallet' | 'all' = 'wallet') => hrefWith('/account/ledger/statement', { account, from: r.from, to: r.to });

/** wallet_topups.status → Appendix C payment name (pending / initiated = being checked by finance). */
export function transferStatusName(s: string): 'Pending' | 'Paid' | 'Failed' {
  return s === 'credited' ? 'Paid' : s === 'failed' ? 'Failed' : 'Pending';
}

/** wallet_holds.status → Appendix C payment name (captured = charged). */
export function walletHoldStatusName(s: string): 'Held' | 'Paid' | 'Released' {
  return s === 'open' ? 'Held' : s === 'captured' ? 'Paid' : 'Released';
}

export const HOLD_SERVICE: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: 'Warehouse (3PL)', brand: 'Make My Brand' };
