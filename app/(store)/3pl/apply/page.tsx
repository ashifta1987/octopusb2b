import { Suspense } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ApplyClient } from './apply-client';

export const metadata: Metadata = { title: 'Apply for a 3PL account | Octopus B2B', alternates: { canonical: '/3pl/apply' } };

/** Warehouse OS board 27 — Apply and sign in (one card, two tabs). */
export default function ApplyPage() {
  return <Suspense fallback={<div className="h-[600px]" aria-hidden />}><Content /></Suspense>;
}
async function Content() {
  const sb = await createClient();
  const { data } = await sb.from('warehouses').select('code, name, city').eq('status', 'active').order('is_default', { ascending: false }).order('name');
  return (
    <div className="bg-tint min-h-[70vh] py-10 px-4">
      <ApplyClient warehouses={(data ?? []) as { code: string; name: string; city: string }[]} />
    </div>
  );
}
