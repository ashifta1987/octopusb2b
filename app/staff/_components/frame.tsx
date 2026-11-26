import { Suspense } from 'react';
import { getSiteContent } from '@/lib/content';
import { cn } from '@/lib/cn';
import { AppLogo } from '@/components/shell/app-logo';

const STEPS = ['Sign in', 'Verify', 'Workspace'] as const;

async function CompanyName() {
  const { company } = await getSiteContent();
  return company?.legal_name ? <span>{company.legal_name}</span> : null;
}

const Tick = () => (
  <span className="flex-none w-[22px] h-[22px] mt-px rounded-full bg-tint text-coral-text flex items-center justify-center" aria-hidden>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
  </span>
);

/**
 * StaffLogin.png frame — design handoff 26 Nov 2026 page 11: white header (full-colour logo, "Staff portal" badge),
 * the staff-portal card on the left, 3-step progress + content on the right. Same wording, steps and flow.
 */
export function StaffFrame({ step, children }: { step: 0 | 1 | 2 | null; children: React.ReactNode }) {
  return (
    <div className="app-shell min-h-screen bg-pearl text-ink">
      <a href="#staff-signin-main" className="skip-link">Skip to content</a>
      <header className="bg-white border-b border-line">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <AppLogo />
          <span className="inline-flex items-center text-[13px] font-bold px-4 py-2 rounded-full bg-ink text-white">Staff portal</span>
        </div>
      </header>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-10 sm:py-12 flex flex-wrap gap-8 lg:gap-10 items-start">
        <aside className="flex-[1_1_360px] lg:max-w-[468px] bg-white border border-line rounded-[24px] p-7 sm:p-10 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h1 className="m-0 font-display font-extrabold text-[34px] sm:text-[40px] leading-[1.1] tracking-[-0.01em] text-ink">Back office sign-in</h1>
            <p className="m-0 text-[17px] leading-[1.55] text-muted">For Octopus team members: operations, finance, support, sourcing, QC, content, distributors and admins.</p>
          </div>
          <ul className="list-none m-0 p-0 flex flex-col gap-3.5 text-[16px] text-black">
            <li className="flex gap-3 items-start"><Tick />Accounts by invitation from Admin only</li>
            <li className="flex gap-3 items-start"><Tick />Two-step verification on every sign-in</li>
            <li className="flex gap-3 items-start"><Tick />Every sign-in and action is recorded in the audit log</li>
          </ul>
          <div className="border-t border-line pt-5 flex flex-col gap-1.5 text-[15px] leading-[1.5] text-muted">
            <span>Lost access or your phone? Ask an Admin to reset your two-step verification.</span>
            <Suspense fallback={null}><CompanyName /></Suspense>
          </div>
        </aside>
        <main id="staff-signin-main" tabIndex={-1} className="flex-[1.3_1_480px] min-w-0">
          <div className="w-full max-w-[644px] flex flex-col gap-7">
            {step !== null && <StepBar step={step} />}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function StepBar({ step }: { step: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Sign-in steps" className="grid grid-cols-3 gap-4 list-none m-0 p-0">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? 'step' : undefined} className={cn('flex flex-col gap-2.5 text-[15px] font-bold', i <= step ? 'text-ink' : 'text-muted')}>
          <span className={cn('block h-[5px] rounded-full', i <= step ? 'bg-coral' : 'bg-line')} aria-hidden />
          {s}
          {i < step && <span className="sr-only">(done)</span>}
        </li>
      ))}
    </ol>
  );
}

export { StaffHeading, LockNotice } from './bits';

export function FrameFallback() {
  return <div className="h-64 rounded-[16px] bg-white/60 animate-pulse" aria-hidden />;
}
