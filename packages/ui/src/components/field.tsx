'use client';

import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, Lock } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';

/** What a Field hands to its control (via context, or the render-prop argument). */
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
  disabled?: boolean;
  readOnly?: boolean;
};

type FieldContextValue = FieldControlProps & { reportError: (message: string | null) => void };
const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  label: ReactNode;
  /** Adds a red "*" (+ sr-only "required") and aria-required on the control. */
  required?: boolean;
  /** Shows "(optional)" after the label instead (use one convention per form). */
  optional?: boolean;
  hint?: ReactNode;
  /** Error under the control in danger red with an icon; sets aria-invalid. Say what happened and how to fix it. */
  error?: ReactNode;
  disabled?: boolean;
  /** Disabled fields say why (2.6); shown under the control and linked with aria-describedby. */
  disabledReason?: ReactNode;
  readOnly?: boolean;
  /** Control id (default: generated with useId, so two density copies never clash). */
  id?: string;
  className?: string;
  /** A control from this group (reads the ids from context) or a render-prop receiving them. */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
};

/**
 * Field (2.5): label ABOVE (label size, 600), optional required "*", hint below, error below in danger red with an
 * icon. Never use placeholder text as the label. The control gets id, aria-describedby (hint + reason + error),
 * aria-invalid and aria-required. The error sits in a polite live region, so it is announced when it appears.
 * Controls can also report their own validation message (NumberInput, QuantityStepper) when no `error` is given.
 * Phones: same (full width; the label stays above).
 */
export function Field({ label, required, optional, hint, error, disabled, disabledReason, readOnly, id: idProp, className, children }: FieldProps) {
  const auto = useId();
  const id = idProp ?? `f${auto}`;
  const hintId = `${id}-hint`;
  const reasonId = `${id}-reason`;
  const errorId = `${id}-error`;
  const [internal, setInternal] = useState<string | null>(null);
  const reportError = useCallback((m: string | null) => setInternal(m), []);
  const shownError = error ?? internal;
  const showReason = disabled && disabledReason;
  const describedBy = cx(!!hint && hintId, !!showReason && reasonId, !!shownError && errorId) || undefined;
  const control = useMemo<FieldContextValue>(
    () => ({
      id,
      'aria-describedby': describedBy,
      'aria-invalid': shownError ? true : undefined,
      'aria-required': required ? true : undefined,
      disabled: disabled || undefined,
      readOnly: readOnly || undefined,
      reportError,
    }),
    [id, describedBy, shownError, required, disabled, readOnly, reportError],
  );
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-ods-label font-semibold text-ods-navy">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ms-0.5 text-ods-danger">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : optional ? (
          <span className="font-normal text-ods-slate"> (optional)</span>
        ) : null}
      </label>
      <FieldContext.Provider value={control}>{typeof children === 'function' ? children(stripReport(control)) : children}</FieldContext.Provider>
      {hint ? (
        <p id={hintId} className="text-ods-small text-ods-slate">
          {hint}
        </p>
      ) : null}
      {showReason ? (
        <p id={reasonId} className="flex items-center gap-1 text-ods-small text-ods-slate">
          <Icon icon={Lock} size="xs" />
          {disabledReason}
        </p>
      ) : null}
      <div aria-live="polite">
        {shownError ? (
          <p id={errorId} className="flex items-start gap-1 text-ods-small font-medium text-ods-danger">
            <Icon icon={CircleAlert} size="xs" className="mt-[0.15em]" />
            <span>{shownError}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function stripReport({ reportError: _r, ...rest }: FieldContextValue): FieldControlProps {
  void _r;
  return rest;
}

type OwnAria = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  'aria-required'?: boolean | 'true' | 'false';
  disabled?: boolean;
  readOnly?: boolean;
};

/**
 * For controls: merges the enclosing Field's ids/state with the control's own props (own props win, describedby is
 * joined). Outside a Field it just returns a stable id. `reportError` lets a control show its own validation message.
 */
export function useFieldControl(own: OwnAria = {}) {
  const ctx = useContext(FieldContext);
  const auto = useId();
  const id = own.id ?? ctx?.id ?? `c${auto}`;
  return {
    id,
    describedBy: cx(ctx?.['aria-describedby'], own['aria-describedby']) || undefined,
    invalid: own['aria-invalid'] !== undefined ? own['aria-invalid'] === true || own['aria-invalid'] === 'true' : !!ctx?.['aria-invalid'],
    required: own['aria-required'] !== undefined ? own['aria-required'] === true || own['aria-required'] === 'true' : !!ctx?.['aria-required'],
    disabled: own.disabled ?? ctx?.disabled ?? false,
    readOnly: own.readOnly ?? ctx?.readOnly ?? false,
    reportError: ctx?.reportError,
    inField: !!ctx,
  };
}
