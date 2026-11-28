// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { can, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { BankAccounts } from '@/components/admin/bank-accounts';
import { PaymentMatrixAndProvidersClient } from '@/app/admin/settings/payment/matrix-client';
import type { PaymentOptionMatrixRow, PaymentProviderSettingRow } from '@/lib/payments';
import { paymentSettingsAccess } from '@/app/ods/office/_lib/admin-c-core';
import { SettingsShell } from '@/app/ods/office/_components/admin-c-company';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';

/**
 * ODS T9 · /admin/settings/payment. Guard as today: requireStaff('finance','view') and company-wide Admin or Finance
 * role (others see the restriction notice); editing needs admin or finance:edit. Same reads. The bank accounts and the
 * service × option matrix / providers / legal entities stay TODAY's client components (BankAccounts,
 * PaymentMatrixAndProvidersClient — their own actions and confirmations), inside the ODS page.
 */
export const metadata: Metadata = { title: 'Payment settings' };

export default function OdsPaymentSettingsPage() {
  return (
    <Suspense fallback={<PanelSkeleton title="Payment settings" testId="settings-payment-page" lines={8} />}>
      <Content />
    </Suspense>
  );
}

const TITLE = 'Payment settings';
const SUB = 'Manage the 3 payment options per service (Pay now, Payment protection, Pay later), online payment providers (Stripe, Airwallex, Mock), legal entities, and company bank accounts.';

async function Content() {
  const s = await requireStaff('finance', 'view', '/admin/settings/payment');
  const access = paymentSettingsAccess({ isAdmin: s.isAdmin, roles: s.roles, canFinanceEdit: can(s, 'finance', 'edit') });
  if (!access.allowed) {
    return <SettingsShell crumb="Admin › Payment settings" title={TITLE} sub={SUB} testId="settings-payment-page" notice="Payment settings are restricted to company-wide Admin and company-wide Finance staff." />;
  }
  const sb = await createClient();
  const [{ data: c }, { data: matrix }, { data: providers }, { data: entities }] = await Promise.all([
    sb.from('company_profile').select('legal_name').eq('id', 1).maybeSingle(),
    sb.from('payment_option_settings').select('service, option, enabled, min_amount_cents, max_amount_cents, release_rule, auto_release_days, pay_later_invoice_trigger').order('service').order('option'),
    sb.from('payment_provider_settings').select('provider, display_name, enabled, methods, priority, legal_entity_id, fee_mode, fee_bp, fee_fixed_cents').order('priority', { ascending: true }),
    sb.from('legal_entities').select('id, code, legal_name, registration_no, tax_id, address, registered_in, default_currency, active_from, is_default, status').order('is_default', { ascending: false }).order('created_at', { ascending: true }),
  ]);
  return (
    <SettingsShell crumb="Admin › Payment settings" title={TITLE} sub={SUB} testId="settings-payment-page" notice={access.canEdit ? undefined : 'View only: editing needs the Finance · edit permission.'}>
      <div className="ods-legacy-section flex min-w-0 flex-col gap-ods-gap">
        <BankAccounts isAdmin={access.canEdit} legalName={(c?.legal_name as string) ?? ''} />
        <PaymentMatrixAndProvidersClient
          matrix={(matrix ?? []) as unknown as PaymentOptionMatrixRow[]}
          providers={(providers ?? []) as unknown as PaymentProviderSettingRow[]}
          entities={(entities ?? []) as never[]}
          canEdit={access.canEdit}
          isAdmin={s.isAdmin}
        />
      </div>
    </SettingsShell>
  );
}
