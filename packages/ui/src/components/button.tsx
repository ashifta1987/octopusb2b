'use client';

import Link from 'next/link';
import { forwardRef, useId, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { buttonClass, type ButtonSize, type ButtonVariant } from '../styles';
import { Tooltip } from './tooltip';

export type { ButtonSize, ButtonVariant };

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks (keeps its colour; aria-disabled is only for `disabled`). */
  loading?: boolean;
  /** Read out instead of the label while loading, e.g. "Saving…". */
  loadingText?: string;
  disabled?: boolean;
  /** Disabled buttons always say why (2.6): shown next to the button and linked with aria-describedby. */
  disabledReason?: string;
  iconStart?: LucideIcon;
  iconEnd?: LucideIcon;
  fullWidth?: boolean;
  /** Renders a link styled as a button. */
  href?: string;
  target?: string;
  children?: ReactNode;
};

/**
 * Button: primary, secondary, ghost, danger, link, accent (teal on navy), on-navy. 44 / 32 px by density.
 * Disabled uses aria-disabled (stays focusable so screen readers hear the reason) and blocks the click.
 * Phones: same; pass `fullWidth` for sticky footers.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, loadingText, disabled, disabledReason, iconStart, iconEnd, fullWidth, href, target, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  const reasonId = useId();
  const blocked = disabled || loading;
  const describedBy = cx(rest['aria-describedby'], disabled && disabledReason && reasonId) || undefined;
  const inner = (
    <>
      {loading ? <Icon icon={LoaderCircle} className="animate-spin" /> : iconStart ? <Icon icon={iconStart} /> : null}
      <span>{loading && loadingText ? loadingText : children}</span>
      {!loading && iconEnd ? <Icon icon={iconEnd} /> : null}
    </>
  );
  const el =
    href && !blocked ? (
      <Link
        {...(rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
        onClick={onClick as unknown as AnchorHTMLAttributes<HTMLAnchorElement>['onClick']}
        href={href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        className={cx(buttonClass(variant, size, fullWidth), className)}
        aria-describedby={describedBy}
      >
        {inner}
      </Link>
    ) : (
      <button
        ref={ref}
        type={type}
        {...rest}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        aria-describedby={describedBy}
        className={cx(buttonClass(variant, size, fullWidth), className)}
        onClick={(e) => {
          if (blocked) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
      >
        {inner}
      </button>
    );
  if (!(disabled && disabledReason)) return el;
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-3 gap-y-1', fullWidth && 'w-full')}>
      {el}
      <span id={reasonId} className="text-ods-small text-ods-slate">
        {disabledReason}
      </span>
    </span>
  );
});

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  /** Required: icon-only buttons need a name (aria-label) and a tooltip (2.4). */
  label: string;
  variant?: 'ghost' | 'secondary' | 'on-navy' | 'primary';
  /** Count badge (e.g. notifications); read out with the label. */
  count?: number;
  tooltipSide?: 'top' | 'bottom' | 'end' | 'start';
  pressed?: boolean;
};

/** Square icon button (44 / 32 px), with aria-label + tooltip, optional red count. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', count, tooltipSide = 'bottom', pressed, className, type = 'button', ...rest },
  ref,
) {
  const name = count ? `${label} (${count > 99 ? '99+' : count})` : label;
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={name}
        aria-pressed={pressed}
        className={cx(
          'relative inline-grid size-ods-control shrink-0 place-items-center rounded-ods-control border transition-colors duration-(--ods-motion-fast)',
          variant === 'ghost' && 'border-transparent text-ods-navy hover:bg-ods-blue-tint',
          variant === 'secondary' && 'border-ods-line-strong bg-ods-surface text-ods-navy hover:border-ods-navy',
          variant === 'on-navy' && 'border-transparent text-white hover:bg-white/10',
          variant === 'primary' && 'border-ods-blue bg-ods-blue text-white hover:bg-ods-blue-hover',
          pressed && 'bg-ods-blue-tint',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        <Icon icon={icon} />
        {/* the number is drawn with CSS content (no text node): the name already says it, and visible text that isn't
            part of the name fails axe label-content-name-mismatch */}
        {count ? (
          <span
            aria-hidden="true"
            data-count={count > 99 ? '99+' : String(count)}
            className="absolute -top-1 -end-1 inline-flex min-w-5 items-center justify-center rounded-ods-pill bg-ods-danger px-1.5 text-[11px] leading-5 font-semibold text-white tabular-nums before:content-[attr(data-count)]"
          />
        ) : null}
      </button>
    </Tooltip>
  );
});

/** Red count (sidebar items, bell). `decorative` when the parent already includes the number in its name. */
export function CountBadge({ count, label, className, decorative, tone = 'danger' }: { count: number; label?: string; className?: string; decorative?: boolean; tone?: 'danger' | 'neutral' | 'blue' }) {
  if (!count) return null;
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-ods-pill px-1.5 text-[11px] leading-5 font-semibold tabular-nums',
        tone === 'danger' && 'bg-ods-danger text-white',
        tone === 'neutral' && 'bg-ods-line text-ods-navy',
        tone === 'blue' && 'bg-ods-blue text-white',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
      {!decorative && label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cx('inline-flex items-center gap-2 text-ods-slate', className)}>
      <Icon icon={LoaderCircle} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Keyboard key hint, e.g. <Kbd>Ctrl</Kbd><Kbd>K</Kbd>. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-current/30 px-1 font-ods text-[11px] leading-none font-semibold', className)}>
      {children}
    </kbd>
  );
}
