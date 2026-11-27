import { Sections } from './sections';

export const metadata = { title: 'Grid, workspace, palette · ODS components (staging)', robots: { index: false, follow: false } };

export default function DataComponentsPage() {
  return (
    <>
      <h1>Grid, workspace and command palette</h1>
      <p className="mt-2 max-w-[820px] text-ods-body text-ods-slate">
        Back Office building blocks (Part 7.1–7.2): OctopusDataGrid, ContextMenu, Workspace tabs, the command palette (Ctrl K or ⌘K anywhere on
        this page) and the keyboard shortcuts list. Staff tools are compact; each demo also shows the comfortable copy.
      </p>
      <Sections />
    </>
  );
}
