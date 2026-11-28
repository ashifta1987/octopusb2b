-- CONN S3 · Magento 2 and PrestaShop (migration 266; after 265). The merchant pastes their store address and an API key /
-- integration token created in their own store admin; the server tests it against the store (SSRF-guarded) BEFORE anything is
-- stored, then seals it (store_credentials) and activates the connection through the same single-use request as WooCommerce (S2):
--   c2_connect_start (merchant: setup role, plan limit, another account's store refused, 20 per hour)
--   → server testKey() → c2_connect_claim (service role) → c1_connection_upsert → saveCredential → active.
-- OpenCart stays on the CSV file connector (its built-in API cannot list orders).
-- Only change here: c2_connect_start accepts magento and prestashop in addition to woocommerce.

-- c2_connect_start(text,text,text)  (CONN S2 text + CONN S3 platforms)
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
  -- CONN S3: Magento and PrestaShop connect with a key the merchant pastes (tested by the server before anything is stored)
  if p_platform is null or p_platform not in ('woocommerce', 'magento', 'prestashop') then raise exception 'NOT_SUPPORTED: This platform does not connect this way yet.'; end if;
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
