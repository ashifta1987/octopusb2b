'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from 'react';

/** Shared by the W2b staff screens: run a server action, show its sentence, refresh the server data on success. */
export type RunResult = { ok: boolean; message?: string; error?: string; data?: unknown };
export type Msg = { ok: boolean; text: string } | null;

/**
 * Held results: some actions move their item out of the refreshed view (a finished return leaves the Open list, a resolved
 * exception leaves the open queue, a packed order loses its close card). The form that ran the action unmounts with it, and its
 * success sentence would vanish while staff (or a test) read it. `useRun({ holdAs })` puts a successful sentence into the
 * nearest <HeldResults> (state ABOVE the refreshed list), shown by <HeldResultsList/> with the same test id; errors stay on the
 * form, which is still there.
 */
type Held = { testId: string; text: string };
type HeldApi = { hold: (h: Held) => void; drop: (testId: string) => void; items: Held[] };
const HeldCtx = createContext<HeldApi | null>(null);

export function HeldResults({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Held[]>([]);
  const hold = useCallback((h: Held) => setItems((xs) => [...xs.filter((x) => x.testId !== h.testId), h]), []);
  const drop = useCallback((testId: string) => setItems((xs) => (xs.some((x) => x.testId === testId) ? xs.filter((x) => x.testId !== testId) : xs)), []);
  return <HeldCtx.Provider value={{ hold, drop, items }}>{children}</HeldCtx.Provider>;
}

export function HeldResultsList({ testId = 'wh-held-results' }: { testId?: string }) {
  const ctx = useContext(HeldCtx);
  if (!ctx || ctx.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" aria-live="polite" data-testid={testId}>
      {ctx.items.map((h) => <MsgLine key={h.testId} msg={{ ok: true, text: h.text }} testId={h.testId} />)}
    </div>
  );
}

export function useRun(opts: { holdAs?: string; holdPrefix?: string } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const held = useContext(HeldCtx);
  const holding = Boolean(opts.holdAs && held);
  const run = (p: () => Promise<RunResult>, after?: (r: RunResult) => void) => start(async () => {
    if (holding) held!.drop(opts.holdAs!);
    const r = await p();
    if (r.ok && holding) {
      setMsg(null);
      held!.hold({ testId: opts.holdAs!, text: `${opts.holdPrefix ?? ''}${r.message ?? 'Done.'}` });
    } else {
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    }
    if (r.ok) { after?.(r); router.refresh(); }
  });
  return { pending, msg, run, setMsg };
}

export function MsgLine({ msg, testId }: { msg: Msg; testId: string }) {
  return msg
    ? <p role={msg.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>
    : null;
}
