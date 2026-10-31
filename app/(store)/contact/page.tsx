import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CompanyPage, CompanySkeleton } from '@/components/store/company-page';

export const metadata: Metadata = { title: 'Contact us', alternates: { canonical: '/contact' } };

export default function Page() {
  return (
    <Suspense fallback={<CompanySkeleton />}>
      <CompanyPage slug="contact" showContact />
    </Suspense>
  );
}
