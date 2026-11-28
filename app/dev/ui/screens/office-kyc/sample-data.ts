/**
 * SAMPLE data for the KYC / Service requests / Assistant queue fixtures (ODS T9 batch 2). Invented for design review only;
 * staging fixtures only, never imported by real pages.
 */
import type { KycQueueRow, SupplierQueueRow, KycDocVM, KycHistoryRow } from '@/app/ods/office/kyc/_lib/kyc-core';
import { submissionCompanyStatus } from '@/app/ods/office/kyc/_lib/kyc-core';

export const SAMPLE_NOW = '2026-11-27T12:00:00Z';

const K: [string, string, string, string | null, string, string, number, string | null][] = [
  ['Pacific Pets Co.', 'Sydney, Australia', 'ACN 612 448 901', null, 'submitted', '2026-11-26T09:10:00Z', 3, null],
  ['Casa Verde SA', 'Madrid, Spain', 'B-87654321', null, 'in_review', '2026-11-22T14:30:00Z', 4, 'Omar Khalid'],
  ['Maison Lumière SARL', 'Lyon, France', 'SIREN 812 345 678', null, 'more_info', '2026-11-18T08:00:00Z', 2, 'Lena Fischer'],
  ['Baltic Craft OÜ', 'Tallinn, Estonia', '16234567', null, 'submitted', '2026-11-27T07:45:00Z', 0, null],
  ['Desert Bloom Retail', 'Riyadh, Saudi Arabia', 'CR 1010654321', 'Desert Bloom Trading', 'in_review', '2026-11-20T11:00:00Z', 5, 'Omar Khalid'],
];

export const SAMPLE_KYC_ROWS: KycQueueRow[] = K.map(([company, place, reg, account, status, at, docs, reviewer], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  company,
  account: account ?? company,
  place,
  registrationNo: reg,
  status,
  companyStatus: submissionCompanyStatus(status),
  submittedAt: at,
  reviewedAt: null,
  documents: docs,
  assignee: reviewer,
}));

export const SAMPLE_SUPPLIER_ROWS: SupplierQueueRow[] = [
  { id: '10000000-0000-4000-8000-000000000001', reference: 'SUP-0142', company: 'Ningbo Brightway Housewares', email: 'sales@brightway.example', place: 'Ningbo, Zhejiang', categories: ['Kitchenware', 'Storage'], status: 'submitted', createdAt: '2026-11-25T03:00:00Z', firstApproved: false },
  { id: '10000000-0000-4000-8000-000000000002', reference: 'SUP-0139', company: 'Shenzhen Lumen Lighting', email: 'export@lumen.example', place: 'Shenzhen, Guangdong', categories: ['Lighting'], status: 'in_review', createdAt: '2026-11-21T06:00:00Z', firstApproved: true },
  { id: '10000000-0000-4000-8000-000000000003', reference: 'SUP-0131', company: 'Yiwu Happy Pets Trading', email: null, place: 'Yiwu, Zhejiang', categories: ['Pet supplies'], status: 'approved', createdAt: '2026-11-10T02:00:00Z', firstApproved: true },
];

export const SAMPLE_COMPANY: [string, string | null][] = [
  ['Legal name', 'Casa Verde SA'], ['Registration no.', 'B-87654321'], ['Address', 'Calle de Alcalá 120, 28009 Madrid'], ['Website', 'casaverde.example'],
  ['Contact', 'Lucía Romero'], ['Phone', '+34 600 000 000'], ['Email', 'lucia@casaverde.example'], ['Account name', 'Casa Verde SA'],
];

/** Sample signed-URL shape (60-second token), never a public object URL. */
const signed = (name: string) => `https://sample.supabase.co/storage/v1/object/sign/kyc/sample/${name}?token=sample-token-60s`;
export const SAMPLE_DOCS = (unlocked: boolean): KycDocVM[] => [
  { id: 'd1', type: 'certificate_of_incorporation', fileName: 'incorporation.pdf', uploadedAt: '2026-11-22T14:20:00Z', url: unlocked ? signed('incorporation.pdf') : null },
  { id: 'd2', type: 'tax_registration', fileName: 'cif-certificate.pdf', uploadedAt: '2026-11-22T14:22:00Z', url: unlocked ? signed('cif-certificate.pdf') : null },
  { id: 'd3', type: 'director_id', fileName: 'director-passport.jpg', uploadedAt: '2026-11-22T14:25:00Z', url: unlocked ? signed('director-passport.jpg') : null },
  { id: 'd4', type: 'proof_of_address', fileName: 'utility-bill.pdf', uploadedAt: '2026-11-22T14:26:00Z', url: unlocked ? null : null },
];

export const SAMPLE_HISTORY: KycHistoryRow[] = [
  { from_status: null, to_status: 'submitted', reason: null, created_at: '2026-11-22T14:30:00Z' },
  { from_status: 'submitted', to_status: 'in_review', reason: null, created_at: '2026-11-23T09:05:00Z', actor: 'Omar Khalid' },
];
export const SAMPLE_HISTORY_MORE_INFO: KycHistoryRow[] = [
  ...SAMPLE_HISTORY,
  { from_status: 'in_review', to_status: 'more_info', reason: 'Proof of address is older than 3 months.', created_at: '2026-11-24T10:15:00Z', actor: 'Omar Khalid' },
];

export const KYC_FIXTURE_STATES = [
  ['queue', 'Queue'],
  ['suppliers', 'Supplier applications'],
  ['review', 'Review'],
  ['more-info', 'More info requested'],
  ['locked', 'Documents locked (2-step code)'],
  ['view-only', 'View only'],
  ['verified', 'Verified (closed)'],
  ['supplier', 'Supplier application'],
  ['supplier-second', 'Supplier · second approver'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Error'],
] as const;
export type KycFixtureState = (typeof KYC_FIXTURE_STATES)[number][0];
