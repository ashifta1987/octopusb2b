'use client';
import { usePathname } from 'next/navigation';
import { AppLogo, type AppLogoVariant } from './app-logo';

/**
 * Brand pass 27 Nov — the shell logo follows the area the person is in (the shells are shared layouts, so the
 * area is read from the path): Turnkey → Octopus Turnkey, MOQ pools → Octopus MOQ Pool, 3PL warehouse → Octopus 3PL,
 * everything else → Octopus B2B. Same link target and accessible name as <AppLogo />; only the picture changes.
 */
const AREAS: [RegExp, AppLogoVariant][] = [
  [/^\/(account|admin|office)\/turnkey(\/|$)/, 'turnkey'],
  [/^\/(account|admin)\/pools(\/|$)/, 'moq'],
  [/^\/(account|office)\/warehouse(\/|$)/, '3pl'],
];

export function areaLogo(path: string | null): AppLogoVariant {
  return AREAS.find(([re]) => re.test(path ?? ''))?.[1] ?? 'b2b';
}

export function AreaLogo(props: Omit<React.ComponentProps<typeof AppLogo>, 'variant'>) {
  const path = usePathname();
  return <AppLogo {...props} variant={areaLogo(path)} />;
}
