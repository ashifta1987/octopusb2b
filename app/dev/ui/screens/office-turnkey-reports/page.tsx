import type { Metadata } from 'next';
import { adminFixture } from '../_office-turnkey-admin-fixture';

export const metadata: Metadata = { title: 'Turnkey reports · ODS screens (staging)', robots: { index: false, follow: false } };

/** Staging-only fixture (T9): /admin/turnkey/reports in the real Back Office frame, SAMPLE data. ?state=… */
export default adminFixture('reports');
