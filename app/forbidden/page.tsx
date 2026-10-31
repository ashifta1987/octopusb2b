import Link from 'next/link';
export const metadata = { title: 'No access' };
export default function Forbidden() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center">
        <h1 className="text-2xl font-bold">You don’t have access to this page</h1>
        <p className="text-muted mt-2">Your role doesn’t include this permission. Ask an Admin to update your role in Staff &amp; roles.</p>
        <div className="mt-6 flex gap-3 justify-center"><Link href="/" className="btn btn-ghost">Home</Link><Link href="/account" className="btn btn-primary">My account</Link></div>
      </div>
    </main>
  );
}
