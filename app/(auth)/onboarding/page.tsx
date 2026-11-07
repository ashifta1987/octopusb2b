import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { safeAccountNext } from '@/lib/signup-service';
import { Logo } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES, mapDbError } from '@/lib/format';
import { z } from 'zod';
import Link from 'next/link';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';

export const metadata = { title: 'Create your profile' };

const Profile = z.object({
  full_name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  country: z.string().length(2),
  city: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(6).max(30),
  business_type: z.string().min(2),
});

async function save(formData: FormData) {
  'use server';
  const parsed = Profile.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect('/onboarding?error=' + encodeURIComponent('Please fill in every field.'));
  const d = parsed.data;
  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  const c = claims?.claims;
  if (c?.sub && (await refuseStaff(c.sub as string, (c.email as string) ?? null))) redirect('/onboarding');
  const { error } = await sb.rpc('complete_onboarding', {
    p_full_name: d.full_name, p_company: d.company, p_country: d.country, p_phone: d.phone, p_business_type: d.business_type, p_city: d.city ?? null,
  });
  if (error) redirect('/onboarding?error=' + encodeURIComponent(mapDbError(error)));
  redirect(safeAccountNext(formData.get('next')));
}

/** Staff (role or staff email domain) never get a customer profile/org (SPEC §17.3). */
async function refuseStaff(userId: string, email: string | null) {
  try {
    return (await isStaffUser(userId)) || (!!email && (await emailIsStaff(email)));
  } catch {
    return false; // the STAFF_CANNOT_BE_CUSTOMER trigger still blocks it in the database
  }
}

/** Create profile — required before anything else (SPEC §4.1 step 2). */
export default function OnboardingPage(props: { searchParams: Promise<{ error?: string; next?: string }> }) {
  return <Suspense fallback={<main className="min-h-screen bg-surface" />}><Onboarding {...props} /></Suspense>;
}

async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const s = await getSession();
  const next = safeAccountNext((await searchParams).next);
  if (!s) redirect(`/login?next=${encodeURIComponent(next === '/account' ? '/onboarding' : `/onboarding?next=${next}`)}`);
  if (s.profile && s.org) redirect(next);
  if (s.isStaff || (await refuseStaff(s.userId, s.email))) {
    return (
      <main className="min-h-screen bg-surface px-6 py-10">
        <div className="max-w-[560px] mx-auto">
          <Logo />
          <h1 className="text-[28px] font-semibold mt-8">This is a staff account</h1>
          <p className="text-muted mt-2">Octopus staff cannot create a customer profile. Sign in to the back office instead.</p>
          <div className="flex gap-3 mt-6">
            <Link href="/staff/login" className="btn btn-primary">Back office login</Link>
            <form action="/auth/signout" method="post"><button className="btn btn-ghost" type="submit">Sign out</button></form>
          </div>
        </div>
      </main>
    );
  }
  const { error } = await searchParams;
  const types = ['Importer / wholesaler', 'Retailer / e-commerce', 'Contractor / end user', 'Distributor', 'Manufacturer', 'Other'];
  return (
    <main className="min-h-screen bg-surface px-6 py-10">
      <div className="max-w-[560px] mx-auto">
        <Logo />
        <div className="grid grid-cols-3 gap-2 my-8">
          {['Email', 'Verify', 'Profile'].map((x) => <div key={x}><div className="h-1 rounded-full bg-blue-fill" /><div className="mt-2 text-xs font-semibold">{x}</div></div>)}
        </div>
        <h1 className="text-[28px] font-semibold">Create your profile</h1>
        <p className="text-muted mt-1">We need a few details before you can request quotes or place orders.</p>
        <form action={save} className="card p-6 mt-6 grid gap-5 sm:grid-cols-2">
          <input type="hidden" name="next" value={next} />
          <div className="sm:col-span-2"><label className="label" htmlFor="full_name">Full name</label><input id="full_name" name="full_name" required className="input" defaultValue={s.profile?.full_name ?? ''} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="company">Company</label><input id="company" name="company" required className="input" /></div>
          <div>
            <label className="label" htmlFor="country">Country</label>
            <select id="country" name="country" required className="input" defaultValue="">
              <option value="" disabled>Select…</option>
              {Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" /></div>
          <div><label className="label" htmlFor="phone">Phone / WhatsApp</label><input id="phone" name="phone" type="tel" required className="input" placeholder="+971 50 000 0000" /></div>
          <div>
            <label className="label" htmlFor="business_type">Business type</label>
            <select id="business_type" name="business_type" required className="input" defaultValue="">
              <option value="" disabled>Select…</option>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          {error && <p className="sm:col-span-2 text-sm text-bad" role="alert">{error}</p>}
          <button className="btn btn-primary sm:col-span-2 min-h-12">Continue</button>
        </form>
      </div>
    </main>
  );
}

