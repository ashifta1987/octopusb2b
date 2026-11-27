'use client';

import type { ReactNode } from 'react';
import { buttonClass, cx, type ButtonVariant } from '@octopus/ui';
import { NamedTabLink } from '@octopus/ui/components/named-tab-link';
import { useSiteUser } from './site-session';

export const SIGN_IN_TO_SHOP = '/login?next=/shop';

/**
 * Every "Continue with Google" on the introduction site (Part 4.1): opens the Shop tab — `/login?next=/shop`,
 * `target="octopus-shop"` (no rel=noopener; phones open in the same tab). Signed in: "Go to my shop" → `/shop`.
 * `data-cta="google"` lets the e2e check every one of them.
 */
export function GoogleCta({
  variant = 'primary',
  testId,
  className,
  fullWidth,
  children = 'Continue with Google',
}: {
  variant?: ButtonVariant;
  testId?: string;
  className?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}) {
  const user = useSiteUser();
  return (
    <NamedTabLink
      tab="shop"
      href={user ? '/shop' : SIGN_IN_TO_SHOP}
      data-cta="google"
      data-testid={testId}
      className={cx(buttonClass(variant, 'md', fullWidth), className)}
    >
      {user ? 'Go to my shop' : children}
    </NamedTabLink>
  );
}
