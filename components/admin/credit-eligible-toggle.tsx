'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui';
import { setOrgCreditEligibleAction } from '@/app/admin/customers/actions';

export function CreditEligibleToggle({
  orgId,
  initialEligible,
  isAdmin,
}: {
  orgId: string;
  initialEligible: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [eligible, setEligible] = useState(initialEligible);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handleToggle(nextValue: boolean) {
    setError(null);
    setNotice(null);
    if (!reason.trim()) {
      setError('Enter a reason before changing Pay-later credit eligibility.');
      return;
    }
    startTransition(async () => {
      const res = await setOrgCreditEligibleAction(orgId, nextValue, reason);
      if ('error' in res && res.error) {
        setError(res.error);
        return;
      }
      setEligible(nextValue);
      setReason('');
      setNotice(
        ('notice' in res && res.notice) ||
          (nextValue ? 'Pay later credit eligibility enabled.' : 'Pay later credit eligibility disabled.'),
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm" data-testid="org-credit-eligible-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted text-xs">
          Controls whether this organization may be assigned Pay-later credit terms or see the Pay later option at checkout.
        </p>
        <StatusBadge
          status={eligible ? 'eligible' : 'not_eligible'}
          label={eligible ? 'Eligible' : 'Not eligible'}
          tone={eligible ? 'green' : 'gray'}
        />
      </div>

      {isAdmin ? (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for change (required for audit log)"
            data-testid="credit-eligible-reason-input"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
          />
          {error && (
            <p className="text-xs text-red-700" role="alert" data-testid="credit-eligible-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-xs text-emerald-800" data-testid="credit-eligible-notice">
              {notice}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => handleToggle(!eligible)}
            data-testid="credit-eligible-toggle-btn"
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50"
          >
            {pending
              ? 'Saving…'
              : eligible
                ? 'Disable Pay later eligibility'
                : 'Enable Pay later eligibility'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">Only a company-wide Admin can change Pay-later credit eligibility.</p>
      )}
    </div>
  );
}
