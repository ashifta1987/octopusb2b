'use client';
import { createContext, forwardRef, useContext, useEffect, useReducer, useRef, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { initialReveal, revealLabel, revealReducer } from '@/lib/password-reveal';

/** Seconds before a revealed password hides again (site_settings auth.password_reveal_timeout_s; 0 = never). */
export const PasswordRevealTimeout = createContext(15);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { revealTimeoutS?: number };

/**
 * Password field with an accessible eye / eye-off toggle (ADDON-25).
 * Hidden by default; the toggle is a real <button type="button"> (Enter in the field still submits the form,
 * Space/Enter on the button toggles), aria-pressed + aria-label follow the state, auto-hides after the timeout,
 * re-hides on form submit, and never persists or logs anything.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, revealTimeoutS, onChange, onKeyDown, onFocus, ...rest }, ref,
) {
  const ctxTimeout = useContext(PasswordRevealTimeout);
  const timeoutS = revealTimeoutS ?? ctxTimeout;
  const [s, dispatch] = useReducer(revealReducer, initialReveal);
  const wrap = useRef<HTMLDivElement>(null);

  // auto-hide timer (checks once a second while visible)
  useEffect(() => {
    if (!s.visible || timeoutS <= 0) return;
    const t = window.setInterval(() => dispatch({ type: 'tick', now: Date.now(), timeoutS }), 1000);
    return () => window.clearInterval(t);
  }, [s.visible, timeoutS]);

  // hide again whenever the surrounding form is submitted (e.g. after a wrong password)
  useEffect(() => {
    const form = wrap.current?.closest('form');
    if (!form) return;
    const hide = () => dispatch({ type: 'hide' });
    form.addEventListener('submit', hide);
    return () => form.removeEventListener('submit', hide);
  }, []);

  const label = revealLabel(s.visible);
  return (
    <div ref={wrap} className="relative">
      <input
        ref={ref}
        {...rest}
        type={s.visible ? 'text' : 'password'}
        className={cn(className, 'pr-12')}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => { dispatch({ type: 'activity', now: Date.now() }); onChange?.(e); }}
        onKeyDown={(e) => { dispatch({ type: 'activity', now: Date.now() }); onKeyDown?.(e); }}
        onFocus={(e) => { dispatch({ type: 'activity', now: Date.now() }); onFocus?.(e); }}
      />
      <button
        type="button"
        onClick={() => dispatch({ type: 'toggle', now: Date.now() })}
        aria-label={label}
        aria-pressed={s.visible}
        aria-controls={rest.id}
        title={label}
        disabled={rest.disabled}
        className="absolute inset-y-0 right-0 my-auto mr-1 flex h-10 w-10 items-center justify-center rounded-[8px] text-muted hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue motion-safe:transition-colors disabled:opacity-50"
      >
        {s.visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
});

/** Provides the reveal timeout from settings to every PasswordInput below it. */
export function PasswordRevealProvider({ timeoutS, children }: { timeoutS: number; children: React.ReactNode }) {
  return <PasswordRevealTimeout.Provider value={timeoutS}>{children}</PasswordRevealTimeout.Provider>;
}
