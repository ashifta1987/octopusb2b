/** Principal company bank accounts (migration 174): types + the lines shown to buyers. Pure, server/client safe. */
export type BankAccount = {
  id: string; currency: string; bank_name: string; account_holder: string; account_number: string; swift: string | null;
  routing_code: string | null; bank_address: string | null; intermediary: string | null; notes: string | null; active: boolean; updated_at?: string;
};
export const BANK_COLS = 'id, currency, bank_name, account_holder, account_number, swift, routing_code, bank_address, intermediary, notes, active, updated_at';

/** Label / value rows in the order buyers copy them into their banking app. */
export function bankLines(a: BankAccount): [string, string][] {
  return ([
    ['Account name', a.account_holder],
    ['Bank', a.bank_name],
    ['Account number / IBAN', a.account_number],
    ['SWIFT / BIC', a.swift],
    ['Routing / sort code', a.routing_code],
    ['Bank address', a.bank_address],
    ['Intermediary bank', a.intermediary],
    ['Currency', a.currency],
  ] as [string, string | null][]).filter((r): r is [string, string] => !!r[1]);
}

/** Pick the active account for a currency (falls back to none — never to another currency's account). */
export function accountFor(list: BankAccount[], currency: string | null | undefined): BankAccount | null {
  const c = (currency ?? '').toUpperCase();
  return list.find((a) => a.active && a.currency === c) ?? null;
}
