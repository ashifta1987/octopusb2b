'use client';

import { useId, useState } from 'react';
import { GoogleSignInButton, type GoogleButtonText } from '@octopus/ui/components/google-sign-in-button';
import { createClient } from '@/lib/supabase/client';
import { safeNext } from '@/lib/safe-next';

export const GOOGLE_NOT_READY = 'Google sign-in is being set up. Use your work email for now.';

/**
 * Starts Google sign-in exactly like today's AuthForm (app/(auth)/auth-form.tsx): Supabase OAuth with
 * redirectTo = origin + /auth/callback?via=google&next=<same-site next> and Google's account chooser. The callback
 * blocks staff e-mails and decides setup / invite / next.
 * `enabled` = lib/auth-providers.ts (site setting auth.social_providers lists google AND Supabase has it on). When off the
 * button stays visible but disabled WITH the reason (decision: the board always shows Google, and the reason tells the
 * visitor what to do instead).
 */
export function OdsGoogleButton({ next, enabled, text = 'signin', testId = 'google-signin' }: { next: string; enabled: boolean; text?: GoogleButtonText; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reasonId = useId();
  const errId = useId();
  async function start() {
    setErr(null);
    setBusy(true);
    const target = safeNext(next, '/shop');
    const redirectTo = `${window.location.origin}/auth/callback?via=google&next=${encodeURIComponent(target)}`;
    const { error } = await createClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
    if (error) {
      setBusy(false);
      setErr(/not enabled/i.test(error.message) ? 'Google sign-in is not available right now. Use your email instead.' : 'We couldn’t open Google sign-in. Please try again.');
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <GoogleSignInButton
        text={text}
        fullWidth
        data-testid={testId}
        data-enabled={enabled ? 'true' : 'false'}
        disabled={!enabled}
        disabledReason={GOOGLE_NOT_READY}
        reasonId={reasonId}
        loading={busy}
        aria-describedby={err ? errId : undefined}
        onClick={start}
      />
      {err ? (
        <p id={errId} role="alert" className="text-ods-small font-medium text-ods-danger">
          {err}
        </p>
      ) : null}
    </div>
  );
}
