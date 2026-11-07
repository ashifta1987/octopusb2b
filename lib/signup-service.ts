/** ADDON-44-F (audit 17): /signup?service=… opens that My account section after sign-up and the company profile. */
export const SERVICE_TARGET: Record<string, string> = {
  sourcing: '/account/sourcing', dropship: '/account/dropship', '3pl': '/account/warehouse', warehouse: '/account/warehouse', brand: '/account/brand',
};
/** Only My account paths survive (no open redirects). */
export const safeAccountNext = (v: unknown) => (typeof v === 'string' && /^\/account(\/[\w-]+)*(\?[\w=&%-]*)?$/.test(v) ? v : '/account');
/** /onboarding, carrying where to go afterwards when it is not the account home. */
export const onboardingHref = (next: string) => (safeAccountNext(next) === '/account' ? '/onboarding' : `/onboarding?next=${encodeURIComponent(safeAccountNext(next))}`);
