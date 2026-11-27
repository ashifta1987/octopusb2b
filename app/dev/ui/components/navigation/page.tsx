import { Sections } from './sections';

export const metadata = { title: 'Navigation · ODS components (staging)', robots: { index: false, follow: false } };

export default function NavigationComponentsPage() {
  return (
    <>
      <h1>Navigation</h1>
      <p className="mt-2 max-w-[820px] text-ods-slate">
        Headers, section bar, mega menu, sidebars, top bars, phone bottom bar, sheets and breadcrumbs for the introduction site, the Shop, My account and the
        Back Office. Every demo is shown in both densities and rendered in place (not sticky or fixed).
      </p>
      <Sections />
    </>
  );
}
