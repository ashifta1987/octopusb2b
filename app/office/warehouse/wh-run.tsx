'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** Shared by the W2b staff screens: run a server action, show its sentence, refresh the server data on success. */
export type RunResult = { ok: boolean; message?: string; error?: string; data?: unknown };
export type Msg = { ok: boolean; text: string } | null;

export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (p: () => Promise<RunResult>, after?: (r: RunResult) => void) => start(async () => {
    const r = await p();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(r); router.refresh(); }
  });
  return { pending, msg, run, setMsg };
}

export function MsgLine({ msg, testId }: { msg: Msg; testId: string }) {
  return msg
    ? <p role={msg.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[13px] ${msg.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>{msg.text}</p>
    : null;
}
