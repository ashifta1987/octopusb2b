import { SERVICE_TARGET } from '@/lib/signup-service';
import Link from 'next/link';
import { AuthForm } from './auth-form';
import { getCustomerSocialProviders } from '@/lib/auth-providers';
import { SiteFrame } from '@/components/store-shell';
import { Pic, Check, h1Class } from '@/components/site/ui';
import { siteImage } from '@/lib/site-images';

export const metadata = { title: 'Sign up or log in' };

const LOGIN_TICKS = [
  'One account for sourcing, branding, MOQ pools, turnkey projects and logistics',
  'US dollar wallet with escrow protection',
  'One account manager, office hours 09:00–18:00 China time (UTC+8)',
];
const SIGNUP_TICKS = ['Send one RFQ to several verified suppliers', 'Ship worldwide with live tracking', 'Request 3PL fulfillment or dropshipping'];

/**
 * Customer log in (design page 09) inside the website shell: form card on the left, picture and benefits on the right.
 * Shared by log in, sign-up, forgot and reset password (their own wording is unchanged).
 */
export function AuthShell({ children, title = 'Create a free account', sub = 'An account is needed to request quotes, see your tier prices, place orders and track shipments.', ticks = SIGNUP_TICKS, footer = true, signup = false }: {
  children: React.ReactNode; title?: string; sub?: string; ticks?: string[]; footer?: boolean; signup?: boolean;
}) {
  const side = siteImage(signup ? 'auth-side-signup' : 'auth-side');
  return (
    <SiteFrame>
      <section className="px-4 sm:px-6 pt-14 pb-20" aria-labelledby="auth-h1">
        <div className="max-w-[1100px] mx-auto flex flex-wrap gap-12 items-start">
          <div className="flex-[1_1_440px] min-w-0 bg-white border border-line rounded-[24px] p-6 sm:p-10">
            <h1 id="auth-h1" className={`${h1Class} text-[length:clamp(30px,4vw,36px)]!`}>{title}</h1>
            <p className="mt-3 mb-6 text-[17px] leading-[1.6] text-muted">{sub}</p>
            {children}
            {footer && (
              <>
                <p className="mt-6 mb-0 text-[16px] text-muted">New to Octopus B2B? <Link href="/signup" className="font-semibold underline text-ink hover:text-coral-text">Create a free account</Link></p>
                <p className="mt-2 mb-0 text-[15px] text-muted">Octopus staff? <Link href="/staff/login" className="font-semibold underline text-ink hover:text-coral-text">Back office sign-in</Link></p>
              </>
            )}
            <p className="mt-5 mb-0 text-[13px] text-muted">
              By continuing you agree to the <Link href="/legal/terms" className="font-semibold underline text-ink">Terms</Link> and <Link href="/legal/privacy" className="font-semibold underline text-ink">Privacy Policy</Link>.
            </p>
          </div>
          <div className="flex-[1_1_400px] min-w-0">
            <figure className="m-0">
              <Pic src={side.src} alt={side.alt} sizes="(min-width:1100px) 520px, 100vw" />
            </figure>
            <ul className="mt-10 list-none p-0 flex flex-col gap-4 text-[17px] text-black">
              {ticks.map((t) => <li key={t} className="flex gap-3"><Check className="text-coral-text" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}

export default async function AuthPage({ searchParams, mode }: { searchParams: Promise<{ next?: string; error?: string; reset?: string; service?: string }>; mode: 'signup' | 'login' }) {
  const [sp, social] = await Promise.all([searchParams, getCustomerSocialProviders()]);
  const next = sp.next ?? (sp.service ? SERVICE_TARGET[sp.service] : undefined) ?? '/account';
  const login = mode === 'login';
  return (
    <AuthShell
      title={login ? 'Customer log in' : 'Create a free account'}
      sub={login ? 'Request quotes, manage orders, check your wallet and track shipments.' : 'An account is needed to request quotes, see your tier prices, place orders and track shipments.'}
      ticks={login ? LOGIN_TICKS : SIGNUP_TICKS}
      footer={login} signup={!login}>
      {sp.reset === '1' && <p role="status" className="mb-5 rounded-[10px] border border-line bg-tint px-3.5 py-3 text-[14px] text-coral-text">Your password was changed. Log in with the new password.</p>}
      <AuthForm initialMode={mode} next={next} initialError={sp.error} google={social.google} design={login} />
    </AuthShell>
  );
}
