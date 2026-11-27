import { cx } from './cx';

/**
 * Pure class helpers (no 'use client'), so server components can style links as buttons:
 *   <Link href="/shop" className={buttonClass('secondary')}>…</Link>
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'accent' | 'on-navy';
export type ButtonSize = 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ods-blue text-white border-ods-blue hover:bg-ods-blue-hover hover:border-ods-blue-hover',
  secondary: 'bg-ods-surface text-ods-navy border-ods-line-strong hover:border-ods-navy hover:bg-ods-canvas',
  ghost: 'bg-transparent text-ods-navy border-transparent hover:bg-ods-blue-tint',
  danger: 'bg-ods-danger text-white border-ods-danger hover:brightness-95',
  link: 'bg-transparent text-ods-blue border-transparent underline underline-offset-4 decoration-1 hover:decoration-2',
  // teal CTA on navy (hero, Part 2.2) — navy text on teal is 9.6:1
  accent: 'bg-ods-teal text-ods-navy border-ods-teal hover:brightness-95',
  'on-navy': 'bg-transparent text-white border-white/40 hover:bg-white/10',
};
// loading buttons use aria-busy (not aria-disabled), so they keep their colour while blocked
const DISABLED = 'aria-busy:cursor-progress aria-disabled:bg-ods-canvas aria-disabled:text-ods-slate aria-disabled:border-ods-line aria-disabled:cursor-not-allowed aria-disabled:hover:brightness-100 aria-disabled:no-underline';

export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', fullWidth = false) =>
  cx(
    'inline-flex items-center justify-center gap-2 border font-semibold whitespace-nowrap rounded-ods-control select-none',
    'transition-colors duration-(--ods-motion-fast) ease-ods',
    size === 'md' ? 'h-ods-control text-ods-body' : 'h-[calc(var(--ods-control-h)-8px)] text-ods-label',
    // padding is decided here, not in VARIANT: without tailwind-merge, `px-4` + `px-0` both apply and px-4 won (link had padding)
    variant === 'link' ? 'px-0' : size === 'md' ? 'px-4' : 'px-3',
    VARIANT[variant],
    DISABLED,
    fullWidth && 'w-full',
  );

