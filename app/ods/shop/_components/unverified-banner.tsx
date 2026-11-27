import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import { buttonClass, Icon, NamedTabLink } from '@octopus/ui';
import { SHOP_PATHS } from '../_lib/sections';

/**
 * ODS T4 · "Company not verified" banner (Part 5.2 states, States-Shop): the company can browse, save products and send
 * requests, but can't pay until verified. `kycStatus` = organizations.kyc_status; 'pending' says we are checking.
 * "Verify in My account ↗" opens My account › Verification in the account tab.
 */
export function UnverifiedBanner({ kycStatus }: { kycStatus: string }) {
  const pending = kycStatus === 'pending' || kycStatus === 'submitted' || kycStatus === 'in_review';
  return (
    <section
      aria-labelledby="unverified-heading"
      data-testid="unverified-banner"
      data-kyc={kycStatus}
      className="flex flex-col gap-3 rounded-ods-card border border-ods-warning/40 bg-ods-warning-tint p-ods-pad-card ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon icon={ShieldAlert} size="lg" className="mt-0.5 shrink-0 text-ods-warning" />
        <div className="min-w-0">
          <h2 id="unverified-heading" className="m-0 text-ods-body font-bold text-ods-navy">
            {pending ? 'We are checking your company' : 'Verify your company to place orders'}
          </h2>
          <p className="m-0 mt-1 text-ods-small text-ods-text">
            {pending
              ? 'You can browse, save products and send requests now. Payments open as soon as the check is done.'
              : 'You can browse, save products and send requests now. Payments open after verification.'}
          </p>
        </div>
      </div>
      <NamedTabLink href={SHOP_PATHS.verify} tab="account" className={`${buttonClass('primary', 'md')} shrink-0 self-start ods-tablet:self-center`} data-testid="verify-link">
        Verify in My account
        <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
        <span className="sr-only">(opens the My account tab)</span>
      </NamedTabLink>
    </section>
  );
}
