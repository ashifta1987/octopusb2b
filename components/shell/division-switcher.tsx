'use client';
import { useRef, useTransition } from 'react';
import type { Division } from '@/lib/divisions/shared';

/**
 * Divisions step 4 — header switcher: "All divisions" or one division. Submits on change (server action sets the
 * cookie); without JavaScript the "Show" button submits the form.
 * Design handoff 26 Nov 2026: `variant="context"` renders inside the sidebar context box — the same "Division" label,
 * shown as the 12 px muted line, and the select showing the current division in 15 px bold navy.
 */
export function DivisionSwitcher({ options, current, action, variant = 'header' }: { options: Division[]; current: string | null; action: (fd: FormData) => Promise<void>; variant?: 'header' | 'context' }) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  if (options.length === 0) return null;
  const single = options.length === 1;
  const ctx = variant === 'context';
  return (
    <form ref={form} action={action} className={ctx ? 'flex flex-col gap-0.5 min-w-0' : 'flex items-center gap-2'} data-testid="division-switcher">
      <label htmlFor="division-switch" className={ctx ? 'block text-[12px] text-muted' : 'sr-only'}>Division</label>
      <div className={ctx ? 'flex items-center gap-2 min-w-0' : 'contents'}>
        <select key={current ?? 'all'} id="division-switch" name="division" defaultValue={current ?? 'all'} disabled={pending}
          onChange={() => start(() => form.current?.requestSubmit())}
          className={ctx
            ? 'w-full min-w-0 min-h-11 -ml-1 rounded-[10px] border border-transparent bg-transparent text-ink text-[15px] font-bold leading-tight px-1 pr-6 hover:border-line-strong hover:bg-white disabled:text-muted'
            : 'min-h-11 rounded-[10px] border border-line-strong bg-white text-ink text-sm font-semibold px-3 pr-8 hover:border-ink'}>
          {!single && <option value="all">All divisions</option>}
          {options.map((d) => <option key={d.code} value={d.code}>{d.name}{d.status !== 'active' ? ' (inactive)' : ''}</option>)}
        </select>
        <noscript><button type="submit" className="btn btn-ghost btn-sm">Show</button></noscript>
      </div>
    </form>
  );
}
