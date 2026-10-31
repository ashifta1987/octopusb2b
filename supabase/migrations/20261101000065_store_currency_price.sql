-- SPEC §15.1 — storefront catalogue in the platform currency.
-- Price tiers / products keep the currency they were entered in (often CNY for 1688 suppliers). The storefront
-- converts to the platform currency at the approved rate for display. To make price FILTERS and price SORTING
-- correct across mixed-currency catalogues, expose a PostgREST computed column on products:
--   products.min_price_platform  = convert_amount(min_price_cents, currency, current_platform_currency())
-- It mirrors lib/format.ts convertMinor() (same rate + rounding step), so the filter bounds the buyer types in the
-- platform currency match the converted prices shown on the cards.

create or replace function public.min_price_platform(p public.products) returns bigint
language sql stable set search_path = public as $$
  select convert_amount(p.min_price_cents::bigint, p.currency::text, current_platform_currency());
$$;
comment on function public.min_price_platform(public.products) is 'Computed column: product min price converted to the platform currency (SPEC §15.1)';
grant execute on function public.min_price_platform(public.products) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
