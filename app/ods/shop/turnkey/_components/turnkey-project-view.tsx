import Image from 'next/image';
import { ImageIcon, Tag } from 'lucide-react';
import { Breadcrumbs, Button, Icon, Money, Stepper, formatNumber } from '@octopus/ui';
import { isOptimizableImage } from '@octopus/ui/image-url';
import { TK_PHASES } from '@/lib/turnkey/format';
import { feeUnit, type IncludedRow } from '../_lib/turnkey-logic';

export type TurnkeyProjectViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  project: {
    id: string;
    title: string;
    category: string;
    summary: string | null;
    image: { src: string; alt: string } | null;
    /** turnkey_projects.starting_budget_usd (whole US$) — null = set in your quote. */
    fromUsd: number | null;
    budgetUnit: string | null;
    floorAreaM2: number | null;
  };
  /** "What's included" rows from tk_services. Empty = the table says so. */
  included: IncludedRow[];
  /** The services list failed: only that table shows the error. */
  includedError?: boolean;
};

/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

/**
 * ODS T4 · /shop/turnkey/[slug] (Part 5.6, Shop_Turnkey "project page"): image, What's included table, Price card
 * ("from"), How it works, Start this project. Presentational: props only.
 * How it works shows TODAY's Turnkey journey (8 phases, lib/turnkey/format TK_PHASES) — the board draws 6 steps.
 */
export function TurnkeyProjectView({ project: p, included, includedError, titleLevel }: TurnkeyProjectViewProps) {
  const { T, S } = levels(titleLevel);
  const startHref = `/shop/turnkey/${encodeURIComponent(p.id)}/start`;
  return (
    <div className="flex flex-col gap-6" data-testid="turnkey-project">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Turnkey projects', href: '/shop/turnkey' }, { label: p.title }]} />
      <header className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start ods-tablet:justify-between">
        <div className="flex flex-col gap-1">
          <p className="m-0 text-ods-small font-semibold text-ods-svc-turnkey">{p.category}</p>
          <T className="m-0 text-ods-h1 text-ods-navy">{p.title}</T>
          {p.summary ? <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">{p.summary}</p> : null}
        </div>
        <Button variant="primary" href={startHref} className="shrink-0" data-testid="turnkey-start-link">
          Start this project
        </Button>
      </header>

      <div className="grid gap-5 ods-desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {p.image ? (
          <Image
            src={p.image.src}
            alt={p.image.alt}
            width={800}
            height={600}
            unoptimized={!isOptimizableImage(p.image.src)}
            sizes="(min-width: 1200px) 50vw, 100vw"
            className="aspect-[4/3] w-full rounded-ods-card bg-ods-canvas object-cover"
          />
        ) : (
          <div aria-hidden="true" className="grid aspect-[4/3] w-full place-items-center rounded-ods-card bg-ods-canvas text-ods-slate">
            <Icon icon={ImageIcon} size="xl" />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="tk-included" className="overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface">
            <S id="tk-included" className="m-0 border-b border-ods-line px-ods-pad-card py-3 text-ods-h2 text-ods-navy">
              What&apos;s included
            </S>
            {includedError ? (
              <p className="m-0 p-ods-pad-card text-ods-body text-ods-danger">We couldn&apos;t load this list. Reload the page to try again.</p>
            ) : included.length === 0 ? (
              <p className="m-0 p-ods-pad-card text-ods-body text-ods-slate">Your account manager lists what&apos;s included in your quote.</p>
            ) : (
              <table className="w-full border-collapse text-ods-table">
                <caption className="sr-only">Services included in a turnkey project, with their starting fees</caption>
                <thead>
                  <tr className="bg-ods-canvas text-ods-small text-ods-slate">
                    <th scope="col" className="px-4 py-2 text-start font-semibold">
                      Item
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-semibold">
                      Starting fee
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {included.map((r) => (
                    <tr key={r.id} className="border-t border-ods-line align-top">
                      <th scope="row" className="px-4 py-3 text-start font-normal">
                        <span className="block font-semibold text-ods-navy">{r.item}</span>
                        {r.detail ? <span className="block text-ods-small text-ods-slate">{r.detail}</span> : null}
                      </th>
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        {r.fee.cents === 0 ? (
                          'Included'
                        ) : (
                          <>
                            {r.fee.approx ? 'About ' : 'From '}
                            <Money amount={r.fee.cents / 100} suffix={feeUnit(r.fee.unit) || undefined} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="tk-price" className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
            <S id="tk-price" className="m-0 flex items-center gap-2 text-ods-h2 text-ods-navy">
              <Icon icon={Tag} size="sm" className="text-ods-blue" />
              Price
            </S>
            <dl className="m-0 flex flex-col gap-2 text-ods-body">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="text-ods-slate">From</dt>
                <dd className="m-0 font-semibold text-ods-navy" data-testid="turnkey-from">
                  {p.fromUsd != null ? <Money amount={p.fromUsd} decimals={0} suffix={p.budgetUnit ?? undefined} /> : 'Budget in your quote'}
                </dd>
              </div>
              {p.floorAreaM2 != null ? (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-ods-slate">Based on</dt>
                  <dd className="m-0 text-ods-navy">About {formatNumber(p.floorAreaM2)} m²</dd>
                </div>
              ) : null}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="text-ods-slate">Payment</dt>
                <dd className="m-0 text-end text-ods-navy">Each paid phase has a proforma; you approve the fee before work starts</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <section aria-labelledby="tk-how" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card">
        <S id="tk-how" className="m-0 text-ods-h2 text-ods-navy">
          How it works
        </S>
        <Stepper
          orientation="vertical"
          label="How a turnkey project works"
          current={0}
          steps={TK_PHASES.map((ph) => ({ id: ph.code, label: `${ph.n} · ${ph.name}`, detail: ph.what }))}
        />
        <Button variant="primary" href={startHref} className="self-start">
          Start this project
        </Button>
      </section>
    </div>
  );
}
