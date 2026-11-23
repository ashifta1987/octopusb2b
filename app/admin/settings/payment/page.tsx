import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Notice } from '@/components/ui';
import { BankAccounts } from '@/components/admin/bank-accounts';
import { PaymentMatrixAndProvidersClient } from './matrix-client';
import type { PaymentOptionMatrixRow, PaymentProviderSettingRow } from '@/lib/payments';

export const metadata = { title: 'Payment settings' };

/**
 * Finance › Payment settings (/admin/settings/payment).
 * Company-wide Admin and company-wide Finance only.
 * Includes:
 *  1. Bank transfer accounts (USD TT, Hong Kong / Shenzhen).
 *  2. Service × Payment option matrix (8 services × 3 options: Pay now, Payment protection, Pay later).
 *  3. Payment provider routing & fee mode (Stripe, Airwallex, Mock; absorb vs surcharge with compliance warning).
 *  4. Multi-company legal entities (Shenzhen Octopus Trading Co., Ltd. default + upcoming Hong Kong company).
 */
async function PaymentSettingsContent() {
  const s = await requireStaff('finance', 'view', '/admin/settings/payment');
  const isCompanyWideFinanceOrAdmin = s.isAdmin || s.roles.includes('finance');
  if (!isCompanyWideFinanceOrAdmin) {
    return (
      <Notice tone="amber">
        Payment settings are restricted to company-wide Admin and company-wide Finance staff.
      </Notice>
    );
  }

  const sb = await createClient();
  const [{ data: c }, { data: matrix }, { data: providers }, { data: entities }] = await Promise.all([
    sb.from('company_profile').select('legal_name').eq('id', 1).maybeSingle(),
    sb
      .from('payment_option_settings')
      .select('service, option, enabled, min_amount_cents, max_amount_cents, release_rule, auto_release_days, pay_later_invoice_trigger')
      .order('service')
      .order('option'),
    sb
      .from('payment_provider_settings')
      .select('provider, display_name, enabled, methods, priority, legal_entity_id, fee_mode, fee_bp, fee_fixed_cents')
      .order('priority', { ascending: true }),
    sb
      .from('legal_entities')
      .select('id, code, legal_name, registration_no, tax_id, address, registered_in, default_currency, active_from, is_default, status')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  ]);

  const canEdit = isCompanyWideFinanceOrAdmin && (s.isAdmin || can(s, 'finance', 'edit'));

  return (
    <>
      <PageHeader
        title="Payment settings"
        subtitle="Manage the 3 payment options per service (Pay now, Payment protection, Pay later), online payment providers (Stripe, Airwallex, Mock), legal entities, and company bank accounts."
      />
      <BankAccounts isAdmin={canEdit} legalName={(c?.legal_name as string) ?? ''} />
      <PaymentMatrixAndProvidersClient
        matrix={((matrix ?? []) as unknown) as PaymentOptionMatrixRow[]}
        providers={((providers ?? []) as unknown) as PaymentProviderSettingRow[]}
        entities={(entities ?? []) as never[]}
        canEdit={canEdit}
        isAdmin={s.isAdmin}
      />
    </>
  );
}

export default function PaymentSettings() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}>
      <PaymentSettingsContent />
    </Suspense>
  );
}
