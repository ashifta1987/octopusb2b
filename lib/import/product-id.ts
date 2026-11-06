/** Client-safe Product Id helpers (ADDON-29) — no exceljs import, so the admin page can use them in the browser. */
/** "CN-GD-BWJ-0010" → "CN-GD-BWJ"; model "F8制冷手持风扇" → "F8". Used by the "Generate Product Ids" helper. */
export function suggestProductId(supplierExternalId: string | null | undefined, factoryModel: string) {
  const prefix = (supplierExternalId ?? '').toUpperCase().split('-').slice(0, 3).join('-');
  const model = factoryModel.toUpperCase().replace(/[^\x20-\x7E]/g, ' ').trim().split(/\s+/)[0]?.replace(/[^A-Z0-9-]/g, '') ?? '';
  return prefix && model ? `${prefix}-${model}` : '';
}
