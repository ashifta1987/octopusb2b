'use client';

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Switch, Textarea, cx, type ButtonProps } from '@octopus/ui';
import { goStepUp } from '@/components/admin/client';

/**
 * ODS T9 · Accounts batch A — ODS controls that call TODAY's server actions unchanged (app/admin/finance/actions.ts,
 * app/admin/actions.ts setSetting). Same behaviour as today's RunButton / ActionForm / ToggleSetting: confirm first
 * (an ODS Modal instead of window.confirm / window.prompt), STEP_UP_REQUIRED → goStepUp (re-enter the 2FA code and come
 * back), ok → router.refresh(), errors shown next to the control. No money logic here. (hideSubmit / submitVariant: T9 batch 5.)
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

function Feedback({ r, className }: { r: ActionResult | null; className?: string }) {
  if (!r) return null;
  return r.ok ? (
    <span role="status" className={cx('text-ods-small font-semibold text-ods-success', className)}>{r.message ?? 'Saved'}</span>
  ) : (
    <span role="alert" className={cx('text-ods-small text-ods-danger', className)}>{r.error}</span>
  );
}

/** Button → confirm (or reason) in a Modal → today's action. `reason` = the reject flow (required text). */
export function ConfirmRun({
  action, children, confirmTitle, confirmText, confirmLabel = 'Confirm', reason, variant = 'secondary', destructive, testId, refresh = true,
}: {
  action: (reason?: string) => Promise<ActionResult>;
  children: ReactNode;
  confirmTitle: string;
  confirmText?: ReactNode;
  confirmLabel?: string;
  /** Ask for a reason (label); empty is not allowed. */
  reason?: string;
  variant?: ButtonProps['variant'];
  destructive?: boolean;
  testId?: string;
  refresh?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant={variant} onClick={() => { setText(''); setErr(null); setOpen(true); }} loading={pending} data-testid={testId}>
        {children}
      </Button>
      <Feedback r={msg} className="max-w-[240px]" />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmText}
        confirmLabel={confirmLabel}
        destructive={destructive}
        loading={pending}
        onConfirm={() => {
          if (reason && !text.trim()) {
            setErr('Add a reason.');
            return;
          }
          start(async () => {
            const r = await action(reason ? text.trim() : undefined);
            setOpen(false);
            if (goStepUp(r)) return;
            setMsg(r);
            if (r.ok && refresh) router.refresh();
          });
        }}
      >
        {reason ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${testId ?? 'run'}-reason`} className="text-ods-label font-semibold text-ods-navy">{reason}</label>
            <Textarea id={`${testId ?? 'run'}-reason`} rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={err ? true : undefined} data-testid={testId ? `${testId}-reason` : undefined} />
            {err ? <p className="m-0 text-ods-small text-ods-danger">{err}</p> : null}
          </div>
        ) : null}
      </Modal>
    </span>
  );
}

/** Form → (optional confirm Modal) → today's form action (useActionState), reset on success, feedback after the button. */
export function ActionFormOds({
  action, children, submitLabel, confirm, className, resetOnSuccess, testId, hideSubmit, submitVariant,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  testId?: string;
  /** Read-only viewers: no submit button (today's hideSubmit). */
  hideSubmit?: boolean;
  submitVariant?: ButtonProps['variant'];
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    goStepUp(r);
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  const [ask, setAsk] = useState(false);
  const okRef = useRef(false);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      data-testid={testId}
      onSubmit={(e) => {
        if (!confirm) return;
        if (okRef.current) {
          okRef.current = false;
          return;
        }
        e.preventDefault();
        if (ref.current?.reportValidity()) setAsk(true);
      }}
    >
      {children}
      {hideSubmit ? null : (
        <div className="col-span-full mt-1 flex flex-wrap items-center gap-3">
          <Button type="submit" variant={submitVariant} loading={pending} loadingText="Saving">{submitLabel}</Button>
          <Feedback r={state} />
        </div>
      )}
      {confirm ? (
        <Modal
          open={ask}
          onClose={() => setAsk(false)}
          title={submitLabel}
          description={confirm}
          confirmLabel={submitLabel}
          onConfirm={() => {
            setAsk(false);
            okRef.current = true;
            ref.current?.requestSubmit();
          }}
        />
      ) : null}
    </form>
  );
}

/** Admin master switch → confirm Modal → today's setSetting(key, value). */
export function SettingSwitch({ label, description, checked, disabled, onToggle, testId }: {
  label: string; description?: string; checked: boolean; disabled?: boolean; onToggle: (v: boolean) => Promise<ActionResult>; testId?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(checked);
  const [ask, setAsk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <Switch
        label={label}
        description={description}
        checked={value}
        disabled={disabled || pending}
        disabledReason={disabled ? 'Admin only' : undefined}
        onCheckedChange={(v) => setAsk(v)}
        data-testid={testId}
      />
      {err ? <span role="alert" className="text-ods-small text-ods-danger">{err}</span> : null}
      <Modal
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={`${ask ? 'Turn ON' : 'Turn OFF'}: ${label}?`}
        confirmLabel={ask ? 'Turn on' : 'Turn off'}
        loading={pending}
        onConfirm={() => {
          const v = !!ask;
          setErr(null);
          start(async () => {
            const r = await onToggle(v);
            setAsk(null);
            if (goStepUp(r)) return;
            if (r.ok) {
              setValue(v);
              router.refresh();
            } else setErr(r.error);
          });
        }}
      />
    </div>
  );
}
