import { safeCustomerNext, CUSTOMER_HOME } from '@/lib/safe-next';
/** ADDON-44-F (audit 17): /signup?service=… opens that My account section after sign-up and the company profile. */
export const SERVICE_TARGET: Record<string, string> = {
  sourcing: '/account/sourcing', dropship: '/account/dropship', '3pl': '/account/warehouse', warehouse: '/account/warehouse', brand: '/account/brand',
};
/** Only My account / Shop paths survive (no open redirects). CH-1: the default is the Shop (main page after login). */
export const safeAccountNext = (v: unknown, home: string = CUSTOMER_HOME) => safeCustomerNext(v, home);
/** /onboarding, carrying where to go afterwards when it is not the default (`home`: the Shop, or /account while the Shop is off). */
export const onboardingHref = (next: string, home: string = CUSTOMER_HOME) => (safeAccountNext(next, home) === home ? '/onboarding' : `/onboarding?next=${encodeURIComponent(safeAccountNext(next, home))}`);
