import type { ReactNode } from 'react';
import { cx } from '../cx';
import { statusTone, type StatusTone } from '../status';

export type StatusPillProps = {
  /** Overrides the tone. Omit it to take the tone from the Appendix C name in `status`. */
  tone?: StatusTone;
  /** An Appendix C status name (e.g. "Deposit due"). Shown as the text unless `children` is given. */
  status?: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

const TONE: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: 'bg-ods-success-tint text-ods-success', dot: 'bg-ods-success' },
  info: { pill: 'bg-ods-info-tint text-ods-info', dot: 'bg-ods-info' },
  warning: { pill: 'bg-ods-warning-tint text-ods-warning', dot: 'bg-ods-warning' },
  danger: { pill: 'bg-ods-danger-tint text-ods-danger', dot: 'bg-ods-danger' },
  neutral: { pill: 'bg-ods-canvas text-ods-slate border-ods-line', dot: 'bg-ods-slate' },
  indigo: { pill: 'bg-ods-svc-3pl-tint text-ods-svc-3pl', dot: 'bg-ods-svc-3pl' },
};

/**
 * Status pill (Part 2.5, Appendix C): a dot + the status text, never colour alone. Radius 999 comfortable, 4 compact
 * (`rounded-ods-pill`). Tone from `statusTone(status)` unless `tone` is given. Phones: same; the text never wraps.
 */
export function StatusPill({ tone, status, children, className, 'data-testid': testId }: StatusPillProps) {
  const t = tone ?? statusTone(status);
  return (
    <span
      data-tone={t}
      data-testid={testId}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 rounded-ods-pill border border-transparent px-2.5 py-0.5 text-ods-small font-semibold whitespace-nowrap',
        TONE[t].pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', TONE[t].dot)} />
      <span className="truncate">{children ?? status}</span>
    </span>
  );
}
