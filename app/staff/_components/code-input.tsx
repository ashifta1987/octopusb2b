'use client';
import { useRef } from 'react';

/** Six single-digit boxes (StaffLogin-2-verify.png) with auto-advance, backspace and paste support. */
export function CodeInput({ value, onChange, disabled, idPrefix = 'otp', autoFocus = true }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; idPrefix?: string; autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  function setAt(i: number, d: string) {
    const arr = digits.slice();
    arr[i] = d;
    onChange(arr.join('').replace(/\s/g, '').slice(0, 6));
  }

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="sr-only">6-digit code</legend>
      <div className="flex gap-2 sm:gap-2" onPaste={(e) => {
        const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); }
      }}>
        {digits.map((d, i) => (
          <input
            key={i}
            id={`${idPrefix}-${i}`}
            ref={(el) => { refs.current[i] = el; }}
            aria-label={`Digit ${i + 1} of 6`}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            value={d}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              if (v.length > 1) { onChange(v.slice(0, 6)); refs.current[Math.min(v.length, 5)]?.focus(); return; }
              setAt(i, v);
              if (v && i < 5) refs.current[i + 1]?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
              if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
            }}
            className="w-11 h-[54px] sm:w-[52px] sm:h-[60px] border border-[#C5CCD6] rounded-[10px] text-center font-mono font-semibold text-2xl bg-white text-navy disabled:opacity-60"
          />
        ))}
      </div>
    </fieldset>
  );
}
