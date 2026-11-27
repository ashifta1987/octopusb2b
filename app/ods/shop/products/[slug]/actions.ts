'use server';

import { loadSimilarCards } from '../_lib/data';
import type { SourcingCardModel } from '../../_lib/cards';

/**
 * Similar products for the product page tab (loaded only when the tab is first opened). Read-only: public cached
 * catalogue (getRecommendations) mapped with toSourcingCard — customer-safe fields only.
 */
export async function loadSimilarProducts(productId: string, categoryId: string | null): Promise<{ items: SourcingCardModel[] } | { error: string }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(productId) || (categoryId != null && !uuid.test(categoryId))) return { error: 'Not found' };
  try {
    return await loadSimilarCards(productId, categoryId);
  } catch {
    return { error: 'Could not load similar products.' };
  }
}
