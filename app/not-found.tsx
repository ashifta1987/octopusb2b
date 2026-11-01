import Link from 'next/link';

/** 404 for unknown routes and notFound() calls (SPEC §8.4 empty/error states). */
export default function NotFound() {
  return (
    <main className="max-w-xl mx-auto my-20 px-6 text-center">
      <p className="mono text-sm text-muted">404</p>
      <h1 className="font-display text-2xl font-semibold text-navy mt-1">We couldn’t find that page</h1>
      <p className="text-sm text-muted mt-2">The link may be old or the item is no longer available.</p>
      <div className="mt-5 flex gap-3 justify-center">
        <Link href="/" className="btn btn-primary">Go to the homepage</Link>
        <Link href="/products" className="btn btn-ghost">Browse products</Link>
      </div>
    </main>
  );
}
