import { Suspense } from 'react';
import Link from 'next/link';
import { getSiteContent } from '@/lib/content';
import { cn } from '@/lib/cn';

const STEPS = ['Sign in', 'Verify', 'Workspace'] as const;

async function CompanyName() {
  const { company } = await getSiteContent();
  return company?.legal_name ? <span>{company.legal_name}</span> : null;
}

/** StaffLogin.png frame: navy staff-portal panel on the left, 3-step progress + content on the right. */
export function StaffFrame({ step, children }: { step: 0 | 1 | 2 | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-wrap bg-pearl text-ink">
      <aside className="flex-[1_1_420px] bg-ink text-white p-8 sm:p-12 flex flex-col gap-9">
        <div className="flex items-center gap-3.5 flex-wrap">
          <Link href="/" aria-label="Octopus B2B home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-white.png" alt="Octopus B2B" className="h-16 w-auto block" />
          </Link>
          <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-full bg-coral text-white">Staff portal</span>
        </div>
        <div className="flex flex-col gap-4 max-w-[460px]">
          <h1 className="!text-white m-0 font-display font-extrabold text-[30px] sm:text-[40px] leading-[1.1] tracking-[-0.02em]">Back office sign-in</h1>
          <p className="m-0 text-[17px] leading-[1.55] text-line-strong">For Octopus team members: operations, finance, support, sourcing, QC, content, distributors and admins.</p>
        </div>
        <ul className="list-none m-0 p-0 flex flex-col gap-4 text-[15px] text-fill">
          <li className="flex gap-3 items-start">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-on-ink-link"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /></svg>
            Accounts by invitation from Admin only
          </li>
          <li className="flex gap-3 items-start">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-on-ink-link"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            Two-step verification on every sign-in
          </li>
          <li className="flex gap-3 items-start">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-on-ink-link"><path d="M4 5h16M4 12h16M4 19h10" /></svg>
            Every sign-in and action is recorded in the audit log
          </li>
        </ul>
        <div className="mt-auto flex flex-col gap-1.5 text-[13px] text-muted">
          <span>Lost access or your phone? Ask an Admin to reset your two-step verification.</span>
          <Suspense fallback={null}><CompanyName /></Suspense>
        </div>
      </aside>
      <main className="flex-[1.3_1_520px] min-w-0 flex items-start justify-center px-4 sm:px-6 py-14">
        <div className="w-full max-w-[480px] flex flex-col gap-6">
          {step !== null && <StepBar step={step} />}
          {children}
        </div>
      </main>
    </div>
  );
}

export function StepBar({ step }: { step: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Sign-in steps" className="grid grid-cols-3 gap-2 list-none m-0 p-0">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('flex flex-col gap-2 text-[13px] font-semibold', i <= step ? 'text-ink' : 'text-muted')}>
          <span className={cn('block h-[5px] rounded', i <= step ? 'bg-coral' : 'bg-line')} aria-hidden />
          {s}
          {i < step && <span className="sr-only">(done)</span>}
        </li>
      ))}
    </ol>
  );
}

export { StaffHeading, LockNotice } from './bits';

export function FrameFallback() {
  return <div className="h-64 rounded-[10px] bg-white/60 animate-pulse" aria-hidden />;
}
