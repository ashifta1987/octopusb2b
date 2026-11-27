import { Suspense } from 'react';
import { safeNext } from '@/lib/safe-next';
import { SERVICE_TARGET } from '@/lib/signup-service';
import { customerHome, isShopEnabled } from '@/lib/shop/flag';
import { getCustomerSocialProviders } from '@/lib/auth-providers';
import { friendlyAuthError } from '@/lib/auth-errors';
import { loginStateFrom } from '@/lib/ods-auth';
import { LoginView } from '../_components/login-view';

export const metadata = {
  title: 'Sign in or create your account · Octopus B2B',
  description: 'Sign in to Octopus B2B with Google or your work email. New here? The same button creates your free account.',
  alternates: { canonical: '/login' },
};

type SP = Promise<{ next?: string; error?: string; state?: string; reset?: string; service?: string }>;

/**
 * /login and /signup on the ODS theme (Part 4.3). proxy.ts rewrites both here only when the switch is on for the visitor;
 * signed-in customers never see it (proxy sends them to the Shop / a safe ?next=). After sign-in the Shop opens in THIS tab
 * (the introduction page opens /login in the named Shop tab).
 */
export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<main id="main" className="min-h-screen bg-ods-surface" aria-busy="true" />}>
      <Login searchParams={searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: { searchParams: SP }) {
  const [sp, social, shopOn] = await Promise.all([searchParams, getCustomerSocialProviders(), isShopEnabled()]);
  // CH-1: customers land on the Shop unless a safe same-site ?next= (or a ?service= section) is given — same as today
  const next = safeNext(sp.next ?? (sp.service ? SERVICE_TARGET[sp.service] : undefined), customerHome(shopOn));
  const state = loginStateFrom({ error: sp.error, state: sp.state, next });
  // only a text friendlyAuthError() itself produces is shown (never raw URL text)
  const detail = sp.error && friendlyAuthError(sp.error) === sp.error ? sp.error : null;
  return <LoginView next={next} google={social.google} state={state} detail={detail} passwordReset={sp.reset === '1'} />;
}
