/** Shared constants for the customer API & integrations page (safe for server and client). */
// Single source of truth: the public API contracts (SPEC §7, §15).
import { API_SCOPES, WEBHOOK_EVENTS } from '@/lib/contracts';
export { API_SCOPES, WEBHOOK_EVENTS };
export type ApiScope = (typeof API_SCOPES)[number];
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const DEFAULT_SCOPES: ApiScope[] = ['catalog:read', 'orders:read', 'shipments:read'];

export function apiBaseUrl() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://api.octopusb2b.com').replace(/\/+$/, '');
  return `${site}/api/v1`;
}
