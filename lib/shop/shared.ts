import { mapDbError } from '@/lib/format';

/** CH-1: plain-language messages for the shop RPCs (they name the field and say how to fix it — UI rule 8). Client-safe. */
export function shopError(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? '';
  const code = m.split(':')[0].trim();
  const rest = m.slice(m.indexOf(':') + 1).trim();
  switch (code) {
    case 'BELOW_MOQ': {
      const [moq, title] = rest.split('|').map((x) => x.trim());
      const n = Number(moq).toLocaleString('en-US');
      return title ? `Quantity is below the minimum order for ${title}. Enter at least ${n}.` : `Quantity is below the minimum order. Enter at least ${n}.`;
    }
    case 'SHIP_TO_REQUIRED': return 'Ship to: choose the country we should ship to.';
    case 'ROLE_NOT_ALLOWED': return 'Your role in this company can browse but not send requests. Ask your company owner to make you a buyer.';
    case 'QUOTE_LIST_EMPTY': return 'Your quote list is empty. Add products first.';
    case 'QUOTE_LIST_FULL': return 'Your quote list holds up to 50 products. Send it, or remove some first.';
    case 'PRODUCT_UNAVAILABLE': return `${rest} is no longer available. Remove it from the list and send again.`;
    case 'INVALID_QUANTITY': return 'Quantity: enter a whole number above 0.';
    case 'NOT_FOUND': return 'This product is no longer available.';
    case 'NOT_SIGNED_IN': return 'Please sign in again.';
    case 'INVALID_INPUT': return `Please check the form: ${rest}.`;
    default: return mapDbError(e);
  }
}

/** Who may act in the Shop (CH-1): owner + buyer; viewer browses. Mirrors shop_member_can() in the database. */
export type ShopRole = 'owner' | 'buyer' | 'viewer' | null;
export const shopCan = (role: ShopRole) => role === 'owner' || role === 'buyer';
export const ROLE_REASON = 'Your role can browse but not send requests. Ask your company owner to make you a buyer.';
