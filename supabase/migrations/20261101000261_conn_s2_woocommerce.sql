-- CONN S2 · WooCommerce connection (migration 261; after 260). No keys of ours needed: the merchant approves read_write on their OWN
-- store (WooCommerce /wc-auth/v1/authorize); WooCommerce posts the generated key pair to our callback, which stores it sealed
-- (store_credentials, C0) through the service role.
--   1. c2_connect_start (merchant, setup role): a single-use connection request (state) for the merchant's store: platform check,
--      another account's store refused (ALREADY_LINKED), plan store limit, at most 20 requests per hour per organisation. Only the
--      SHA-256 of the state is stored (store_oauth_states, C0); it expires after 30 minutes.
--   2. c2_connect_claim (service role): the key callback trades the state for the organisation + store, once.
--   3. c2_connection_set_webhooks (service role): the store's webhook ids, so a disconnect can remove them from the store.
-- Money: none. Audited with write_audit(). RLS unchanged (both tables already service-role / own-organisation only).

alter table public.store_oauth_states add column if not exists store_url text
  check (store_url is null or (store_url ~ '^https://[a-z0-9.-]+(/[^\s]*)?$' and length(store_url) <= 300));
alter table public.store_connections add column if not exists remote_webhook_ids text[]
  check (remote_webhook_ids is null or (cardinality(remote_webhook_ids) <= 10 and array_to_string(remote_webhook_ids, ',') ~ '^[0-9,]*$'));

create or replace function public.c2_connect_start(p_platform text, p_shop_domain text, p_store_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_domain text := lower(btrim(coalesce(p_shop_domain, '')));
  v_url text := btrim(coalesce(p_store_url, ''));
  v_plan jsonb;
  v_limit int;
  v_used int;
  v_token text;
begin
  perform ds_feature_guard('stores');
  v_org := ds_org_read();
  if v_org is null then raise exception 'NOT_FOUND: No company found for this account.'; end if;
  perform ds_assert_role(v_org, 'setup');
  if p_platform is distinct from 'woocommerce' then raise exception 'NOT_SUPPORTED: This platform does not connect this way yet.'; end if;
  if length(v_domain) < 4 or length(v_domain) > 253 or v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'INVALID_INPUT: Use your store''s domain name, like mystore.com.';
  end if;
  if length(v_url) > 300 or v_url !~ ('^https://' || replace(v_domain, '.', '\.') || '(/[^\s]*)?$') then raise exception 'INVALID_INPUT: The store address must start with https:// and your domain.'; end if;
  if exists (select 1 from public.store_connections c where c.platform = p_platform and c.shop_domain = v_domain and c.status <> 'disconnected' and c.org_id <> v_org) then
    raise exception 'ALREADY_LINKED: This store is already linked to another Octopus account.';
  end if;
  -- plan store limit (DS12), checked before the merchant leaves for the store; the activation trigger checks again
  if not exists (select 1 from public.store_connections c where c.org_id = v_org and c.platform = p_platform and c.shop_domain = v_domain and c.status = 'active') then
    v_plan := ds_plan_state(v_org);
    if coalesce((v_plan ->> 'limits_apply')::boolean, false) then
      v_limit := nullif(v_plan ->> 'stores_limit', '')::int;
      select count(*)::int into v_used from public.store_connections c where c.org_id = v_org and c.status = 'active';
      if v_limit is not null and v_used >= v_limit then
        raise exception 'PLAN_LIMIT: Your plan allows % connected store(s). Disconnect a store or change your plan.', v_limit;
      end if;
    end if;
  end if;
  if (select count(*) from public.store_oauth_states s where s.org_id = v_org and s.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMITED: Too many connection attempts. Try again in an hour.';
  end if;
  delete from public.store_oauth_states s where s.expires_at < now() - interval '1 day';
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.store_oauth_states (state_hash, org_id, platform, shop_domain, store_url, created_by, expires_at)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_org, p_platform, v_domain, v_url, auth.uid(), now() + interval '30 minutes');
  perform write_audit('store_connection.connect_started', 'organizations', v_org::text, jsonb_build_object('org_id', v_org, 'platform', p_platform, 'shop', v_domain));
  return jsonb_build_object('state', v_token, 'expires_in_s', 1800);
end $$;

create or replace function public.c2_connect_claim(p_platform text, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.store_oauth_states;
begin
  if coalesce(p_state, '') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_STATE: This connection request is unknown or expired. Start again from Integrations.'; end if;
  select * into s from public.store_oauth_states
   where state_hash = encode(sha256(convert_to(p_state, 'UTF8')), 'hex') and platform = p_platform for update;
  if s.id is null or s.used_at is not null or s.expires_at < now() then
    raise exception 'INVALID_STATE: This connection request is unknown or expired. Start again from Integrations.';
  end if;
  update public.store_oauth_states set used_at = now() where id = s.id;
  return jsonb_build_object('org_id', s.org_id, 'shop_domain', s.shop_domain, 'store_url', s.store_url, 'created_by', s.created_by);
end $$;

create or replace function public.c2_connection_set_webhooks(p_id uuid, p_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.store_connections where id = p_id) then raise exception 'NOT_FOUND: Store connection not found.'; end if;
  update public.store_connections set remote_webhook_ids = case when coalesce(cardinality(p_ids), 0) = 0 then null else p_ids end, updated_at = now() where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['c2_connect_start(text, text, text)', 'c2_connect_claim(text, text)', 'c2_connection_set_webhooks(uuid, text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  grant execute on function public.c2_connect_start(text, text, text) to authenticated;
end $$;
