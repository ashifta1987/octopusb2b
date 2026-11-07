import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { BANK_COLS, accountFor, type BankAccount } from '@/lib/bank-accounts';

/** The principal company's active bank account for a currency (RLS: signed-in users read active accounts only). */
export async function getCompanyBankAccount(currency: string | null | undefined): Promise<BankAccount | null> {
  const sb = await createClient();
  const { data } = await sb.from('company_bank_accounts').select(BANK_COLS).eq('active', true);
  return accountFor((data ?? []) as BankAccount[], currency);
}
