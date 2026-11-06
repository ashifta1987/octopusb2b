import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LeadPage } from '../lead-page';

export const metadata: Metadata = { title: 'Register interest', robots: { index: false } };

/** /turnkey/<register-interest project>/interest — interest form (ADDON-31 §3). */
export default function InterestPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-[600px]" aria-hidden />}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <LeadPage slug={slug} kind="interest" searchParams={sp} />;
}

