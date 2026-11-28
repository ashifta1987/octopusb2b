/** Shared helpers for the T9 batch 3 fixture pages (server). */
import type { SampleRole } from '../office-dashboard/sample-data';

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const ROLES: [SampleRole, string][] = [
  ['finance', 'Finance'],
  ['admin', 'Owner (admin)'],
  ['sales', 'Sales'],
];
export const pickRole = (v: string | string[] | undefined, fallback: SampleRole): SampleRole => (ROLES.find(([r]) => r === one(v))?.[0] ?? fallback);
export function fixtureLinks<S extends string>(base: string, states: readonly S[], state: S, role: SampleRole) {
  return [
    ...states.map((s) => ({ href: `${base}?state=${s}&role=${role}`, text: s, current: s === state })),
    ...ROLES.map(([r, label]) => ({ href: `${base}?state=${state}&role=${r}`, text: `as ${label}`, current: r === role })),
  ];
}
