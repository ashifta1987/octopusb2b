'use client';
import { useRef, useTransition } from 'react';
import type { Division } from '@/lib/divisions/shared';

/**
 * Divisions step 4 — header switcher: "All divisions" or one division. Submits on change (server action sets the
 * cookie); without JavaScript the "Show" button submits the form.
 */
export function DivisionSwitcher({ options, current, action }: { options: Division[]; current: string | null; action: (fd: FormData) => Promise<void> }) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  if (options.length === 0) return null;
  const single = options.length === 1;
  return (
    <form ref={form} action={action} className="flex items-center gap-2" data-testid="division-switcher">
      <label htmlFor="division-switch" className="sr-only">Division</label>
      <select key={current ?? 'all'} id="division-switch" name="division" defaultValue={current ?? 'all'} disabled={pending}
        onChange={() => start(() => form.current?.requestSubmit())}
        className="min-h-11 rounded-[10px] border border-white/40 bg-white/10 text-white text-sm font-semibold px-3 pr-8 hover:border-white focus:outline-none focus:ring-2 focus:ring-white [&>option]:text-ink">
        {!single && <option value="all">All divisions</option>}
        {options.map((d) => <option key={d.code} value={d.code}>{d.name}{d.status !== 'active' ? ' (inactive)' : ''}</option>)}
      </select>
      <noscript><button type="submit" className="btn btn-ghost btn-sm">Show</button></noscript>
    </form>
  );
}
