'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Error state for every route (SPEC §8.4 "every list has loading skeleton, empty state and error state").
 * Server errors arrive with a digest only (no details leak); the digest is shown so support can find the log line.
 */
export function ErrorState({ error, retry, home = '/' }: { error: unknown; retry: () => void; home?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <div role="alert" className="max-w-xl mx-auto my-16 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-[#FDECEC] border border-[#F3C5C5] flex items-center justify-center mx-auto mb-3" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B42318" strokeWidth="2"><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>
      </div>
      <h1 className="font-display text-xl font-semibold text-navy">This page could not be loaded</h1>
      <p className="text-sm text-muted mt-2">Something went wrong on our side. Try again — if it keeps happening, contact support and quote the reference below.</p>
      {digest && <p className="mono text-xs text-muted mt-2">Reference: {digest}</p>}
      <div className="mt-5 flex gap-3 justify-center">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
        <Link href={home} className="btn btn-ghost">Go back</Link>
      </div>
    </div>
  );
}

/** Loading skeleton used by route-level loading.tsx files. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-64 max-w-full rounded bg-line mb-2" />
      <div className="h-4 w-96 max-w-full rounded bg-line/70 mb-6" />
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-[10px] bg-white border border-line" />)}
      </div>
      <div className="rounded-[10px] bg-white border border-line p-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="h-5 rounded bg-line/70" />)}
      </div>
    </div>
  );
}
