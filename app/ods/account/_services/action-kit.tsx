'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cx } from '@octopus/ui';

/** Result shape of today's server actions ({ ok, message } or { ok, error }), normalised. */
export type ActionMsg = { ok: boolean; text: string } | null;

/** Runs one server action at a time: pending flag, the result message, and a refresh after success (today's behaviour). */
export function useRun(opts: { refresh?: boolean } = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionMsg>(null);
  const run = (fn: () => Promise<ActionMsg>, onOk?: () => void) => start(async () => {
    try {
      const r = await fn();
      setMsg(r);
      if (r?.ok) { onOk?.(); if (opts.refresh !== false) router.refresh(); }
    } catch {
      setMsg({ ok: false, text: 'Something went wrong. Please try again or contact us.' });
    }
  });
  return { pending, msg, setMsg, run };
}

/** The message under a form: polite status for success, alert for an error (never colour alone: the words say it). */
export function ActionMessage({ msg, testId, className }: { msg: ActionMsg; testId?: string; className?: string }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? 'status' : 'alert'} data-testid={testId}
      className={cx('m-0 rounded-ods-control border px-3 py-2 text-ods-body', msg.ok ? 'border-ods-success bg-ods-success-tint text-ods-text' : 'border-ods-danger bg-ods-danger-tint text-ods-text', className)}>
      {msg.text}
    </p>
  );
}
