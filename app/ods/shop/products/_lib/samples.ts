/**
 * Samples (owner decision 4, T5a): like today's product page, EVERY product can order a sample while the sample service
 * is on, unless the product is explicitly tagged `no-samples`. (T4 required a `samples` tag; that rule is gone.)
 * Pure; unit-tested in tests/unit/ods-shop-price.test.ts.
 */
export const NO_SAMPLES_TAG = 'no-samples';

export function samplesAvailableFor(tagSlugs: readonly string[], sampleServiceOn: boolean): boolean {
  return sampleServiceOn && !tagSlugs.includes(NO_SAMPLES_TAG);
}
