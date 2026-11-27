'use client';

import { useState, useTransition } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@octopus/ui';
import type { NotifyAction } from './pool-types';

/**
 * Notify me (pool full or closed). Uses today's only notify mechanism: "Get notified when a pool opens"
 * (subscribePoolAlerts → pool_alert_signups, emailed when the NEXT pool opens; it is not tied to one product).
 * Without an email or an action the button stays disabled with the reason next to it.
 */
export function NotifyMe({ email, action }: { email: string | null; action?: NotifyAction }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reason = !action ? 'Pool alerts are not available right now.' : !email ? 'Add an email to your account to get pool alerts.' : undefined;
  if (msg?.ok) {
    return (
      <p role="status" className="m-0 text-ods-small font-semibold text-ods-success" data-testid="pool-notify-done">
        {msg.text}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        iconStart={Bell}
        disabled={Boolean(reason)}
        disabledReason={reason}
        loading={pending}
        loadingText="Saving…"
        data-testid="pool-notify"
        onClick={() =>
          start(async () => {
            if (!action || !email) return;
            const r = await action(email);
            setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          })
        }
      >
        Notify me
      </Button>
      <p role="status" aria-live="polite" className={msg ? 'm-0 text-ods-small text-ods-danger' : 'sr-only'}>
        {msg && !msg.ok ? msg.text : ''}
      </p>
    </div>
  );
}
