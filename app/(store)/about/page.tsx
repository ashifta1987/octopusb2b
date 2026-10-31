import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CompanyPage, CompanySkeleton } from '@/components/store/company-page';

export const metadata: Metadata = { title: 'About us', alternates: { canonical: '/about' } };

export default function Page() {
  return (
    <Suspense fallback={<CompanySkeleton />}>
      <CompanyPage slug="about" />
    </Suspense>
  );
}
