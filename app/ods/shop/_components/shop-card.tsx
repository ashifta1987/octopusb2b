'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BrandCard, DropshipCard, PoolCard, ServiceCard, SourcingCard, TurnkeyCard } from '@octopus/ui';
import { addToQuoteList } from '@/app/shop/actions';
import { ROLE_REASON } from '@/lib/shop/shared';
import type { ShopCardModel } from '../_lib/cards';

export type ShopCardProps = {
  model: ShopCardModel;
  /** owner / buyer: Add to cart works; viewer: the button is disabled with the reason. */
  canAct?: boolean;
  /** Hide the service tag inside a ServiceSection (the section already names the service). Default false. */
  showService?: boolean;
  /** 3 (default) or 4 when the section heading is an h3. */
  headingLevel?: 3 | 4;
  /** Fixtures: no server action (Add to cart says what would happen). */
  demo?: boolean;
  className?: string;
};

/**
 * ODS T4 · renders one Shop card MODEL (app/ods/shop/_lib/cards.ts) with the matching @octopus/ui card. Shared by every
 * Shop page. Sourcing "Add to cart" = addToQuoteList (the cart's Get a quote part) until T5; the result is announced in a
 * polite live region under the card and the header count refreshes (router.refresh). All other buttons are links.
 */
export function ShopCard({ model: m, canAct = true, showService = false, headingLevel = 3, demo, className }: ShopCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = { title: m.title, href: m.href, image: m.image, badges: m.badges, showService, headingLevel, className: 'h-full', 'data-testid': `shop-card-${m.kind}` };

  let card: React.ReactNode;
  switch (m.kind) {
    case 'sourcing':
      card = (
        <SourcingCard
          {...base}
          fromPrice={m.fromPrice}
          unit={m.unit}
          unitPlural={m.unitPlural}
          moq={m.moq}
          delivery={m.delivery}
          quoteAction={{ href: m.quoteHref }}
          cartAction={{
            disabledReason: canAct ? undefined : ROLE_REASON,
            loading: pending,
            loadingText: 'Adding…',
            onClick: () =>
              start(async () => {
                if (demo) {
                  setMsg({ ok: true, text: 'Sample: this would add the product to your cart (quote list).' });
                  return;
                }
                const r = await addToQuoteList(m.productId);
                if (r.ok) {
                  setMsg({ ok: true, text: `Added to your cart (${r.count}).` });
                  router.refresh();
                } else setMsg({ ok: false, text: r.error });
              }),
          }}
        />
      );
      break;
    case 'pools':
      card = (
        <PoolCard
          {...base}
          poolPrice={m.poolPrice}
          normalPrice={m.normalPrice}
          unit={m.unit}
          unitPlural={m.unitPlural}
          filled={m.filled}
          target={m.target}
          closesIn={m.closesIn}
          joinFrom={m.joinFrom}
          status={m.status}
          joinAction={{ href: m.joinHref, disabledReason: m.joinBlockedReason }}
        />
      );
      break;
    case 'dropship':
      card = (
        <DropshipCard
          {...base}
          hasAccess={m.hasAccess}
          yourPrice={m.yourPrice}
          landedCost={m.landedCost}
          landedIn={m.landedIn}
          importAction={m.importHref ? { href: m.importHref } : undefined}
          accessAction={{ href: m.accessHref }}
        />
      );
      break;
    case '3pl':
      card = <ServiceCard {...base} description={m.description} rates={m.rates} quoteAction={{ href: m.quoteHref }} />;
      break;
    case 'turnkey':
      card = <TurnkeyCard {...base} fromPrice={m.fromPrice} timeline={m.timeline} includes={m.includes} viewAction={{ href: m.viewHref }} />;
      break;
    case 'brand':
      card = <BrandCard {...base} fromPrice={m.fromPrice} unit={m.unit} moq={m.moq} proofTime={m.proofTime} brandAction={{ href: m.brandHref }} />;
      break;
  }

  return (
    <div className={className ?? 'flex h-full min-w-0 flex-col gap-1'}>
      {card}
      {m.kind === 'sourcing' ? (
        <p role="status" aria-live="polite" className={msg ? `m-0 text-ods-small ${msg.ok ? 'text-ods-slate' : 'text-ods-danger'}` : 'sr-only'}>
          {msg?.text ?? ''}
        </p>
      ) : null}
    </div>
  );
}
