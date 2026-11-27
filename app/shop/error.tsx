'use client';
import Link from 'next/link';

/** CH-1 Shop error state: plain words, a retry and a way out (UI rule 7). */
export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-[720px] mx-auto px-4 py-16 text-center" role="alert">
      <h1 className="text-[26px] font-bold">This part of the shop did not load</h1>
      <p className="mt-2 text-[16px] text-black">Nothing was sent or charged. Try again, or open your account panel.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/account" className="btn btn-ghost">Open my account panel</Link>
      </div>
    </div>
  );
}
