'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../cx';

/** The texts Google's branding guidelines allow on the button. */
const GOOGLE_BUTTON_TEXT = { signin: 'Sign in with Google', signup: 'Sign up with Google', continue: 'Continue with Google' } as const;
export type GoogleButtonText = keyof typeof GOOGLE_BUTTON_TEXT;

export type GoogleSignInButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'disabled'> & {
  /** One of Google's approved texts (default "Sign in with Google"). */
  text?: GoogleButtonText;
  /** Waiting for the redirect to Google: spinner-free (Google forbids changing the mark), label "Opening Google…" for screen readers. */
  loading?: boolean;
  disabled?: boolean;
  /** Disabled buttons say why (2.6): shown under the button and linked with aria-describedby. */
  disabledReason?: string;
  /** id for the reason (pass a useId() value when two buttons can be on one page). */
  reasonId?: string;
  fullWidth?: boolean;
};

/**
 * Official "Sign in with Google" button (Google Identity branding guidelines, light theme):
 * white fill, 1 px #747775 border, #1F1F1F text, the standard four-colour "G" (inline SVG, never recoloured or redrawn),
 * 20 px mark with 12 px gap, pill shape, approved text only. Height = the ODS control height (44 / 32 px; Google's
 * minimum is 40 px in comfortable). Brand colours are Google's own, so this file uses literal hex — the one exception to
 * the ODS token rule. Disabled: Google's disabled style (faded fill and text), aria-disabled, reason shown under it.
 * Client component (it blocks clicks while disabled/loading); the parent passes onClick. Phones: full width when `fullWidth`.
 */
export function GoogleSignInButton({ text = 'signin', loading, disabled, disabledReason, reasonId = 'google-signin-reason', fullWidth, className, onClick, type = 'button', ...rest }: GoogleSignInButtonProps) {
  const blocked = disabled || loading;
  const showReason = disabled && disabledReason;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', fullWidth && 'w-full')}>
      <button
        type={type}
        {...rest}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        aria-describedby={cx(rest['aria-describedby'], showReason && reasonId) || undefined}
        onClick={(e) => {
          if (blocked) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        className={cx(
          'inline-flex min-h-[max(40px,var(--ods-control-h))] items-center justify-center gap-3 rounded-full border px-5 font-medium text-ods-body',
          'transition-colors duration-(--ods-motion-fast) ease-ods',
          disabled
            ? 'cursor-not-allowed border-[#1F1F1F]/12 bg-white/60 text-[#1F1F1F]/38'
            : 'border-[#747775] bg-white text-[#1F1F1F] hover:bg-[#F2F2F2] active:bg-[#E8E8E8]',
          loading && 'cursor-progress',
          fullWidth && 'w-full',
          className,
        )}
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={cx('shrink-0', disabled && 'opacity-40')}>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{GOOGLE_BUTTON_TEXT[text]}</span>
        {loading ? <span className="sr-only"> — opening Google…</span> : null}
      </button>
      {showReason ? (
        <p id={reasonId} className="text-ods-small text-ods-slate">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
