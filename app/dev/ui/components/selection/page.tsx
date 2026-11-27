import { Sections } from './sections';

export const metadata = { title: 'Tabs and selection · ODS components (staging)', robots: { index: false, follow: false } };

export default function SelectionComponentsPage() {
  return (
    <>
      <h1>Tabs and selection</h1>
      <p className="mt-2 max-w-[820px] text-ods-body text-ods-slate">
        One style per job, never per service (Part 2.5): underline tabs for parts of one record, filter pills for lists, a segmented control
        for 2–3 views, card tabs for numbers that filter, a stepper for progress and the shop jump bar. Each is shown in both densities.
      </p>
      <Sections />
    </>
  );
}
