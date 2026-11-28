'use client';

import { useRouter } from 'next/navigation';
import { ErrorState } from '@octopus/ui';

/** ODS T9 · Accounts batch A: whole-page failure (keeps the one H1; Try again re-renders the server data). */
export function ErrorPage({ title }: { title: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-ods-gap" data-state="error">
      <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">{title}</h1>
      <ErrorState title={`We couldn’t load ${title}`} description="Nothing was changed. Try again in a moment." onRetry={() => router.refresh()} headingLevel={2} />
    </div>
  );
}
