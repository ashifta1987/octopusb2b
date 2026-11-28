'use client';

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Breadcrumbs, Button, Modal, Textarea, cx } from '@octopus/ui';
import { goStepUp, StepUpLink } from '@/components/admin/client';
import { useOfficeWorkspace } from '@/app/ods/office/_components/office-context';

/** Today's admin action result (components/admin/server Result). */
export type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };
export type FormAction = (prev: R | null, fd: FormData) => Promise<R>;
export type ConfirmSpec = { title: string; body?: ReactNode; confirmLabel: string; destructive?: boolean };

const STEP_UP = 'STEP_UP_REQUIRED';

/** Inline result line (success / error / step-up), announced politely. */
export function ResultLine({ state }: { state: R | null }) {
  return (
    <span aria-live="polite" className="min-w-0 text-ods-small">
      {!state ? null : !state.ok && state.error === STEP_UP ? (
        <span role="alert" className="inline-flex flex-wrap items-center gap-2 font-medium text-ods-danger">
          Enter your 2-step code again to continue. <StepUpLink redirect={state.redirect} className="font-semibold underline" />
        </span>
      ) : state.ok ? (
        <span className="font-semibold text-ods-success">✓ {state.message ?? 'Saved'}</span>
      ) : (
        <span role="alert" className="font-medium text-ods-danger">
          {state.error}
        </span>
      )}
    </span>
  );
}

/**
 * ODS T9 · Website screens: a form bound to TODAY's server action (unchanged `(prev, FormData) => Result`), with a save
 * bar: Save (or the form's own intent buttons), "Unsaved changes", Discard, the result line, and the workspace tab's
 * unsaved dot (useOfficeWorkspace().markDirty). `confirm` asks first in an ODS Modal (today: window.confirm). Step-up 2FA
 * redirects exactly like today's ActionForm (goStepUp).
 */
export function OdsForm({
  action,
  children,
  submitLabel = 'Save',
  hideSubmit,
  confirm,
  resetOnSuccess,
  sticky,
  buttons,
  className,
  label,
  'data-testid': testId,
}: {
  action: FormAction;
  children: ReactNode;
  submitLabel?: string;
  hideSubmit?: boolean;
  confirm?: ConfirmSpec;
  resetOnSuccess?: boolean;
  /** save bar sticks to the bottom of the screen (long forms) */
  sticky?: boolean;
  /** own submit buttons (e.g. Save draft / Send for review / Publish with name="intent") instead of Save */
  buttons?: ReactNode;
  className?: string;
  /** accessible name of the form */
  label?: string;
  'data-testid'?: string;
}) {
  const ws = useOfficeWorkspace();
  const ref = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState<FormData | null>(null);
  const [, start] = useTransition();
  const [state, dispatch, pending] = useActionState(async (prev: R | null, fd: FormData) => {
    const r = await action(prev, fd);
    goStepUp(r);
    return r;
  }, null);
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    const t = setTimeout(() => {
      setDirty(false);
      ws.markDirty(false);
    }, 0);
    return () => clearTimeout(t);
  }, [state, resetOnSuccess, ws]);
  const touch = () => {
    if (!dirty) {
      setDirty(true);
      ws.markDirty(true);
    }
  };
  const showBar = !hideSubmit || !!buttons;
  return (
    <form
      ref={ref}
      aria-label={label}
      data-testid={testId}
      onChange={touch}
      onInput={touch}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter ?? undefined);
        if (confirm) setAsking(fd);
        else start(() => dispatch(fd));
      }}
      className={cx('flex min-w-0 flex-col gap-4', className)}
    >
      {children}
      {showBar ? (
        <div
          data-testid="save-bar"
          className={cx(
            'flex flex-wrap items-center gap-2',
            sticky && 'sticky bottom-0 z-[1] -mx-ods-pad-card mt-1 border-t border-ods-line bg-ods-surface px-ods-pad-card py-3',
          )}
        >
          {buttons ?? (
            <Button type="submit" size="sm" loading={pending} loadingText="Saving…">
              {submitLabel}
            </Button>
          )}
          {dirty && !pending ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  ref.current?.reset();
                  setDirty(false);
                  ws.markDirty(false);
                }}
              >
                Discard
              </Button>
              <span className="text-ods-small font-semibold text-ods-warning">Unsaved changes</span>
            </>
          ) : null}
          <ResultLine state={dirty ? null : state} />
        </div>
      ) : null}
      {confirm ? (
        <Modal
          open={!!asking}
          onClose={() => setAsking(null)}
          title={confirm.title}
          description={confirm.body}
          destructive={confirm.destructive}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            const fd = asking;
            setAsking(null);
            if (fd) start(() => dispatch(fd));
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * Button that runs one of TODAY's bound actions (approve, pause, delete …), with an ODS confirm Modal or a reason
 * prompt (today: window.confirm / window.prompt), then refreshes the page like today's RunButton.
 */
export function RunAction({
  action,
  children,
  variant = 'secondary',
  confirm,
  prompt,
  disabled,
  'data-testid': testId,
}: {
  action: (reason?: string) => Promise<R>;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  confirm?: ConfirmSpec;
  prompt?: { title: string; label: string; confirmLabel: string; required?: boolean };
  disabled?: boolean;
  'data-testid'?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<R | null>(null);
  const [pending, start] = useTransition();
  const run = (r?: string) =>
    start(async () => {
      const res = await action(r);
      if (goStepUp(res)) return;
      setState(res);
      if (res.ok) router.refresh();
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={variant} loading={pending} disabled={disabled} data-testid={testId} onClick={() => (confirm || prompt ? setOpen(true) : run())}>
        {children}
      </Button>
      <ResultLine state={state} />
      {confirm ? (
        <Modal open={open} onClose={() => setOpen(false)} title={confirm.title} description={confirm.body} destructive={confirm.destructive} confirmLabel={confirm.confirmLabel} onConfirm={() => (setOpen(false), run())} />
      ) : null}
      {prompt ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={prompt.title}
          confirmLabel={prompt.confirmLabel}
          onConfirm={() => {
            if (prompt.required && !reason.trim()) return;
            setOpen(false);
            run(reason.trim() || undefined);
            setReason('');
          }}
        >
          <label className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
            {prompt.label}
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
          </label>
        </Modal>
      ) : null}
    </span>
  );
}

/** Page head for the Website screens (breadcrumbs, H1, one line, actions). */
export function WebsiteHead({ title, subtitle, actions, crumb = 'Website' }: { title: string; subtitle: string; actions?: ReactNode; crumb?: string }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={[{ label: crumb }, { label: title }]} />
        <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">{title}</h1>
        <p className="m-0 max-w-[880px] text-ods-small text-ods-slate">{subtitle}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Small tinted note (info / warning / danger / success). */
export function Note({ tone = 'info', children, testId }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; testId?: string }) {
  const t = { warning: 'border-ods-warning/30 bg-ods-warning-tint text-ods-warning', danger: 'border-ods-danger/30 bg-ods-danger-tint text-ods-danger', success: 'border-ods-success/30 bg-ods-success-tint text-ods-success', info: 'border-ods-blue/30 bg-ods-info-tint text-ods-info' }[tone];
  return (
    <div data-testid={testId} className={cx('rounded-ods-control border px-3 py-2 text-ods-small font-medium', t)}>
      {children}
    </div>
  );
}

/** Native control styled like ODS inputs (for uncontrolled form fields with defaultValue). */
export const fieldCls = 'h-ods-control w-full min-w-0 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 text-ods-body text-ods-text disabled:cursor-not-allowed disabled:bg-ods-canvas disabled:text-ods-slate';
export const areaCls = 'w-full min-w-0 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 py-2 text-ods-body leading-relaxed text-ods-text disabled:cursor-not-allowed disabled:bg-ods-canvas disabled:text-ods-slate';
export const labelCls = 'flex min-w-0 flex-col gap-1 text-ods-label font-semibold text-ods-navy';
export const hintCls = 'text-ods-small font-normal text-ods-slate';
export const checkCls = 'flex min-h-ods-control items-center gap-2 text-ods-body text-ods-text';
