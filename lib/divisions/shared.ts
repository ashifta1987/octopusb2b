// Divisions: values shared by server and client code (no server-only imports here).
export const DIVISION_COOKIE = 'octo_division';
export const COMPANY_WIDE_ROLES = ['admin', 'finance', 'support'] as const;
export const DIVISION_ROLES = ['manager', 'staff', 'warehouse', 'finance'] as const;
export const DIVISION_LOGOS = { 'octopus-b2b': '/brand/octopus-b2b-logo.png', 'octopus-dropship': '/brand/octopus-dropship-logo.png' } as const;

export type Division = { id: string; code: string; name: string; sort_order: number; logo_key: string; status: string };
export type DivisionScope = { all: true; division: null; options: Division[] } | { all: false; division: Division; options: Division[] };

/** Service / stream word → division code (same mapping as division_code_for_service() in the database). */
export function divisionCodeForService(service: string | null | undefined): string | null {
  switch ((service ?? '').toLowerCase()) {
    case 'rfq': case 'sample': case 'qc': case 'certification': case 'factory_audit': case 'sourcing': case 'rfq_fees': return 'SRC';
    case '3pl': case 'warehouse': return '3PL';
    case 'dropship': return 'DS';
    case 'brand': return 'MMB';
    case 'pool': case 'pools': return 'POOL';
    case 'turnkey': return 'TK';
    default: return null;
  }
}
