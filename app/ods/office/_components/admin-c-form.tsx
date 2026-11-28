'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, type ButtonProps } from '@octopus/ui';
import { goStepUp } from '@/components/admin/client';
import type { ActionResult } from './accounts-a-actions';

/**
 * ODS T9 · Admin batch C — ODS form that calls TODAY's form actions unchanged (useActionState), with an optional
 * confirm Modal, goStepUp on STEP_UP_REQUIRED, feedback, reset on success and `hideSubmit` for read-only viewers.
 * (Its own module so the admin screens don't depend on edits to accounts-a-actions.)
 */

function Feedback({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return r.ok ? <span role="status" className="text-ods-small font-semibold text-ods-success">{r.message ?? 'Saved'}</span> : <span role="alert" className="text-ods-small text-ods-danger">{r.error}</span>;
}

/** Form → (optional confirm Modal) → today's form action (useActionState), reset on success, feedback after the button. */
export function AdminForm({
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

