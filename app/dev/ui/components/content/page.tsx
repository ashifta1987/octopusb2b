import { Sections } from './sections';

export const metadata = { title: 'Content and data · ODS components (staging)', robots: { index: false, follow: false } };

export default function ContentComponentsPage() {
  return (
    <>
      <h1>Content and data</h1>
      <p className="mt-2 max-w-[820px] text-ods-body text-ods-slate">
        Buttons, cards and panels, Shop service sections, product cards, KPI figures, tables, status pills, money, timelines, and the empty, error and
        loading states. Every block shows the comfortable (customer) and compact (staff) density.
      </p>
      <Sections />
    </>
  );
}
