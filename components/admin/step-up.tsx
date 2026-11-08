import { stepUpRedirect } from '@/lib/staff/step-up';

/** Small hint on screens with sensitive actions (SPEC §17.3: money approvals, restores, KYC documents, role changes). */
export function StepUpNote({ minutes = 10, className = '' }: { minutes?: number; className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      <span aria-hidden>🔒 </span>Sensitive actions ask for your 2FA code again if it is older than {minutes} minutes.
    </p>
  );
}

/** Server-rendered "Confirm with your code" call to action (when mfa_fresh() is already false at render time). */
export function StepUpCallout({ path, text = 'Your 2FA code is older than 10 minutes. Confirm it again to continue.', label = 'Confirm with your code' }: {
  path: string; text?: string; label?: string;
}) {
  return (
    <div role="status" className="rounded-[10px] border border-warn/40 bg-warn-bg text-warn px-4 py-3 flex flex-wrap items-center gap-3">
      <span className="text-sm flex-1 min-w-[200px]">{text}</span>
      <a href={stepUpRedirect(path)} className="btn btn-primary btn-sm">{label}</a>
    </div>
  );
}
