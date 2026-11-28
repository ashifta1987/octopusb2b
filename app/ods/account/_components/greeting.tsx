'use client';

import { useSyncExternalStore } from 'react';
import { StatusPill } from '@octopus/ui';
import { greetingFor } from '../_lib/status';

const subscribe = () => () => {};

/**
 * Home greeting (H1): "Good afternoon, Anna" by the visitor's LOCAL time (2.7: customers see their own time zone).
 * The server renders "Hello, Anna" and the client swaps in the time-of-day greeting after hydration (no mismatch).
 * Company name + company status pill (Appendix C: Verified · Verification pending · Not verified).
 */
export function Greeting({ firstName, company, companyStatus }: { firstName: string; company: string; companyStatus: string }) {
  const hour = useSyncExternalStore(subscribe, () => new Date().getHours(), () => null);
  return (
    <div>
      <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">
        {greetingFor(hour)}
        {firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-ods-body text-ods-slate">
        <span>{company}</span>
        <StatusPill status={companyStatus} data-testid="company-status">
          {companyStatus === 'Verified' ? 'Verified company' : companyStatus}
        </StatusPill>
      </p>
    </div>
  );
}
