import type { ReactNode } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { STEP_STATUS_TEXT, stepStatuses, type StepStatus } from '../selection-logic';

export type StepperStep = {
  id: string;
  label: ReactNode;
  /** Date or one-line detail, e.g. "27 Nov 2026" or "Payment received". */
  detail?: ReactNode;
  /** Overrides the status derived from `current`. */
  status?: StepStatus;
  /** For an error step: what happened and what to do next (shown as text, never colour alone). */
  errorText?: ReactNode;
};

export type StepperProps = {
  steps: StepperStep[];
  /** Index of the current step (earlier = done, later = not started). `steps.length` = all done. Default 0. */
  current?: number;
  /** Accessible name of the list, e.g. "Order progress". */
  label: string;
  /** Force one layout; default = vertical on phones, horizontal from 768 px (`ods-tablet:`). */
  orientation?: 'responsive' | 'vertical' | 'horizontal';
  className?: string;
  'data-testid'?: string;
};

const MARKER: Record<StepStatus, string> = {
  done: 'bg-ods-teal text-ods-navy',
  current: 'bg-ods-blue text-white ring-4 ring-ods-blue-tint',
  upcoming: 'border-2 border-ods-line-strong bg-ods-surface text-ods-slate',
  error: 'bg-ods-danger text-white ring-4 ring-ods-danger-tint',
};

// literal class strings per layout (Tailwind only sees complete class names)
const LAYOUT = {
  vertical: { list: 'flex-col', item: 'gap-3', itemGap: 'pb-5', line: 'start-[15px] top-9 bottom-1 w-0.5' },
  horizontal: { list: 'flex-row', item: 'flex-1 flex-col gap-2 pe-3', itemGap: '', line: 'start-11 end-1 top-[15px] h-0.5' },
  responsive: {
    list: 'flex-col ods-tablet:flex-row',
    item: 'gap-3 ods-tablet:flex-1 ods-tablet:flex-col ods-tablet:gap-2 ods-tablet:pe-3',
    itemGap: 'pb-5 ods-tablet:pb-0',
    line: 'start-[15px] top-9 bottom-1 w-0.5 ods-tablet:start-11 ods-tablet:end-1 ods-tablet:top-[15px] ods-tablet:bottom-auto ods-tablet:h-0.5 ods-tablet:w-auto',
  },
} as const;

/**
 * Stepper, Part 2.5: order progress, pool, Turnkey, checkout, verification. Server-safe (no state).
 * Done = teal circle with a check; now = blue with a halo; next = grey outline; error = red with a warning icon and
 * the words "Needs attention" + `errorText` (never colour alone). Every step carries its status in words
 * (sr-only for done / current / not started).
 * Markup: `<ol aria-label>`; the current step has `aria-current="step"`.
 * Phones: vertical list (marker column + connecting line); from 768 px (`ods-tablet:`) horizontal with connectors.
 */
export function Stepper({ steps, current = 0, label, orientation = 'responsive', className, 'data-testid': testId }: StepperProps) {
  const derived = stepStatuses(steps.length, current);
  const L = LAYOUT[orientation];
  return (
    <ol aria-label={label} data-testid={testId} className={cx('flex min-w-0', L.list, className)}>
      {steps.map((step, i) => {
        const status = step.status ?? derived[i];
        const last = i === steps.length - 1;
        return (
          <li key={step.id} aria-current={status === 'current' ? 'step' : undefined} className={cx('relative flex min-w-0', L.item, !last && L.itemGap)}>
            {!last ? (
              <span
                aria-hidden="true"
                className={cx('absolute rounded', L.line, status === 'done' ? 'bg-ods-teal' : 'bg-ods-line-strong')}
              />
            ) : null}
            <span className={cx('relative inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ods-small font-bold tabular-nums', MARKER[status])} aria-hidden="true">
              {status === 'done' ? <Icon icon={Check} size="sm" /> : status === 'error' ? <Icon icon={AlertTriangle} size="sm" /> : i + 1}
            </span>
            <span className="min-w-0 pt-1">
              <span className="sr-only">{`${STEP_STATUS_TEXT[status]}: `}</span>
              <span className={cx('block text-ods-label', status === 'upcoming' ? 'font-medium text-ods-slate' : 'font-semibold text-ods-navy')}>{step.label}</span>
              {step.detail ? <span className="block text-ods-small text-ods-slate">{step.detail}</span> : null}
              {status === 'error' ? (
                <span className="mt-0.5 block text-ods-small font-semibold text-ods-danger">
                  {STEP_STATUS_TEXT.error}
                  {step.errorText ? <span className="font-normal">: {step.errorText}</span> : null}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
