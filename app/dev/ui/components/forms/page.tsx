import { Sections } from './sections';

export const metadata = { title: 'Forms and overlays · ODS components (staging)', robots: { index: false, follow: false } };

export default function FormsComponentsPage() {
  return (
    <>
      <h1>Forms and overlays</h1>
      <p className="mt-2 max-w-[820px] text-ods-body text-ods-slate">
        Fields with the label above, hint and error below; inputs, selects, numbers, quantities, dates and files at 44 / 32 px; checkboxes, switches and
        radio cards; the drawer (Ctrl S saves, Esc closes with the unsaved-changes guard), the confirm modal (only for things that can&apos;t be undone),
        toasts and tooltips (Part 2.5). Each is shown in both densities.
      </p>
      <Sections />
    </>
  );
}
