'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, buttonClass } from '@octopus/ui';
import { NamedTabLink } from '@octopus/ui/components/named-tab-link';
import type { AcceptInviteResult } from '../invite/actions';
import { AuthNotice } from './notice';

/**
 * Accept / Not now for one invitation. Success → links on: My account (named tab "octopus-account", Part 4.6) and the
 * Shop (this tab). "Not now" leaves the invite pending and goes back to the introduction page.
 */
export function InviteAccept({ id, accept }: { id: string; accept: (id: string) => Promise<AcceptInviteResult> }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<AcceptInviteResult | null>(null);
  if (res?.ok) {
    return (
      <AuthNotice tone="info" title="You joined the team." testId="invite-accepted" state="accepted">
        <span className="mt-2 flex flex-wrap gap-3">
          <a href="/shop" className={buttonClass('primary')}>
            Go to the shop
          </a>
          <NamedTabLink href="/account/dropship" tab="account" className={buttonClass('secondary')}>
            Open My account ↗
          </NamedTabLink>
        </span>
      </AuthNotice>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {res && !res.ok ? (
        <AuthNotice tone={res.code === 'failed' ? 'danger' : 'warning'} title={res.code === 'expired' ? 'This invitation has expired.' : 'Not joined'} testId="invite-error" state={res.code}>
          {res.message}
        </AuthNotice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" loading={pending} loadingText="Joining…" data-testid="invite-accept" onClick={() => start(async () => setRes(await accept(id)))}>
          Accept invitation
        </Button>
        <Link href="/" className={buttonClass('ghost')} data-testid="invite-not-now">
          Not now
        </Link>
      </div>
    </div>
  );
}
