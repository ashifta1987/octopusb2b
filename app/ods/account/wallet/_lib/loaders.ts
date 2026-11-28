import 'server-only';
/**
 * ODS /account/wallet data — TODAY's sources, unchanged (components/account/wallet-view.tsx): my_wallet_summary RPC,
 * getCompanyBankAccount('USD') + bankLines, wallet_topups, wallet_holds, getOrgLedger(wallet, USD), getAmountsDue.
 * Each part loads and fails on its own (null = failed). Read-only.
 */
import { unstable_rethrow } from 'next/navigation';
import { requireAccount } from '../../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { bankLines } from '@/lib/bank-accounts';
import { getAmountsDue } from '@/lib/core/amounts-due';
import { transferReasonLabel } from '@/lib/core/transfer-reason';
import { getSettings } from '@/components/account/data';
import { getCompanyBankAccount } from '@/components/account/bank-data';
import { getOrgLedger } from '@/components/account/ledger-data';
import { nowMs } from '@/components/account/order-utils';
import { HOLD_SERVICE, periodRange, transferStatusName, walletHoldStatusName, type WalletPeriod } from './wallet-logic';

export type WalletTxVM = { id: string; at: string; memo: string; journal: string; creditCents: number; debitCents: number; balanceCents: number; currency: string };
export type WalletHoldVM = { id: string; at: string; service: string; ref: string; amountCents: number; statusName: 'Held' | 'Paid' | 'Released'; capturedCents: number };
export type WalletTransferVM = { id: string; at: string; claimedCents: number; receivedCents: number | null; note: string | null; bankRef: string | null; statusName: 'Pending' | 'Paid' | 'Failed'; rejectReason: string | null };
export type WalletDueVM = { totalUsdCents: number; otherCurrencies: [string, number][]; items: { id: string; kind: 'order' | 'proforma'; ref: string; cents: number; currency: string; href: string }[] };

export type WalletVM = {
  orgId: string;
  walletEnabled: boolean;
  summary: { reference: string; availableCents: number; onHoldCents: number; pendingCents: number } | null;
  bank: { lines: [string, string][]; notes: string | null } | null;
  bankFailed: boolean;
  transactions: WalletTxVM[] | null;
  holds: WalletHoldVM[] | null;
  transfers: WalletTransferVM[] | null;
  due: WalletDueVM | null;
  range: { from: string; to: string };
};

async function part<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}

export async function loadWallet(period: WalletPeriod): Promise<WalletVM> {
  const s = await requireAccount('/account/wallet');
  const org = s.org!;
  const sb = await createClient();
  const range = periodRange(period, nowMs());
  const [settings, summary, bank, transfers, holds, ledger, due] = await Promise.all([
    getSettings(),
    part(async () => {
      const { data, error } = await sb.rpc('my_wallet_summary');
      if (error) throw error;
      const w = data as { reference: string; available_cents: number; on_hold_cents: number; pending_transfers_cents: number } | null;
      return { reference: w?.reference ?? '', availableCents: Number(w?.available_cents ?? 0), onHoldCents: Number(w?.on_hold_cents ?? 0), pendingCents: Number(w?.pending_transfers_cents ?? 0) };
    }),
    part(async () => {
      const a = await getCompanyBankAccount('USD');
      return a ? { lines: bankLines(a), notes: a.notes ?? null } : { lines: [] as [string, string][], notes: null };
    }),
    part(async () => {
      const { data, error } = await sb
        .from('wallet_topups')
        .select('id, amount_cents, amount_received_cents, received_reason, received_reason_text, currency, bank_ref, status, reject_reason, created_at')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id as string,
        at: t.created_at as string,
        claimedCents: Number(t.amount_cents),
        receivedCents: t.amount_received_cents == null ? null : Number(t.amount_received_cents),
        note: transferReasonLabel(t.received_reason as string | null, t.received_reason_text as string | null) || null,
        bankRef: (t.bank_ref as string | null) ?? null,
        statusName: transferStatusName(t.status as string),
        rejectReason: (t.reject_reason as string | null) ?? null,
      }));
    }),
    part(async () => {
      const { data, error } = await sb.from('wallet_holds').select('id, amount_cents, service, ref_type, ref_id, status, captured_cents, created_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(25);
      if (error) throw error;
      return (data ?? []).map((h) => ({
        id: h.id as string,
        at: h.created_at as string,
        service: HOLD_SERVICE[h.service as string] ?? (h.service as string),
        ref: h.ref_id as string,
        amountCents: Number(h.amount_cents),
        statusName: walletHoldStatusName(h.status as string),
        capturedCents: Number(h.captured_cents ?? 0),
      }));
    }),
    part(() => getOrgLedger(org.id, { account: 'wallet', currency: 'USD', from: range.from, to: range.to })),
    part(async () => {
      const d = await getAmountsDue(org.id);
      const orderIds = [...d.orderDue].filter(([, v]) => v > 0).map(([k]) => k);
      const docIds = [...d.docDue].filter(([, v]) => v > 0).map(([k]) => k);
      const [{ data: os }, { data: ds }] = await Promise.all([
        orderIds.length ? sb.from('orders').select('id, code, currency').in('id', orderIds) : Promise.resolve({ data: [] as { id: string; code: string; currency: string }[] }),
        docIds.length ? sb.from('documents').select('id, number, currency').in('id', docIds) : Promise.resolve({ data: [] as { id: string; number: string; currency: string }[] }),
      ]);
      const items: WalletDueVM['items'] = [
        ...(os ?? []).map((o) => ({ id: o.id as string, kind: 'order' as const, ref: o.code as string, cents: d.orderDue.get(o.id as string) ?? 0, currency: (o.currency as string) ?? 'USD', href: `/account/orders/${encodeURIComponent(o.code as string)}#payment` })),
        ...(ds ?? []).map((x) => ({ id: x.id as string, kind: 'proforma' as const, ref: x.number as string, cents: d.docDue.get(x.id as string) ?? 0, currency: (x.currency as string) ?? 'USD', href: '/account/invoices?filter=due' })),
      ];
      return {
        totalUsdCents: Number(d.byCurrency.USD ?? 0),
        otherCurrencies: Object.entries(d.byCurrency).filter(([c, v]) => c !== 'USD' && Number(v) > 0) as [string, number][],
        items,
      };
    }),
  ]);
  return {
    orgId: org.id,
    walletEnabled: Boolean(settings.wallet_enabled),
    summary,
    bank: bank && bank.lines.length ? bank : null,
    bankFailed: bank === null,
    transactions: ledger
      ? [...ledger.rows].reverse().map((r) => ({ id: String(r.id), at: r.at, memo: r.memo, journal: r.journal, creditCents: r.credit, debitCents: r.debit, balanceCents: r.balance, currency: r.currency }))
      : null,
    holds,
    transfers,
    due,
    range,
  };
}
