import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { MfaForm } from './mfa-form';

export const metadata = { title: 'Two-step verification' };

/** Only same-site relative paths are allowed as the post-verification target. */
function safeNext(n: string | undefined) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/account';
}

async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(`/mfa?next=${encodeURIComponent(next)}`)}`);
  return (
    <main className="min-h-screen bg-surface px-6 py-12 flex flex-col items-center">
      <Logo />
      <div className="w-full max-w-[460px] mt-10">
        <MfaForm next={next} email={s.email} />
      </div>
    </main>
  );
}

/** 2FA (TOTP): enrol an authenticator app, or step up the session to aal2 before sensitive actions (SPEC §3, §16.3). */
export default function Page(props: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <MfaPage {...props} />
    </Suspense>
  );
}
