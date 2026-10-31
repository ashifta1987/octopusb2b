-- services is keyed by `code` (no id column) — restore_records/recovery_compare work on id-keyed tables only.
create or replace function restorable_tables() returns text[] language sql immutable as $$
  select array['products','price_tiers','product_specs','product_media','categories','tags','suppliers','certificates',
               'organizations','addresses','kyc_submissions','kyc_documents','pages','branches','banners','terms_versions',
               'tickets','ticket_messages','support_macros','rfqs','ad_campaigns','api_clients','webhook_endpoints']::text[];
$$;
