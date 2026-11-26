'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { DsIcon, type DsIconName } from './icons';

export { DsIcon, DS_ICONS, type DsIconName } from './icons';

/* ───────────────────────────────────────────────────────────────────────────
 * 1. Button (primary, secondary, danger, text link; hover, keyboard focus ring,
 *    loading, disabled with the reason shown next to it)
 * ─────────────────────────────────────────────────────────────────────────── */
export type DsButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

export type DsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: DsButtonVariant;
  icon?: DsIconName;
  loading?: boolean;
  disabledReason?: ReactNode;
  testId?: string;
};

const BTN_VARIANT: Record<Exclude<DsButtonVariant, 'link'>, string> = {
  primary: 'ds-btn ds-btn-primary',
  secondary: 'ds-btn ds-btn-secondary',
  danger: 'ds-btn ds-btn-danger',
};

export function DsButton({
  variant = 'primary',
  icon,
  loading = false,
  disabled,
  disabledReason,
  children,
  className = '',
  testId,
  type = 'button',
  ...rest
}: DsButtonProps) {
  const isDisabled = Boolean(disabled);
  const reasonId = useId();

  if (variant === 'link') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          type={type}
          disabled={isDisabled}
          aria-busy={loading || undefined}
          aria-describedby={isDisabled && disabledReason ? reasonId : undefined}
          data-testid={testId}
          className={`inline-flex items-center gap-1.5 min-h-[44px] px-1 text-[14px] font-semibold text-coral-text hover:text-ink hover:underline disabled:text-muted disabled:no-underline disabled:cursor-not-allowed cursor-pointer bg-transparent border-0 ${className}`.trim()}
          {...rest}
        >
          {icon && <DsIcon name={icon} size={16} />}
          {children}
        </button>
        {isDisabled && disabledReason && (
          <span id={reasonId} className="text-[12px] text-muted" data-testid="disabled-reason">
            {disabledReason}
          </span>
        )}
      </span>
    );
  }

  const buttonEl = (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-describedby={isDisabled && disabledReason ? reasonId : undefined}
      data-testid={testId}
      className={`${BTN_VARIANT[variant]} ${className}`.trim()}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block w-[14px] h-[14px] rounded-full border-2 border-current border-r-transparent animate-spin shrink-0"
        />
      ) : icon ? (
        <DsIcon name={icon} size={16} />
      ) : null}
      {children}
    </button>
  );

  if (isDisabled && disabledReason) {
    return (
      <div className="inline-flex flex-col items-start gap-1.5">
        {buttonEl}
        <p id={reasonId} className="m-0 text-[12px] text-muted" data-testid="disabled-reason">
          {disabledReason}
        </p>
      </div>
    );
  }

  return buttonEl;
}

export function DsLinkButton({
  href,
  variant = 'primary',
  icon,
  children,
  className = '',
  testId,
}: {
  href: string;
  variant?: DsButtonVariant;
  icon?: DsIconName;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  if (variant === 'link') {
    return (
      <Link
        href={href}
        data-testid={testId}
        className={`inline-flex items-center gap-1.5 min-h-[44px] text-[14px] font-semibold text-coral-text hover:text-ink hover:underline ${className}`.trim()}
      >
        {icon && <DsIcon name={icon} size={16} />}
        {children}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`${BTN_VARIANT[variant]} ${className}`.trim()}
    >
      {icon && <DsIcon name={icon} size={16} />}
      {children}
    </Link>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 2. Input / Select / Textarea with label, hint and error
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsInput({
  id,
  label,
  hint,
  error,
  className = '',
  containerClassName = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const msgId = `${inputId}-msg`;
  const hasError = Boolean(error);

  return (
    <div className={containerClassName}>
      <label className="ds-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError || hint ? msgId : undefined}
        className={`ds-input w-full ${className}`.trim()}
        {...rest}
      />
      {hasError ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function DsSelect({
  id,
  label,
  hint,
  error,
  children,
  className = '',
  containerClassName = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const msgId = `${selectId}-msg`;
  const hasError = Boolean(error);

  return (
    <div className={containerClassName}>
      <label className="ds-label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError || hint ? msgId : undefined}
        className={`ds-input w-full ${className}`.trim()}
        {...rest}
      >
        {children}
      </select>
      {hasError ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function DsTextarea({
  id,
  label,
  hint,
  error,
  className = '',
  containerClassName = '',
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
}) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const msgId = `${textareaId}-msg`;
  const hasError = Boolean(error);

  return (
    <div className={containerClassName}>
      <label className="ds-label" htmlFor={textareaId}>
        {label}
      </label>
      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError || hint ? msgId : undefined}
        className={`ds-input w-full py-2.5 ${className}`.trim()}
        {...rest}
      />
      {hasError ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 3. Checkbox & 4. Radio card & 5. Switch (role="switch")
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsCheckbox({
  label,
  hint,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 min-h-[44px] text-[14px] text-ink cursor-pointer ${className}`.trim()}
    >
      <input
        type="checkbox"
        className="w-4 h-4 accent-coral rounded shrink-0"
        {...rest}
      />
      <span>
        {label}
        {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function DsRadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  badge,
  disabled,
}: {
  name: string;
  value: string;
  checked?: boolean;
  onChange?: (value: string) => void;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 min-h-[44px] p-3.5 rounded-[12px] border-2 cursor-pointer transition-colors ${
        checked
          ? 'border-coral bg-tint'
          : 'border-line bg-white hover:border-line-strong'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(value)}
        className="mt-1 w-4 h-4 accent-coral shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2 flex-wrap">
          <strong className="text-[15px] font-bold text-ink">{title}</strong>
          {badge}
        </span>
        {description && (
          <span className="block mt-1 text-[13px] text-muted">{description}</span>
        )}
      </span>
    </label>
  );
}

export function DsSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  disabledReason,
  testId,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  disabledReason?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 min-h-[44px]">
      <div className="min-w-0">
        <span id={id} className="text-[15px] font-semibold text-ink">
          {label}
        </span>
        {hint && <p className="m-0 text-[12px] text-muted">{hint}</p>}
        {disabled && disabledReason && (
          <p className="m-0 text-[12px] text-muted" data-testid="disabled-reason">
            {disabledReason}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        data-testid={testId}
        onClick={() => !disabled && onChange?.(!checked)}
        className="inline-flex items-center min-h-[44px] min-w-[56px] bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`inline-flex items-center w-14 h-8 rounded-full p-1 transition-colors ${
            checked ? 'bg-ok' : 'bg-switch-off'
          }`}
        >
          <span
            className={`w-6 h-6 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
              checked ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </span>
      </button>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 6. Filter chip (aria-pressed)
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsChip({
  pressed,
  onClick,
  children,
  icon,
  testId,
}: {
  pressed: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: DsIconName;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className="ds-chip"
    >
      {icon && <DsIcon name={icon} size={14} />}
      {children}
    </button>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 7. Badge (ok, warn, bad, info, neutral — each with an icon AND words)
 * ─────────────────────────────────────────────────────────────────────────── */
export type DsBadgeTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

const BADGE_ICON: Record<DsBadgeTone, DsIconName> = {
  ok: 'check',
  warn: 'alert',
  bad: 'stop',
  info: 'info',
  neutral: 'clock',
};

export function DsBadge({
  tone = 'neutral',
  icon,
  children,
  className = '',
  testId,
}: {
  tone?: DsBadgeTone;
  icon?: DsIconName;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const iconName = icon ?? BADGE_ICON[tone];
  return (
    <span
      data-testid={testId}
      className={`ds-badge ds-badge-${tone} ${className}`.trim()}
    >
      <DsIcon name={iconName} size={12} strokeWidth={2.2} />
      <span>{children}</span>
    </span>
  );
}

export type DsOrderStatus =
  | 'awaiting_payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'on_hold'
  | 'cancelled'
  | 'refunded';

const ORDER_STATUS_MAP: Record<DsOrderStatus, { label: string; tone: DsBadgeTone; icon?: DsIconName }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn' },
  processing: { label: 'Processing', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'ok' },
  delivered: { label: 'Delivered', tone: 'ok' },
  on_hold: { label: 'On hold: address', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'x' },
  refunded: { label: 'Refunded', tone: 'neutral', icon: 'refresh' },
};

export function DsOrderStatusBadge({
  status,
  customLabel,
}: {
  status: DsOrderStatus;
  customLabel?: string;
}) {
  const cfg = ORDER_STATUS_MAP[status];
  return (
    <DsBadge tone={cfg.tone} icon={cfg.icon}>
      {customLabel ?? cfg.label}
    </DsBadge>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 8. Card with icon heading & 9. Table card (scroll box, Jost caps header, row hover)
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsCard({
  title,
  subtitle,
  icon,
  actions,
  noPadding = false,
  className = '',
  children,
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: DsIconName;
  actions?: ReactNode;
  noPadding?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`ds-card ${noPadding ? '!p-0' : ''} ${className}`.trim()}
    >
      {(title || actions) && (
        <div
          className={`flex justify-between items-start gap-3 flex-wrap ${
            noPadding ? 'px-6 py-[18px] border-b border-line' : 'mb-4'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="m-0 text-[19px] font-extrabold flex items-center gap-2.5 text-ink">
                {icon && <DsIcon name={icon} size={20} strokeWidth={2} className="text-coral-text" />}
                <span>{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 mb-0 text-[14px] text-muted">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function DsTableCard({
  title,
  subtitle,
  icon,
  actions,
  headers,
  children,
  footer,
  minWidth = 560,
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: DsIconName;
  actions?: ReactNode;
  headers: ReactNode[];
  children: ReactNode;
  footer?: ReactNode;
  minWidth?: number;
  testId?: string;
}) {
  return (
    <DsCard title={title} subtitle={subtitle} icon={icon} actions={actions} noPadding testId={testId}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={typeof title === 'string' ? title : 'Scrollable table'}>
        <table className="ds-tbl" style={{ minWidth }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {footer && (
        <div className="px-6 py-3 text-[13px] text-muted border-t border-divider">
          {footer}
        </div>
      )}
    </DsCard>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 10. Notice (info, ok, warn, bad) & 11. Toast & 12. Dialog
 * ─────────────────────────────────────────────────────────────────────────── */
export type DsNoticeTone = 'info' | 'ok' | 'warn' | 'bad';

// Octopus tokens (design handoff §2): info = tint / coral-text, ok = success, warn = warning, bad = error
const NOTICE_STYLES: Record<DsNoticeTone, { box: string; icon: DsIconName; iconColor: string }> = {
  info: { box: 'bg-tint-2 border-tint', icon: 'info', iconColor: 'text-coral-text' },
  ok: { box: 'bg-ok-soft border-ok-line', icon: 'check', iconColor: 'text-ok' },
  warn: { box: 'bg-warn-bg border-warn-line', icon: 'alert', iconColor: 'text-warn' },
  bad: { box: 'bg-bad-bg border-bad/30', icon: 'stop', iconColor: 'text-bad' },
};

export function DsNotice({
  tone = 'info',
  title,
  children,
  action,
  testId,
}: {
  tone?: DsNoticeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const s = NOTICE_STYLES[tone];
  return (
    <div
      role="status"
      data-testid={testId}
      className={`flex items-center justify-between gap-3.5 flex-wrap rounded-[12px] border px-[18px] py-[14px] ${s.box}`}
    >
      <div className="min-w-0 flex-1 basis-[260px]">
        <strong className="text-[15px] font-bold text-ink flex items-center gap-2">
          <span className={`inline-flex ${s.iconColor}`}>
            <DsIcon name={s.icon} size={16} />
          </span>
          <span>{title}</span>
        </strong>
        {children && (
          <p className="mt-1 mb-0 text-[14px] leading-[1.5] text-black">{children}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function DsToast({
  message,
  actionLabel,
  onAction,
  testId,
}: {
  message: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex items-center gap-3 bg-ink text-white rounded-[10px] px-4 py-3 text-[15px] font-semibold shadow-lg"
    >
      <span className="flex-1">{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="text-white font-bold underline hover:no-underline bg-transparent border-0 cursor-pointer min-h-[44px] px-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function DsDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
  inline = false,
  open = true,
  testId,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm?: () => void;
  onCancel?: () => void;
  inline?: boolean;
  open?: boolean;
  testId?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (inline || !open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    if (node) {
      const focusable = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable[0]?.focus();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const els = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openerRef.current?.focus?.();
    };
  }, [inline, open, onCancel]);

  if (!open) return null;

  const box = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      data-testid={testId}
      className="bg-white border border-line rounded-[16px] p-6 shadow-xl max-w-md w-full"
    >
      <h3 id={titleId} className="m-0 mb-1.5 text-[20px] font-extrabold text-ink">
        {title}
      </h3>
      <p className="m-0 mb-5 text-[15px] text-muted">{description}</p>
      <div className="flex justify-end gap-2.5 flex-wrap">
        <DsButton variant="secondary" icon="check" onClick={onCancel}>
          {cancelLabel}
        </DsButton>
        <DsButton
          variant={confirmVariant}
          icon={confirmVariant === 'danger' ? 'x' : 'check'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </DsButton>
      </div>
    </div>
  );

  if (inline) return box;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40">
      {box}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 13. Empty state & 14. Skeleton (shown after 300 ms)
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsEmptyState({
  title,
  description,
  icon = 'search',
  actionLabel,
  actionHref,
  actionIcon = 'search',
  onAction,
  testId,
}: {
  title: string;
  description: ReactNode;
  icon?: DsIconName;
  actionLabel?: string;
  actionHref?: string;
  actionIcon?: DsIconName;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <div className="text-center py-3 px-2" data-testid={testId}>
      <div
        aria-hidden="true"
        className="w-[52px] h-[52px] rounded-[14px] bg-tint text-coral-text flex items-center justify-center mx-auto mb-3"
      >
        <DsIcon name={icon} size={22} />
      </div>
      <h3 className="m-0 mb-1.5 text-[18px] font-extrabold text-ink">{title}</h3>
      <p className="m-0 mb-4 text-[15px] text-muted max-w-md mx-auto">{description}</p>
      {actionLabel &&
        (actionHref ? (
          <DsLinkButton href={actionHref} variant="primary" icon={actionIcon}>
            {actionLabel}
          </DsLinkButton>
        ) : (
          <DsButton variant="primary" icon={actionIcon} onClick={onAction}>
            {actionLabel}
          </DsButton>
        ))}
    </div>
  );
}

export function DsSkeleton({
  immediate = false,
  delayMs = 300,
  testId,
}: {
  immediate?: boolean;
  delayMs?: number;
  testId?: string;
}) {
  const [visible, setVisible] = useState(immediate);
  useEffect(() => {
    if (immediate) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [immediate, delayMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid={testId}
      className="flex flex-col gap-2.5 animate-pulse motion-reduce:animate-none"
    >
      <div aria-hidden="true" className="w-full h-[120px] rounded-[12px] bg-fill" />
      <div aria-hidden="true" className="w-[70%] h-[14px] rounded-[6px] bg-fill" />
      <div aria-hidden="true" className="w-[45%] h-[14px] rounded-[6px] bg-fill" />
      <div aria-hidden="true" className="w-[90%] h-[14px] rounded-[6px] bg-fill" />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 15. Stepper & 16. Timeline
 * ─────────────────────────────────────────────────────────────────────────── */
export type DsStepItem = {
  label: string;
  state: 'done' | 'current' | 'upcoming';
};

export function DsStepper({
  steps,
  ariaLabel = 'Steps',
  testId,
}: {
  steps: DsStepItem[];
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <ol
      aria-label={ariaLabel}
      data-testid={testId}
      className="list-none m-0 p-0 flex items-center gap-2 flex-wrap"
    >
      {steps.map((step, idx) => {
        const isDone = step.state === 'done';
        const isCurrent = step.state === 'current';
        return (
          <li key={step.label} className="contents">
            <div
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center gap-2 text-[14px] ${
                isCurrent
                  ? 'font-bold text-ink'
                  : isDone
                    ? 'font-semibold text-ink'
                    : 'font-medium text-muted'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 box-border ${
                  isDone
                    ? 'bg-ok text-white'
                    : isCurrent
                      ? 'bg-coral text-white'
                      : 'border-2 border-line-strong text-muted'
                }`}
              >
                {idx + 1}
              </span>
              <span>{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div
                aria-hidden="true"
                className="flex-1 min-w-[16px] h-[2px] bg-line"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type DsTimelineEvent = {
  title: string;
  detail?: ReactNode;
  timestamp?: string;
  state?: 'done' | 'current' | 'upcoming';
};

export function DsTimeline({
  events,
  testId,
}: {
  events: DsTimelineEvent[];
  testId?: string;
}) {
  return (
    <ol className="list-none m-0 p-0 relative" data-testid={testId}>
      {events.map((ev, idx) => {
        const state = ev.state ?? 'done';
        const dotCls =
          state === 'done'
            ? 'bg-ok border-ok'
            : state === 'current'
              ? 'bg-coral border-coral'
              : 'bg-white border-line-strong';
        return (
          <li key={idx} className="relative pl-6 pb-4 last:pb-0">
            {idx < events.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[6px] top-3 bottom-0 w-[2px] bg-line"
              />
            )}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 box-border ${dotCls}`}
            />
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <strong className="text-[14px] font-semibold text-ink">{ev.title}</strong>
              {ev.timestamp && (
                <span className="text-[12px] text-muted">{ev.timestamp}</span>
              )}
            </div>
            {ev.detail && (
              <p className="mt-0.5 mb-0 text-[13px] text-muted">{ev.detail}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 17. Price breakdown (Product, Processing, Shipping, Duties and tax, Landed —
 *     ALWAYS in that exact order)
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsPriceBreakdown({
  product,
  processing,
  shipping,
  duties,
  dutiesMode = 'DDP',
  landed,
  caption,
  testId,
}: {
  product: ReactNode;
  processing: ReactNode;
  shipping: ReactNode;
  duties: ReactNode;
  dutiesMode?: 'DDP' | 'DAP';
  landed: ReactNode;
  caption?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId ?? 'ds-price-breakdown'}>
      <div className="ds-row">
        <span className="ds-mut">Product</span>
        <span>{product}</span>
      </div>
      <div className="ds-row">
        <span className="ds-mut">Processing</span>
        <span>{processing}</span>
      </div>
      <div className="ds-row">
        <span className="ds-mut">Shipping</span>
        <span>{shipping}</span>
      </div>
      <div className="ds-row">
        <span className="ds-mut">Duties and tax ({dutiesMode})</span>
        <span>{duties}</span>
      </div>
      <div className="ds-row font-bold border-t border-divider pt-2.5 mt-1">
        <span className="ds-mut">Landed cost</span>
        <span>{landed}</span>
      </div>
      {caption && (
        <p className="mt-2 mb-0 text-[12px] text-muted">{caption}</p>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * 18. Page header with icon tile & 19. Top bar (search, notifications, help, account)
 * ─────────────────────────────────────────────────────────────────────────── */
export function DsPageHeader({
  title,
  subtitle,
  icon = 'grid',
  actions,
  testId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: DsIconName;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <header
      data-testid={testId ?? 'ds-page-header'}
      className="flex justify-between items-start gap-4 flex-wrap"
    >
      <div className="min-w-0">
        <h1 className="m-0 text-[34px] leading-[1.1] font-extrabold flex items-center gap-3.5 flex-wrap text-ink">
          <span
            data-page-icon=""
            aria-hidden="true"
            className="w-[52px] h-[52px] rounded-[14px] bg-tint text-coral-text inline-flex items-center justify-center shrink-0"
          >
            <DsIcon name={icon} size={24} strokeWidth={2} />
          </span>
          <span>{title}</span>
        </h1>
        {subtitle && (
          <p className="mt-2 mb-0 text-[16px] leading-[1.5] text-muted">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>}
    </header>
  );
}

export function DsTopBar({
  searchPlaceholder = 'Search orders, products, DS model no.',
  searchAction = '/account/dropship/catalogue',
  unreadCount = 0,
  notificationsHref = '/account/notifications',
  helpHref = '/account/dropship/support',
  accountHref = '/account/dropship/settings',
  backToAccountHref = '/account',
  backToAccountLabel = 'Back to my Octopus account',
  userName = 'Merchant',
  initials = 'ME',
  extraRight,
}: {
  searchPlaceholder?: string;
  searchAction?: string;
  unreadCount?: number;
  notificationsHref?: string;
  helpHref?: string;
  accountHref?: string;
  backToAccountHref?: string;
  backToAccountLabel?: string;
  userName?: string;
  initials?: string;
  extraRight?: ReactNode;
}) {
  // Design handoff §3 top bar: search, then 46 px icon buttons (notifications, help) and the user chip on the right.
  // The shells put this inside their white `.app-topbar` header; the bar itself only lays the controls out.
  return (
    <div
      data-testid="ds-top-bar"
      className="flex flex-1 min-w-0 items-center gap-3 flex-wrap"
    >
      {searchAction && (
        <form
          action={searchAction}
          role="search"
          className="flex-1 basis-[260px] max-w-[560px]"
        >
          <label className="relative flex items-center text-muted">
            <DsIcon name="search" size={18} className="absolute left-3.5 pointer-events-none" />
            <input
              name="q"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              className="w-full min-w-0 min-h-[46px] rounded-[10px] border border-line-strong bg-white pl-11 pr-3.5 text-[15px] text-black placeholder:text-muted box-border focus:border-coral-text"
            />
          </label>
        </form>
      )}
      <div className="ml-auto flex items-center gap-2.5">
        {extraRight}
        <Link
          href={notificationsHref}
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'
          }
          data-testid="header-bell"
          className="ds-topic"
        >
          <DsIcon name="bell" size={20} />
          {unreadCount > 0 && (
            <span
              data-testid="bell-count"
              className="absolute top-[5px] right-[5px] min-w-[17px] h-[17px] rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center px-[4px] box-border"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link
          href={helpHref}
          aria-label="Help"
          className="ds-topic"
        >
          <DsIcon name="help" size={20} />
        </Link>
        <details className="relative" data-testid="ds-account-menu">
          <summary className="app-chip list-none [&::-webkit-details-marker]:hidden cursor-pointer text-ink box-border">
            <span aria-hidden="true" className="app-avatar">
              {initials}
            </span>
            <span className="text-[14px] font-bold">{userName}</span>
          </summary>
          <div className="absolute right-0 mt-2 w-[240px] bg-white border border-line rounded-[12px] shadow-lg p-2 z-50">
            <Link
              href={accountHref}
              className="flex items-center min-h-11 px-3 rounded-[10px] text-[14px] font-semibold text-ink hover:text-ink hover:bg-sand no-underline"
            >
              Settings
            </Link>
            {backToAccountHref && (
              <Link
                href={backToAccountHref}
                data-testid="top-bar-back-to-account"
                className="flex items-center min-h-11 px-3 rounded-[10px] text-[14px] font-semibold text-ink hover:text-ink hover:bg-sand no-underline"
              >
                {backToAccountLabel}
              </Link>
            )}
            <form action="/auth/signout" method="post" className="border-t border-divider mt-1 pt-1">
              <button
                type="submit"
                className="w-full text-left min-h-11 px-3 rounded-[10px] text-[14px] font-semibold text-bad hover:bg-bad-bg bg-transparent border-0 cursor-pointer"
              >
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
