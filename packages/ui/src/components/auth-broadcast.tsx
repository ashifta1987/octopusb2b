'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useFocusTrap } from '../hooks';
import { buttonClass } from '../styles';
import { Icon } from '../icon';

/**
 * Sign-out across tabs (Part 4.6): the tab that signs out posts { type: 'signed-out' } on BroadcastChannel('octopus-auth').
 *  - Shop / My account / Back Office tabs (mode "overlay") show "You signed out" with a Sign in button;
 *  - the introduction tab (mode "refresh") re-renders, so its header swaps back to "Sign in".
 * Browsers without BroadcastChannel simply skip it (the next request is signed out anyway).
 */
export const AUTH_CHANNEL = 'octopus-auth';
export type AuthMessage = { type: 'signed-out' } | { type: 'signed-in' };

export function broadcastAuth(msg: AuthMessage) {
  try {
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    /* not supported */
  }
}

export function AuthBroadcastListener({ mode = 'overlay', signInHref = '/login?state=signed-out' }: { mode?: 'overlay' | 'refresh'; signInHref?: string }) {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, signedOut, { returnFocus: false });
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(AUTH_CHANNEL);
    } catch {
      return;
    }
    ch.onmessage = (e: MessageEvent<AuthMessage>) => {
      if (e.data?.type !== 'signed-out') return;
      if (mode === 'refresh') router.refresh();
      else setSignedOut(true);
    };
    return () => ch?.close();
  }, [mode, router]);
  if (!signedOut) return null;
  return (
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center bg-ods-navy/60 p-4" data-testid="signed-out-overlay">
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="ods-signed-out-title" aria-describedby="ods-signed-out-text" tabIndex={-1} className="w-full max-w-sm rounded-ods-card bg-ods-surface p-6 text-center shadow-ods-dialog">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-ods-blue-tint text-ods-navy">
          <Icon icon={LogOut} size="lg" />
        </span>
        <h2 id="ods-signed-out-title">You signed out</h2>
        <p id="ods-signed-out-text" className="mt-1 text-ods-slate">You signed out in another tab. Sign in again to continue.</p>
        <a href={signInHref} className={`${buttonClass('primary', 'md', true)} mt-5`}>Sign in</a>
      </div>
    </div>
  );
}

/** Sign-out form button that tells the other tabs first, then posts to /auth/signout. */
export function SignOutButton({ className, children = 'Sign out' }: { className?: string; children?: ReactNode }) {
  return (
    <form action="/auth/signout" method="post" onSubmit={() => broadcastAuth({ type: 'signed-out' })}>
      <button type="submit" className={className ?? buttonClass('secondary')} data-testid="sign-out">
        {children}
      </button>
    </form>
  );
}
