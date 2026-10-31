'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Switch } from '@/components/client';
import { stepUpRedirect } from '@/lib/staff/step-up';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

const STEP_UP = 'STEP_UP_REQUIRED';
const here = () => (typeof window === 'undefined' ? '/staff/workspace' : window.location.pathname + window.location.search);

/** SPEC §17.3 step-up: the action needs a fresh 2FA code → go to /staff/verify and come back. Returns true when navigating. */
export function goStepUp(r: R | null | undefined): boolean {
  if (!r || r.ok || r.error !== STEP_UP) return false;
  window.location.assign(r.redirect ?? stepUpRedirect(here()));
  return true;
}

/** Fallback link shown with a step-up error (e.g. if navigation was blocked). */
export function StepUpLink({ redirect, className = 'btn btn-primary btn-sm' }: { redirect?: string; className?: string }) {
  return <a href={redirect ?? stepUpRedirect(here())} className={className}>Confirm with your code</a>;
}
type FormAction = (prev: R | null, fd: FormData) => Promise<R>;

/**
 * Form bound to a server action with inline success / error feedback.
 * `confirm` shows a confirmation dialog first (destructive or money-moving actions).
 */
export function ActionForm({
  action, children, className, submitLabel = 'Save', submitClass = 'btn btn-primary', confirm, hideSubmit, resetOnSuccess, inline,
}: {
  action: FormAction; children?: React.ReactNode; className?: string; submitLabel?: React.ReactNode; submitClass?: string;
  confirm?: string; hideSubmit?: boolean; resetOnSuccess?: boolean; inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (prev: R | null, fd: FormData) => {
    const r = await action(prev, fd);
    goStepUp(r);
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (resetOnSuccess && state?.ok) ref.current?.reset(); }, [state, resetOnSuccess]);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      ref={ref}
    >
      {children}
      {!hideSubmit && (
        <div className={cn(inline ? 'inline-flex items-center gap-2' : 'mt-4 flex flex-wrap items-center gap-3')}>
          <button type="submit" className={submitClass} disabled={pending}>{pending ? 'Saving…' : submitLabel}</button>
          <Feedback state={state} />
        </div>
      )}
      {hideSubmit && <Feedback state={state} />}
    </form>
  );
}

function Feedback({ state }: { state: R | null }) {
  if (!state) return null;
  if (!state.ok && state.error === STEP_UP) {
    return <span role="alert" className="inline-flex items-center gap-2 text-sm text-bad">Please re-enter your 2FA code. <StepUpLink redirect={state.redirect} /></span>;
  }
  return state.ok
    ? <span role="status" className="text-sm text-ok font-semibold">✓ {state.message ?? 'Saved'}</span>
    : <span role="alert" className="text-sm text-bad">{state.error}</span>;
}

/** Master switch / toggle that calls a server action and refreshes the page. */
export function ToggleSetting({ checked, label, onToggle, disabled, showText }: {
  checked: boolean; label: string; onToggle: (v: boolean) => Promise<R>; disabled?: boolean; showText?: boolean;
}) {
  const [value, setValue] = useState(checked);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-3">
      <Switch
        checked={value}
        label={label}
        disabled={disabled || pending}
        onChange={(v) => {
          if (!window.confirm(`${v ? 'Turn ON' : 'Turn OFF'}: ${label}?`)) return;
          setErr(null);
          start(async () => {
            const r = await onToggle(v);
            if (goStepUp(r)) return;
            if (r.ok) { setValue(v); router.refresh(); } else setErr(r.error);
          });
        }}
      />
      {showText && <span className="font-semibold">{value ? 'ON' : 'OFF'}</span>}
      {err && <span role="alert" className="text-xs text-bad">{err}</span>}
    </span>
  );
}

/** Small button that runs a bound server action, with optional prompt for a reason. */
export function RunButton({ action, children, className = 'btn btn-ghost btn-sm', confirm, prompt }: {
  action: (reason?: string) => Promise<R>; children: React.ReactNode; className?: string; confirm?: string; prompt?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<R | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          let reason: string | undefined;
          if (prompt) {
            const v = window.prompt(prompt);
            if (v == null) return;
            reason = v;
          } else if (confirm && !window.confirm(confirm)) return;
          setMsg(null);
          start(async () => {
            const r = await action(reason);
            if (goStepUp(r)) return;
            setMsg(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? '…' : children}
      </button>
      {msg && !msg.ok && <span role="alert" className="text-xs text-bad mt-1 max-w-[220px]">{msg.error}</span>}
      {msg && msg.ok && msg.message && <span role="status" className="text-xs text-ok mt-1 max-w-[260px]">{msg.message}</span>}
    </span>
  );
}
