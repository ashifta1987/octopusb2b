import { SERVICE_TARGET } from '@/lib/signup-service';
import Link from 'next/link';
import { Logo } from '@/components/ui';
import { AuthForm } from './auth-form';
import { getCustomerSocialProviders } from '@/lib/auth-providers';

export const metadata = { title: 'Sign up or log in' };

/** Auth.png — sign up & log in (email + password with 6-digit OTP, plus "Continue with Google" for customers when enabled in Supabase — 5 Nov 2026). */
/** Two-column Auth.png frame (navy benefits panel + form column), shared by login, sign-up and password reset. */
export function AuthShell({ children, title = 'Create a free account', sub = 'An account is needed to request quotes, see your tier prices, place orders and track shipments.' }: { children: React.ReactNode; title?: string; sub?: string }) {
  return (
    <div className="min-h-screen grid md:grid-cols-[637fr_803fr]">
      <aside className="bg-ink text-white px-8 sm:px-12 py-12 flex flex-col">
        <Logo white />
        <h1 className="!text-white text-[34px] sm:text-[38px] font-bold leading-[1.15] mt-12 max-w-[460px]">{title}</h1>
        <p className="text-on-ink mt-4 text-lg max-w-[440px]">{sub}</p>
        <ul className="mt-8 space-y-4 text-[16px]">
          {['Send one RFQ to several verified suppliers', 'Ship worldwide with YunExpress tracking', 'Request 3PL fulfillment or dropshipping'].map((t) => (
            <li key={t} className="flex gap-3 items-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-on-ink-link" strokeWidth="2.5" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{t}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-12 text-sm text-on-ink">Global Sourcing, Simplified</div>
      </aside>
      <main className="bg-pearl px-6 py-12 flex justify-center">
        <div className="w-full max-w-[480px]">
          {children}
          <p className="text-center text-sm text-muted mt-6">
            By continuing you agree to the <Link href="/legal/terms" className="text-coral-text font-semibold">Terms</Link> and <Link href="/legal/privacy" className="text-coral-text font-semibold">Privacy Policy</Link>.
          </p>
          <p className="text-center text-sm text-muted mt-4 pt-4 border-t border-line">
            Octopus staff? <Link href="/staff/login" className="text-coral-text font-semibold">Back office login</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default async function AuthPage({ searchParams, mode }: { searchParams: Promise<{ next?: string; error?: string; reset?: string; service?: string }>; mode: 'signup' | 'login' }) {
  const [sp, social] = await Promise.all([searchParams, getCustomerSocialProviders()]);
  const next = sp.next ?? (sp.service ? SERVICE_TARGET[sp.service] : undefined) ?? '/account';
  return (
    <AuthShell title={mode === 'login' ? 'Log in to Octopus B2B' : 'Create a free account'}
      sub={mode === 'login' ? 'Welcome back. Your requests, quotes, orders and wallet are waiting in your account.' : 'An account is needed to request quotes, see your tier prices, place orders and track shipments.'}>
      {sp.reset === '1' && <p role="status" className="mb-5 rounded-[10px] border border-line bg-tint px-3.5 py-3 text-[13px] text-coral-text">Your password was changed. Log in with the new password.</p>}
      <AuthForm initialMode={mode} next={next} initialError={sp.error} google={social.google} />
    </AuthShell>
  );
}
