/**
 * The carrier name customers may see (decision 3, 19 Nov 2026). Customers never see the carrier list or carrier codes.
 * A shipment shows `shipping.carrier_public_label` (e.g. "YunExpress network") only once an admin has recorded that a test
 * shipment passed (`shipping.carrier_test_passed` = true); until then — or if the label is empty — "Octopus B2B shipping".
 * Used by customer shipment / tracking views, the customer API and the Octo assistant.
 */
export const DEFAULT_CUSTOMER_CARRIER = 'Octopus B2B shipping';

export const CARRIER_SETTING_KEYS = ['shipping.carrier_public_label', 'shipping.carrier_test_passed'] as const;

const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

/** From raw site_settings values (key → jsonb value). */
export function customerCarrierLabel(raw: Record<string, unknown> | null | undefined): string {
  const label = raw?.['shipping.carrier_public_label'];
  const passed = truthy(raw?.['shipping.carrier_test_passed']);
  const text = typeof label === 'string' ? label.trim() : '';
  return passed && text ? text : DEFAULT_CUSTOMER_CARRIER;
}
