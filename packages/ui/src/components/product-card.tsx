import Image from 'next/image';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { BadgeCheck, Eye, ImageIcon, KeyRound, ListPlus, MessageSquareQuote, Plus, Send, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { formatNumber } from '../format';
import { Icon, ODS_SERVICE_ICONS } from '../icon';
import { odsServices, type OdsServiceKey } from '../tokens';
import { Button, type ButtonVariant } from './button';
import { Money } from './money';
import { Skeleton } from './states';
import { StatusPill } from './status-pill';

/** One card button. Give `href` (navigates) or `onClick`. `disabledReason` disables it and shows why next to it. */
export type ProductCardAction = {
  label?: string;
  href?: string;
  onClick?: () => void;
  disabledReason?: string;
  loading?: boolean;
  loadingText?: string;
};

/**
 * `unoptimized`: skip the Next image optimiser (needed for hosts outside next.config remotePatterns, e.g. the
 * `product-media` bucket). Set it with `!isOptimizableImage(src)` from `@octopus/ui/image-url`.
 */
export type ProductCardImage = { src: string; alt: string; width?: number; height?: number; unoptimized?: boolean };
export type ProductCardBadge = { label: string; tone?: 'success' | 'info' | 'neutral' };

export type ProductCardBaseProps = {
  title: string;
  /** Product / pool / project page. The title is the link. */
  href: string;
  /** next/image (width/height default 400 × 300). Omit for the neutral placeholder. */
  image?: ProductCardImage;
  /** Service tag (icon + name) above the title. Default true; hide it inside a ServiceSection if you like. */
  showService?: boolean;
  /** Small badges, e.g. "Verified", "Samples", "Customisable". Never a supplier or factory name. */
  badges?: ProductCardBadge[];
  /** Title heading level: 3 by default, 4 inside a ServiceSection rendered with headingLevel 3. */
  headingLevel?: 3 | 4;
  className?: string;
  'data-testid'?: string;
};

const SVC_TEXT: Record<OdsServiceKey, string> = {
  sourcing: 'text-ods-svc-sourcing',
  pools: 'text-ods-svc-pools',
  dropship: 'text-ods-svc-dropship',
  '3pl': 'text-ods-svc-3pl',
  turnkey: 'text-ods-svc-turnkey',
  brand: 'text-ods-svc-brand',
};

const BADGE: Record<NonNullable<ProductCardBadge['tone']>, string> = {
  success: 'bg-ods-success-tint text-ods-success',
  info: 'bg-ods-info-tint text-ods-info',
  neutral: 'bg-ods-canvas text-ods-slate',
};

const IMG_H = 'h-[calc(var(--ods-control-h)*3)]';

function Frame({
  service,
  title,
  href,
  image,
  showService = true,
  badges,
  headingLevel = 3,
  className,
  'data-testid': testId,
  facts,
  extra,
  actions,
}: ProductCardBaseProps & { service: OdsServiceKey; facts?: ReactNode; extra?: ReactNode; actions: (titleId: string) => ReactNode }) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const svc = odsServices.find((s) => s.key === service);
  return (
    <article
      aria-labelledby={titleId}
      data-service={service}
      data-testid={testId}
      className={cx('flex min-w-0 flex-col gap-2 rounded-ods-card border border-ods-line bg-ods-surface p-[calc(var(--ods-pad-card)-4px)] shadow-ods-card', className)}
    >
      {image ? (
        <Image
          src={image.src}
          alt={image.alt}
          width={image.width ?? 400}
          height={image.height ?? 300}
          unoptimized={image.unoptimized}
          sizes="(min-width: 1200px) 300px, (min-width: 768px) 50vw, 80vw"
          className={cx(IMG_H, 'w-full rounded-ods-control bg-ods-canvas object-cover')}
        />
      ) : (
        <div aria-hidden="true" className={cx(IMG_H, 'grid w-full place-items-center rounded-ods-control bg-ods-canvas text-ods-slate')}>
          <Icon icon={ImageIcon} size="lg" />
        </div>
      )}
      {showService && svc ? (
        <span className={cx('inline-flex items-center gap-1 text-ods-small font-semibold', SVC_TEXT[service])}>
          <Icon icon={ODS_SERVICE_ICONS[service]} size="xs" />
          {svc.name}
        </span>
      ) : null}
      <Heading id={titleId} className="m-0 text-ods-body leading-snug font-semibold">
        <Link href={href} className="text-ods-navy no-underline hover:underline">
          {title}
        </Link>
      </Heading>
      {badges?.length ? (
        <ul role="list" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {badges.map((b) => (
            <li key={b.label} className={cx('inline-flex items-center gap-1 rounded-ods-pill px-2 py-0.5 text-ods-small font-semibold', BADGE[b.tone ?? 'neutral'])}>
              {b.tone === 'success' ? <Icon icon={BadgeCheck} size="xs" /> : null}
              {b.label}
            </li>
          ))}
        </ul>
      ) : null}
      {extra}
      {facts ? <dl className="m-0 flex flex-col gap-1">{facts}</dl> : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1.5">{actions(titleId)}</div>
    </article>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-ods-small">
      <dt className="text-ods-slate">{label}</dt>
      <dd className="m-0 text-end font-semibold text-ods-navy">{children}</dd>
    </div>
  );
}

function Act({ action, label, icon, variant, describedBy }: { action?: ProductCardAction; label: string; icon: LucideIcon; variant: ButtonVariant; describedBy: string }) {
  if (!action) return null;
  const blocked = Boolean(action.disabledReason);
  return (
    <Button
      variant={variant}
      iconStart={icon}
      href={blocked ? undefined : action.href}
      onClick={action.onClick}
      disabled={blocked}
      disabledReason={action.disabledReason}
      loading={action.loading}
      loadingText={action.loadingText}
      aria-describedby={describedBy}
    >
      {action.label ?? label}
    </Button>
  );
}

const units = (n: number, one: string, many?: string) => `${formatNumber(n)} ${n === 1 ? one : (many ?? `${one}s`)}`;

/* ───────── Sourcing ───────── */

export type SourcingCardProps = ProductCardBaseProps & {
  /** Lowest unit price; null = no price listed → "Price on request" (never 0). */
  fromPrice: number | null;
  /** "unit", "set", "pair" … */
  unit?: string;
  unitPlural?: string;
  moq: number;
  /** e.g. "15–20 days". */
  delivery: string;
  quoteAction?: ProductCardAction;
  /** Below MOQ: pass `disabledReason: "Minimum order is 500 sets."`. */
  cartAction?: ProductCardAction;
};

/** SourcingCard: from price, minimum order, delivery; Request quote (primary) + Add to cart. Phones: buttons wrap. */
export function SourcingCard({ fromPrice, unit = 'unit', unitPlural, moq, delivery, quoteAction, cartAction, ...base }: SourcingCardProps) {
  return (
    <Frame
      {...base}
      service="sourcing"
      facts={
        <>
          <Fact label="From">{fromPrice == null ? 'Price on request' : <Money amount={fromPrice} suffix={`/ ${unit}`} />}</Fact>
          <Fact label="Minimum order">{units(moq, unit, unitPlural)}</Fact>
          <Fact label="Delivery">{delivery}</Fact>
        </>
      }
      actions={(id) => (
        <>
          <Act action={quoteAction} label="Request quote" icon={Send} variant="primary" describedBy={id} />
          <Act action={cartAction} label="Add to cart" icon={Plus} variant="secondary" describedBy={id} />
        </>
      )}
    />
  );
}

/* ───────── MOQ pool ───────── */

export type PoolCardProps = ProductCardBaseProps & {
  poolPrice: number;
  /** Normal (non-pool) price; missing/null = no strike-through and no "Save n%". */
  normalPrice?: number | null;
  unit?: string;
  unitPlural?: string;
  /** Units committed so far, and the pool target. */
  filled: number;
  target: number;
  /** e.g. "5 days". */
  closesIn: string;
  /** Smallest quantity a buyer can join with. */
  joinFrom: number;
  /** Appendix C pool status: Open, Closing soon, Almost full, Filled, Closed (not filled). */
  status?: string;
  /** Closed / full: pass `disabledReason: "This pool is full."`. */
  joinAction?: ProductCardAction;
};

/**
 * PoolCard: pool vs normal price (+ "Save n%"), progress bar (role=progressbar, value text "640 of 1,000 units"),
 * closes in, join from; Join pool. Phones: same, full card width.
 */
export function PoolCard({ poolPrice, normalPrice, unit = 'unit', unitPlural, filled, target, closesIn, joinFrom, status, joinAction, badges, ...base }: PoolCardProps) {
  const pct = target > 0 ? Math.min(100, Math.round((filled / target) * 100)) : 0;
  const save = normalPrice != null && normalPrice > poolPrice && normalPrice > 0 ? Math.round((1 - poolPrice / normalPrice) * 100) : 0;
  const progressText = `${formatNumber(filled)} of ${units(target, unit, unitPlural)}`;
  return (
    <Frame
      {...base}
      service="pools"
      badges={[...(save ? [{ label: `Save ${save}%`, tone: 'info' as const }] : []), ...(badges ?? [])]}
      extra={
        <>
          {status ? <StatusPill status={status} className="self-start" /> : null}
          <div className="flex items-baseline justify-between gap-3 text-ods-small">
            <span className="text-ods-slate">Pool price</span>
            <span className="text-end font-semibold text-ods-navy">
              <Money amount={poolPrice} />
              {normalPrice != null && normalPrice > poolPrice ? (
                <>
                  {' '}
                  <span className="font-normal text-ods-slate">
                    <span className="sr-only">, normal price </span>
                    <s>
                      <Money amount={normalPrice} />
                    </s>
                  </span>
                </>
              ) : null}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Pool filled"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={Math.min(filled, target)}
            aria-valuetext={progressText}
            className="h-2 w-full overflow-hidden rounded-full bg-ods-line"
          >
            <span className="block h-full rounded-full bg-ods-success" style={{ width: `${pct}%` }} />
          </div>
          <p className="m-0 text-ods-small text-ods-slate">
            {progressText} · {closesIn === 'closed' ? 'closed' : `closes in ${closesIn}`}
          </p>
        </>
      }
      facts={<Fact label="Join from">{units(joinFrom, unit, unitPlural)}</Fact>}
      actions={(id) => <Act action={joinAction} label="Join pool" icon={Users} variant="primary" describedBy={id} />}
    />
  );
}

/* ───────── Dropshipping ───────── */

export type DropshipCardProps = ProductCardBaseProps & {
  /** Dropship access approved. Without it no price or landed cost is shown, only Request access. */
  hasAccess: boolean;
  yourPrice?: number;
  landedCost?: number;
  /** Country for the landed cost line, e.g. "UAE". */
  landedIn?: string;
  unit?: string;
  importAction?: ProductCardAction;
  accessAction?: ProductCardAction;
};

/** DropshipCard: your price, no minimum, landed cost; Add to import list. Without access: no prices, Request access. */
export function DropshipCard({ hasAccess, yourPrice, landedCost, landedIn, unit = 'unit', importAction, accessAction, ...base }: DropshipCardProps) {
  return (
    <Frame
      {...base}
      service="dropship"
      facts={
        hasAccess ? (
          <>
            {yourPrice !== undefined ? (
              <Fact label="Your price">
                <Money amount={yourPrice} suffix={`/ ${unit}`} />
              </Fact>
            ) : null}
            <Fact label="Minimum order">None, 1 {unit}</Fact>
            {landedCost !== undefined ? (
              <Fact label={landedIn ? `Landed in ${landedIn}` : 'Landed cost'}>
                <Money amount={landedCost} />
              </Fact>
            ) : null}
          </>
        ) : (
          <>
            <Fact label="Minimum order">None, 1 {unit}</Fact>
            <Fact label="Your price">After access is approved</Fact>
          </>
        )
      }
      actions={(id) =>
        hasAccess ? (
          <Act action={importAction} label="Add to import list" icon={ListPlus} variant="primary" describedBy={id} />
        ) : (
          <Act action={accessAction} label="Request access" icon={KeyRound} variant="secondary" describedBy={id} />
        )
      }
    />
  );
}

/* ───────── Warehouse (3PL) ───────── */

export type ServiceRate = { label: string; amount: number; /** e.g. "per order" */ per: string };
export type ServiceCardProps = ProductCardBaseProps & {
  description?: string;
  /** Empty or missing = "Rates not set yet" (confirmed in the quote). */
  rates?: ServiceRate[];
  quoteAction?: ProductCardAction;
};

/** ServiceCard (Warehouse/3PL service): short description, rates or "Rates not set yet"; Get a quote. */
export function ServiceCard({ description, rates, quoteAction, ...base }: ServiceCardProps) {
  return (
    <Frame
      {...base}
      service="3pl"
      extra={description ? <p className="m-0 text-ods-small text-ods-slate">{description}</p> : null}
      facts={
        rates?.length ? (
          rates.map((r) => (
            <Fact key={r.label} label={r.label}>
              <Money amount={r.amount} suffix={r.per} />
            </Fact>
          ))
        ) : (
          <Fact label="Rates">Rates not set yet</Fact>
        )
      }
      actions={(id) => <Act action={quoteAction} label="Get a quote" icon={MessageSquareQuote} variant="primary" describedBy={id} />}
    />
  );
}

/* ───────── Turnkey ───────── */

export type TurnkeyCardProps = ProductCardBaseProps & {
  /** null = no starting budget listed → "Budget in your quote". */
  fromPrice: number | null;
  /** e.g. "8–10 weeks". Missing = row hidden. */
  timeline?: string;
  /** What the project includes, e.g. ["Samples", "QC", "Packaging", "Shipping"]. */
  includes: string[];
  viewAction?: ProductCardAction;
};

/** TurnkeyCard: from price, timeline, includes; View project. */
export function TurnkeyCard({ fromPrice, timeline, includes, viewAction, ...base }: TurnkeyCardProps) {
  return (
    <Frame
      {...base}
      service="turnkey"
      facts={
        <>
          <Fact label="From">{fromPrice == null ? 'Budget in your quote' : <Money amount={fromPrice} />}</Fact>
          {timeline ? <Fact label="Timeline">{timeline}</Fact> : null}
          {includes.length ? <Fact label="Includes">{includes.join(', ')}</Fact> : null}
        </>
      }
      actions={(id) => <Act action={viewAction} label="View project" icon={Eye} variant="secondary" describedBy={id} />}
    />
  );
}

/* ───────── Make My Brand ───────── */

export type BrandCardProps = ProductCardBaseProps & {
  /** null = "In your quote". */
  fromPrice: number | null;
  unit?: string;
  unitPlural?: string;
  /** null = "In your quote". */
  moq: number | null;
  /** e.g. "3 days". Missing = row hidden. */
  proofTime?: string;
  brandAction?: ProductCardAction;
};

/** BrandCard: from price, minimum order, proof time; Brand it. */
export function BrandCard({ fromPrice, unit = 'unit', unitPlural, moq, proofTime, brandAction, ...base }: BrandCardProps) {
  return (
    <Frame
      {...base}
      service="brand"
      facts={
        <>
          <Fact label="From">{fromPrice == null ? 'In your quote' : <Money amount={fromPrice} suffix={`/ ${unit}`} />}</Fact>
          <Fact label="Minimum order">{moq == null ? 'In your quote' : units(moq, unit, unitPlural)}</Fact>
          {proofTime ? <Fact label="Proof in">{proofTime}</Fact> : null}
        </>
      }
      actions={(id) => <Act action={brandAction} label="Brand it" icon={Sparkles} variant="primary" describedBy={id} />}
    />
  );
}

/** Loading card with the same shape as the product cards (one "Loading" status unless `silent`). */
export function ProductCardSkeleton({ className, silent }: { className?: string; silent?: boolean }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-surface p-[calc(var(--ods-pad-card)-4px)]', className)}>
      <Skeleton silent className={cx(IMG_H, 'w-full')} />
      <Skeleton silent className="h-3 w-2/5" />
      <Skeleton silent className="h-4 w-4/5" />
      <Skeleton silent lines={3} />
      <Skeleton silent={silent} label="Loading product" className="h-ods-control w-1/2" />
    </div>
  );
}
