import { Suspense } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ApplyClient, type ApplyDefaults } from './apply-client';
import { getSession } from '@/lib/auth';

export const metadata: Metadata = { title: 'Apply for a 3PL account | Octopus B2B', alternates: { canonical: '/3pl/apply' } };

/** Warehouse OS board 27 — Apply and sign in (one card, two tabs). */
export default function ApplyPage() {
  return <Suspense fallback={<div className="h-[600px]" aria-hidden />}><Content /></Suspense>;
}
async function Content() {
  const sb = await createClient();
  // CH-1 single sign-in (G1): a signed-in customer applies with the company and contact already filled in (no second account)
  const s = await getSession();
  const defaults: ApplyDefaults | null = s?.org && !s.isStaff
    ? { company: s.org.name, contactName: s.profile?.full_name ?? '', email: s.email ?? '', phone: s.profile?.phone ?? '', country: s.org.country ?? '' }
    : null;
  const { data } = await sb.from('warehouses').select('code, name, city').eq('status', 'active').order('is_default', { ascending: false }).order('name');
  return (
    <div className="bg-tint min-h-[70vh] py-10 px-4">
      <ApplyClient warehouses={(data ?? []) as { code: string; name: string; city: string }[]} defaults={defaults} />
    </div>
  );
}
