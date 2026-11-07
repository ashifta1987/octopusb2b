import { describe, expect, it } from 'vitest';
import { accountFor, bankLines, type BankAccount } from '@/lib/bank-accounts';

const A = (o: Partial<BankAccount> = {}): BankAccount => ({ id: '1', currency: 'USD', bank_name: 'HSBC Hong Kong', account_holder: 'Shenzhen Octopus Trading Co. Ltd.', account_number: '123-456789-838', swift: 'HSBCHKHHHKH', routing_code: null, bank_address: '1 Queen’s Road Central, Hong Kong', intermediary: null, notes: null, active: true, ...o });

describe('company bank accounts', () => {
  it('lists only the filled fields, in the order buyers copy them', () => {
    expect(bankLines(A()).map(([k]) => k)).toEqual(['Account name', 'Bank', 'Account number / IBAN', 'SWIFT / BIC', 'Bank address', 'Currency']);
  });
  it('picks the active account of the payment currency, never another currency', () => {
    const list = [A({ id: 'u-old', active: false }), A({ id: 'u' }), A({ id: 'c', currency: 'CNY' })];
    expect(accountFor(list, 'usd')?.id).toBe('u');
    expect(accountFor(list, 'CNY')?.id).toBe('c');
    expect(accountFor(list, 'EUR')).toBeNull();
    expect(accountFor(list, null)).toBeNull();
  });
});

