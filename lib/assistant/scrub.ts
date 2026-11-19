/**
 * Last-line filter on Octo's customer replies (19 Nov 2026 decisions 1 + 3). The prompt and the tool outputs already
 * leave supplier codes and carrier names out; this catches a model that guesses or repeats one from its own knowledge.
 *  · supplier codes (OCT-1234) → "the factory"
 *  · a carrier name other than the one the customer may see → the customer carrier label
 * Pure — unit tested.
 */
const SUPPLIER_CODE = /\bOCT-\d{3,}\b/g;
// acronyms match case-sensitively (so "ups" in "pick-ups" is left alone); names case-insensitively
const CARRIER_ACRONYMS = ['DHL', 'UPS', 'EMS', 'TNT', '4PX', 'USPS'];
const CARRIER_NAMES = ['YunExpress', 'Yun Express', 'FedEx', 'Cainiao', 'SF Express', 'Aramex', 'China Post', 'Yanwen'];

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrubCustomerReply(reply: string, carrierLabel: string): string {
  let out = reply.replace(SUPPLIER_CODE, 'the factory');
  const allowed = carrierLabel.toLowerCase();
  const swap = (re: RegExp, name: string) => {
    if (allowed.includes(name.toLowerCase())) return;
    out = out.replace(re, carrierLabel);
  };
  for (const a of CARRIER_ACRONYMS) swap(new RegExp(`\\b${escRe(a)}\\b`, 'g'), a);
  for (const n of CARRIER_NAMES) swap(new RegExp(`\\b${escRe(n)}\\b`, 'gi'), n);
  return out;
}
