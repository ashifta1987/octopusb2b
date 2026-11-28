import type { ReactNode } from 'react';

/**
 * ODS T8 · Warehouse floor screen — Scale check — stays COMFORTABLE inside the compact Back Office frame (audit C13: 44 px controls for scanners,
 * handhelds and phones). The ODS tokens re-read the density on this wrapper (tokens.css nested density panels).
 */
export default function OdsScaleFloorLayout({ children }: { children: ReactNode }) {
  return (
    <div data-density="comfortable" data-testid="ods-comfortable-area">
      {children}
    </div>
  );
}
