import Link from 'next/link';
import { Logo } from '@/components/ui';
import { AuthForm } from './auth-form';

export const metadata = { title: 'Sign up or log in' };

/** Auth.png — sign up & log in (Google + email with 6-digit OTP). */
export default async function AuthPage({ searchParams, mode }: { searchParams: Promise<{ next?: string; error?: string }>; mode: 'signup' | 'login' }) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen grid md:grid-cols-[637fr_803fr]">
      <aside className="bg-navy text-white px-8 sm:px-12 py-12 flex flex-col">
        <Logo white />
        <h1 className="!text-white text-[34px] sm:text-[38px] font-bold leading-[1.15] mt-12 max-w-[460px]">Create a free account to start sourcing.</h1>
        <p className="text-[#C9CFDB] mt-4 text-lg max-w-[440px]">An account is needed to request quotes, see your tier prices, place orders and track shipments.</p>
        <ul className="mt-8 space-y-4 text-[16px]">
          {['Send one RFQ to several verified suppliers', 'Ship worldwide with YunExpress tracking', 'Request 3PL fulfillment or dropshipping'].map((t) => (
            <li key={t} className="flex gap-3 items-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B9BF0" strokeWidth="2.5" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{t}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-12 text-sm text-[#A9B1C2]">Global Sourcing, Simplified</div>
      </aside>
      <main className="bg-surface px-6 py-12 flex justify-center">
        <div className="w-full max-w-[480px]">
          <AuthForm initialMode={mode} next={sp.next ?? '/account'} initialError={sp.error} />
          <p className="text-center text-sm text-muted mt-6">
            By continuing you agree to the <Link href="/legal/terms" className="text-blue font-semibold">Terms</Link> and <Link href="/legal/privacy" className="text-blue font-semibold">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}

