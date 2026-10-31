-- SPEC §15.1 — storefront copy follows the platform currency.
-- Storefront CMS texts that hard-coded "USD" now use the `{currency}` variable; the storefront substitutes the active
-- platform currency (components/store/currency.ts → withCurrency). Only these storefront keys are touched.
update content_blocks
   set value = replace(value, 'USD', '{currency}')
 where key in ('home.subtitle', 'home.how.2', 'home.3pl.points', 'product.services.subtitle',
               'product.recommended.subtitle', 'request.subtitle', 'request.next.3')
   and value like '%USD%';
