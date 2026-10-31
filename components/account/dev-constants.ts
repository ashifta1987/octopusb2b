/** Shared constants for the customer API & integrations page (safe for server and client). */
export const API_SCOPES = [
  'products:read',
  'inventory:read',
  'orders:read',
  'orders:write',
  'rfqs:write',
  'shipments:read',
  'service_requests:write',
  'webhooks:manage',
  'wallet:read',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const WEBHOOK_EVENTS = ['order.updated', 'shipment.tracking', 'quote.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const DEFAULT_SCOPES: ApiScope[] = ['products:read', 'inventory:read', 'orders:read', 'shipments:read'];

export function apiBaseUrl() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://api.octopusb2b.com').replace(/\/+$/, '');
  return `${site}/api/v1`;
}
