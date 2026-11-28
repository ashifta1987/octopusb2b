/** SAMPLE service requests + assistant queue data (ODS T9 batch 2 fixtures). Invented for design review only. */
import type { ServiceRow } from '@/app/ods/office/services/_lib/services-core';
import { detailsList, detailsSummary } from '@/app/ods/office/services/_lib/services-core';

export const SERVICES_FIXTURE_STATES = [
  ['open', 'Open'],
  ['drawer', 'Request drawer'],
  ['view-only', 'View only'],
  ['done', 'Done'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Error'],
] as const;
export type ServicesFixtureState = (typeof SERVICES_FIXTURE_STATES)[number][0];

export const SAMPLE_SERVICE_TYPES = [
  { code: 'samples', name: 'Samples' }, { code: 'qc', name: 'Quality check' }, { code: 'cert', name: 'Certification' },
  { code: '3pl', name: '3PL storage' }, { code: 'sourcing', name: 'Sourcing' },
];

const R: [string, string, string, string, string | null, Record<string, unknown>, number, string | null, string, string, string | null][] = [
  ['SRV-0412', 'qc', 'Anna Home Trading', 'Dubai, AE', 'Bamboo cutting board set', { inspection_level: 'AQL 2.5', units: 1200, factory_city: 'Ningbo' }, 18000, 'wallet', 'paid', '2026-11-24T08:00:00Z', 'Omar Khalid'],
  ['SRV-0415', 'samples', 'Nordic Living AB', 'Stockholm, SE', 'Linen cushion cover', { colours: 'Sand, Moss', quantity: 3, ship_to: 'Stockholm' }, 4500, 'invoice', 'requested', '2026-11-25T10:00:00Z', null],
  ['SRV-0409', 'cert', 'Casa Verde SA', 'Madrid, ES', 'LED desk lamp', { standard: 'CE + RoHS', lab: 'Any accredited' }, 65000, 'wallet', 'in_progress', '2026-11-20T09:30:00Z', 'Lena Fischer'],
  ['SRV-0401', 'sourcing', 'Desert Bloom Retail', 'Riyadh, SA', null, { brief: 'Ceramic planters, 3 sizes', target_price: 'US$ 4–7' }, 0, null, 'accepted', '2026-11-18T12:00:00Z', 'Omar Khalid'],
  ['SRV-0398', 'qc', 'Pacific Pets Co.', 'Sydney, AU', 'Pet bed (medium)', { inspection_level: 'AQL 1.5', units: 800 }, 18000, 'wallet', 'report_ready', '2026-11-15T07:00:00Z', 'Lena Fischer'],
];

export const SAMPLE_SERVICE_ROWS: ServiceRow[] = R.map(([code, sc, customer, place, product, details, fee, paidVia, status, created, owner], i) => ({
  id: `20000000-0000-4000-8000-00000000000${i + 1}`,
  code, serviceCode: sc, type: SAMPLE_SERVICE_TYPES.find((t) => t.code === sc)?.name ?? sc, customer, place, product,
  summary: detailsSummary(details), details: detailsList(details), feeMinor: fee, currency: 'USD', paidVia, status, createdAt: created, updatedAt: created, owner,
}));

export const SAMPLE_SERVICE_DONE: ServiceRow[] = [
  { ...SAMPLE_SERVICE_ROWS[0], id: '20000000-0000-4000-8000-000000000011', code: 'SRV-0377', status: 'completed', createdAt: '2026-10-30T08:00:00Z' },
];

export const ASSISTANT_FIXTURE_STATES = [
  ['queue', 'Waiting for a human'],
  ['mine', 'My customers'],
  ['low', 'Octo unsure'],
  ['conversation', 'Conversation'],
  ['view-only', 'Conversation · view only'],
  ['out-of-office', 'Out of office'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Error'],
] as const;
export type AssistantFixtureState = (typeof ASSISTANT_FIXTURE_STATES)[number][0];
