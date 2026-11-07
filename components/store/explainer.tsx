import Link from 'next/link';
import { Breadcrumbs } from './seo';

export type Explainer = {
  name: string;
  h1: string;
  intro: string;
  points: [string, string][];
  next: string; // account page the signed-in user lands on
  extra?: React.ReactNode;
};

/** ADDON-36 H4 — public explainer for a signed-in feature (wallet, assistant, API), with "Sign in to use it". */
export function ExplainerPage({ e }: { e: Explainer }) {
  return (
    <div className="max-w-[1080px] mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: e.name }]} />
      <section className="mt-4">
        <h1 className="text-[30px] sm:text-[40px] font-extrabold leading-tight max-w-[760px]">{e.h1}</h1>
        <p className="mt-3 text-[16px] text-muted max-w-[700px]">{e.intro}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/login?next=${encodeURIComponent(e.next)}`} className="btn btn-primary min-h-11" data-testid="explainer-signin">Sign in to use it</Link>
          <Link href={`/signup?next=${encodeURIComponent(e.next)}`} className="btn btn-ghost min-h-11">Create a free account</Link>
        </div>
      </section>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {e.points.map(([t, b]) => (
          <li key={t} className="card p-5"><h2 className="text-[16px] font-bold">{t}</h2><p className="text-[14px] text-muted mt-1.5">{b}</p></li>
        ))}
      </ul>
      {e.extra}
    </div>
  );
}
