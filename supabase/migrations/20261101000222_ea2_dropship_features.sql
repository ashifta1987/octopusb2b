-- 20261101000222_ea2_dropship_features.sql
-- Release 1 · EA-2: early-access merchant scope. One config list of merchant features (site_settings.dropship_features).
--  · Staging gets every feature ON; live gets the early-access set (ON: dashboard, find, product detail, landed cost,
--    requests, wallet, settings, support; OFF: stores, import list, pushed, pricing, packing, orders, reports, billing,
--    samples). OFF items are hidden in the merchant menu and tabs; their routes redirect to the dashboard (app guard).
--  · site_settings.dropship_launch_countries: the public /request/dropship page lists them (empty = the answer is hidden).
--  · set_dropship_features(): admin only, audit-logged. dropship_feature_on(): one place for the default rule.
-- Down: supabase/migrations/down/20261101000222_ea2_dropship_features.down.sql

insert into public.site_settings (key, value, description, is_public)
select 'dropship_features',
       case when exists (select 1 from public.site_settings where key = 'app_environment' and value = to_jsonb('staging'::text))
            then '{"dashboard":true,"find":true,"product_detail":true,"landed_cost":true,"requests":true,"wallet":true,"settings":true,"support":true,"stores":true,"import_list":true,"pushed":true,"pricing":true,"packing":true,"orders":true,"reports":true,"billing":true,"samples":true}'::jsonb
            else '{"dashboard":true,"find":true,"product_detail":true,"landed_cost":true,"requests":true,"wallet":true,"settings":true,"support":true,"stores":false,"import_list":false,"pushed":false,"pricing":false,"packing":false,"orders":false,"reports":false,"billing":false,"samples":false}'::jsonb
       end,
       'EA-2: Dropship merchant features on/off. OFF = hidden in the menu and tabs; the route redirects to the dashboard.',
       true
on conflict (key) do nothing;

insert into public.site_settings (key, value, description, is_public)
values ('dropship_launch_countries', '[]'::jsonb, 'EA-2: countries listed on the public Dropship page (ISO-2). Empty = not listed.', true)
on conflict (key) do nothing;

-- Unknown keys default to OFF; a missing row means the early-access set (live-safe).
create or replace function public.dropship_feature_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value ->> lower(btrim(p_key)))::boolean from public.site_settings where key = 'dropship_features'),
    lower(btrim(p_key)) in ('dashboard', 'find', 'product_detail', 'landed_cost', 'requests', 'wallet', 'settings', 'support')
  )
$$;
revoke all on function public.dropship_feature_on(text) from public, anon;
grant execute on function public.dropship_feature_on(text) to authenticated, service_role;

create or replace function public.set_dropship_features(p_features jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array['dashboard','find','product_detail','landed_cost','requests','wallet','settings','support',
                            'stores','import_list','pushed','pricing','packing','orders','reports','billing','samples'];
  v_old jsonb;
  v_new jsonb := '{}'::jsonb;
  k text;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'FORBIDDEN: only an admin can change Dropship features';
  end if;
  if jsonb_typeof(coalesce(p_features, 'null'::jsonb)) <> 'object' then
    raise exception 'INVALID_FEATURES: expected an object of feature: true/false';
  end if;
  foreach k in array v_allowed loop
    if not (p_features ? k) or jsonb_typeof(p_features -> k) <> 'boolean' then
      raise exception 'INVALID_FEATURES: % must be true or false', k;
    end if;
    v_new := v_new || jsonb_build_object(k, p_features -> k);
  end loop;
  -- the basics merchants need to use early access cannot be switched off here
  if not (v_new ->> 'dashboard')::boolean or not (v_new ->> 'support')::boolean or not (v_new ->> 'wallet')::boolean then
    raise exception 'INVALID_FEATURES: Dashboard, Wallet and Support always stay on';
  end if;
  select value into v_old from public.site_settings where key = 'dropship_features';
  insert into public.site_settings (key, value, description, is_public, updated_at, updated_by)
  values ('dropship_features', v_new, 'EA-2: Dropship merchant features on/off. OFF = hidden in the menu and tabs; the route redirects to the dashboard.', true, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform write_audit('dropship_features.updated', 'site_settings', 'dropship_features', jsonb_build_object('from', v_old, 'to', v_new));
  return v_new;
end $$;
revoke all on function public.set_dropship_features(jsonb) from public, anon;
grant execute on function public.set_dropship_features(jsonb) to authenticated, service_role;

-- Public Dropship page (EA_PublicDropship): the processing fee comes from the active fee version, never hard-coded.
-- Returns only the two merchant-facing processing amounts (NULL when no version is active).
create or replace function public.public_dropship_processing_fee()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('first_item_cents', f.pick_pack_first_cents, 'extra_item_cents', f.pick_pack_extra_cents)
    from public.fee_versions f
   where f.status = 'active'
   limit 1
$$;
revoke all on function public.public_dropship_processing_fee() from public;
grant execute on function public.public_dropship_processing_fee() to anon, authenticated, service_role;
