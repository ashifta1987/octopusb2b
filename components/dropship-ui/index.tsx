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
          className={`inline-flex items-center gap-1.5 min-h-[44px] px-1 text-[14px] font-semibold text-[#2A6FD1] hover:text-[#1F5BB0] hover:underline disabled:text-[#5B6478] disabled:no-underline disabled:cursor-not-allowed cursor-pointer bg-transparent border-0 ${className}`.trim()}
          {...rest}
        >
          {icon && <DsIcon name={icon} size={16} />}
          {children}
        </button>
        {isDisabled && disabledReason && (
          <span id={reasonId} className="text-[12px] text-[#5B6478]" data-testid="disabled-reason">
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
        <p id={reasonId} className="m-0 text-[12px] text-[#5B6478]" data-testid="disabled-reason">
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
        className={`inline-flex items-center gap-1.5 min-h-[44px] text-[14px] font-semibold text-[#2A6FD1] hover:text-[#1F5BB0] hover:underline ${className}`.trim()}
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
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#B42318]">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#5B6478]">
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
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#B42318]">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#5B6478]">
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
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#B42318]">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 mb-0 text-[12px] text-[#5B6478]">
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
      className={`flex items-center gap-2.5 min-h-[44px] text-[14px] text-[#1A174A] cursor-pointer ${className}`.trim()}
    >
      <input
        type="checkbox"
        className="w-4 h-4 accent-[#2A6FD1] rounded shrink-0"
        {...rest}
      />
      <span>
        {label}
        {hint && <span className="block text-[12px] text-[#5B6478]">{hint}</span>}
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
      className={`flex items-start gap-3 min-h-[44px] p-3.5 rounded-[12px] border cursor-pointer transition-colors ${
        checked
          ? 'border-[#2A6FD1] bg-[#F2F7FE]'
          : 'border-[#E3E7EF] bg-white hover:border-[#C9D0DD]'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(value)}
        className="mt-1 w-4 h-4 accent-[#2A6FD1] shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2 flex-wrap">
          <strong className="text-[14px] font-semibold text-[#1A174A]">{title}</strong>
          {badge}
        </span>
        {description && (
          <span className="block mt-1 text-[13px] text-[#5B6478]">{description}</span>
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
        <span id={id} className="text-[14px] font-semibold text-[#1A174A]">
          {label}
        </span>
        {hint && <p className="m-0 text-[12px] text-[#5B6478]">{hint}</p>}
        {disabled && disabledReason && (
          <p className="m-0 text-[12px] text-[#5B6478]" data-testid="disabled-reason">
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
        className="inline-flex items-center min-h-[44px] min-w-[48px] px-0.5 bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`inline-flex items-center w-11 h-6 rounded-full p-0.5 transition-colors ${
            checked ? 'bg-[#0B7A75]' : 'bg-[#C9D0DD]'
          }`}
        >
          <span
            className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
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
 * 8. Card with icon heading & 9. Table card (scroll box, header #F7F9FC, row hover)
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
            noPadding ? 'px-5 py-4 border-b border-[#E3E7EF]' : 'mb-3'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-[#1A174A]">
                {icon && <DsIcon name={icon} size={18} strokeWidth={2} className="text-[#2A6FD1]" />}
                <span>{title}</span>
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 mb-0 text-[13px] text-[#5B6478]">{subtitle}</p>
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
        <div className="px-5 py-3 text-[12px] text-[#5B6478] border-t border-[#EEF0F4]">
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

const NOTICE_STYLES: Record<DsNoticeTone, { bg: string; border: string; icon: DsIconName; iconColor: string }> = {
  info: { bg: '#F2F7FE', border: '#C7DAF5', icon: 'info', iconColor: '#1F5BB0' },
  ok: { bg: '#F1FAF8', border: '#B9E2DC', icon: 'check', iconColor: '#0B6A65' },
  warn: { bg: '#FFFBF2', border: '#F3D9A4', icon: 'alert', iconColor: '#8A5300' },
  bad: { bg: '#FEF4F4', border: '#F2C4C2', icon: 'stop', iconColor: '#A8201A' },
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
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
      className="flex items-center justify-between gap-3.5 flex-wrap rounded-[12px] px-[18px] py-[14px]"
    >
      <div className="min-w-0 flex-1 basis-[260px]">
        <strong className="text-[14px] font-bold text-[#1A174A] flex items-center gap-2">
          <span style={{ color: s.iconColor }} className="inline-flex">
            <DsIcon name={s.icon} size={16} />
          </span>
          <span>{title}</span>
        </strong>
        {children && (
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-[#1A174A]">{children}</p>
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
      className="flex items-center gap-3 bg-[#1A174A] text-white rounded-[10px] px-4 py-3 text-[14px] shadow-[0_6px_20px_rgba(26,23,74,0.18)]"
    >
      <span className="flex-1">{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="text-white font-semibold underline hover:opacity-90 bg-transparent border-0 cursor-pointer min-h-[32px] px-2"
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
      className="bg-white border border-[#E3E7EF] rounded-[12px] p-[18px] shadow-[0_12px_32px_rgba(26,23,74,0.16)] max-w-md w-full"
    >
      <h3 id={titleId} className="m-0 mb-1.5 text-[17px] font-bold text-[#1A174A]">
        {title}
      </h3>
      <p className="m-0 mb-3.5 text-[14px] text-[#5B6478]">{description}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A174A]/40">
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
        className="w-14 h-14 rounded-full bg-[#E6EFFB] text-[#2A6FD1] flex items-center justify-center mx-auto mb-3"
      >
        <DsIcon name={icon} size={22} />
      </div>
      <h3 className="m-0 mb-1.5 text-[16px] font-bold text-[#1A174A]">{title}</h3>
      <p className="m-0 mb-3.5 text-[14px] text-[#5B6478] max-w-md mx-auto">{description}</p>
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
      <div aria-hidden="true" className="w-full h-[120px] rounded-[6px] bg-[#E6EAF1]" />
      <div aria-hidden="true" className="w-[70%] h-[14px] rounded-[6px] bg-[#E6EAF1]" />
      <div aria-hidden="true" className="w-[45%] h-[14px] rounded-[6px] bg-[#E6EAF1]" />
      <div aria-hidden="true" className="w-[90%] h-[14px] rounded-[6px] bg-[#E6EAF1]" />
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
                  ? 'font-semibold text-[#1A174A]'
                  : isDone
                    ? 'font-medium text-[#1A174A]'
                    : 'font-medium text-[#5B6478]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 box-border ${
                  isDone
                    ? 'bg-[#0B7A75] text-white'
                    : isCurrent
                      ? 'bg-[#2A6FD1] text-white'
                      : 'border-2 border-[#C9D0DD] text-[#5B6478]'
                }`}
              >
                {idx + 1}
              </span>
              <span>{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div
                aria-hidden="true"
                className="flex-1 min-w-[16px] h-[2px] bg-[#E3E7EF]"
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
            ? 'bg-[#0B7A75] border-[#0B7A75]'
            : state === 'current'
              ? 'bg-[#2A6FD1] border-[#2A6FD1]'
              : 'bg-white border-[#C9D0DD]';
        return (
          <li key={idx} className="relative pl-6 pb-4 last:pb-0">
            {idx < events.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[6px] top-3 bottom-0 w-[2px] bg-[#E3E7EF]"
              />
            )}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 box-border ${dotCls}`}
            />
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <strong className="text-[14px] font-semibold text-[#1A174A]">{ev.title}</strong>
              {ev.timestamp && (
                <span className="text-[12px] text-[#5B6478]">{ev.timestamp}</span>
              )}
            </div>
            {ev.detail && (
              <p className="mt-0.5 mb-0 text-[13px] text-[#5B6478]">{ev.detail}</p>
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
      <div className="ds-row font-bold border-t border-[#EEF0F4] pt-2.5 mt-1">
        <span className="ds-mut">Landed cost</span>
        <span>{landed}</span>
      </div>
      {caption && (
        <p className="mt-2 mb-0 text-[12px] text-[#5B6478]">{caption}</p>
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
        <h1 className="m-0 text-[26px] font-bold flex items-center gap-3 flex-wrap text-[#1A174A]">
          <span
            data-page-icon=""
            aria-hidden="true"
            className="w-10 h-10 rounded-[10px] bg-[#E6EFFB] text-[#2A6FD1] inline-flex items-center justify-center shrink-0"
          >
            <DsIcon name={icon} size={20} strokeWidth={2} />
          </span>
          <span>{title}</span>
        </h1>
        {subtitle && (
          <p className="mt-1.5 mb-0 text-[14px] leading-[1.5] text-[#5B6478]">{subtitle}</p>
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
  return (
    <div
      data-testid="ds-top-bar"
      className="flex items-center gap-3 flex-wrap pb-4 border-b border-[#E3E7EF]"
    >
      {searchAction && (
        <form
          action={searchAction}
          role="search"
          className="flex-1 basis-[260px] max-w-[480px]"
        >
          <label className="flex items-center gap-2 min-h-[44px] bg-white border border-[#C9D0DD] rounded-[8px] px-3 text-[#5B6478] box-border focus-within:border-[#2A6FD1] focus-within:shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_#2A6FD1]">
            <DsIcon name="search" size={16} />
            <input
              name="q"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              className="border-0 outline-none flex-1 min-w-0 text-[14px] text-[#1A174A] bg-transparent placeholder:text-[#5B6478]"
            />
          </label>
        </form>
      )}
      <div className="ml-auto flex items-center gap-2">
        {extraRight}
        <Link
          href={notificationsHref}
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'
          }
          data-testid="header-bell"
          className="ds-topic hover:border-[#1A174A]"
        >
          <DsIcon name="bell" size={18} />
          {unreadCount > 0 && (
            <span
              data-testid="bell-count"
              className="absolute top-[5px] right-[5px] min-w-[16px] h-[16px] rounded-[8px] bg-[#B42318] text-white text-[10px] font-bold flex items-center justify-center px-[3px] box-border"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <Link
          href={helpHref}
          aria-label="Help"
          className="ds-topic hover:border-[#1A174A]"
        >
          <DsIcon name="help" size={18} />
        </Link>
        <details className="relative" data-testid="ds-account-menu">
          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 min-h-[44px] pl-1.5 pr-3 rounded-[8px] border border-[#E3E7EF] bg-white text-[#1A174A] hover:border-[#1A174A] text-[13px] font-semibold box-border">
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-full bg-[#1A174A] text-white inline-flex items-center justify-center text-[12px] font-semibold"
            >
              {initials}
            </span>
            <span>{userName}</span>
          </summary>
          <div className="absolute right-0 mt-2 w-[230px] bg-white border border-[#E3E7EF] rounded-[10px] shadow-[0_12px_32px_rgba(26,23,74,0.16)] p-2 z-50">
            <Link
              href={accountHref}
              className="block px-3 py-2.5 rounded-[8px] text-[13px] font-semibold text-[#1A174A] hover:text-[#1A174A] hover:bg-[#F4F6F9] no-underline"
            >
              Settings
            </Link>
            {backToAccountHref && (
              <Link
                href={backToAccountHref}
                data-testid="top-bar-back-to-account"
                className="block px-3 py-2.5 rounded-[8px] text-[13px] font-semibold text-[#1A174A] hover:text-[#1A174A] hover:bg-[#F4F6F9] no-underline"
              >
                {backToAccountLabel}
              </Link>
            )}
            <form action="/auth/signout" method="post" className="border-t border-[#EEF0F4] mt-1 pt-1">
              <button
                type="submit"
                className="w-full text-left px-3 py-2.5 rounded-[8px] text-[13px] font-semibold text-[#B42318] hover:bg-[#FEF4F4] bg-transparent border-0 cursor-pointer"
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
