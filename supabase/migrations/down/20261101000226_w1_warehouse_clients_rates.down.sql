-- DOWN for 20261101000226_w1_warehouse_clients_rates.sql
-- Then: delete from _migrations where name = '20261101000226_w1_warehouse_clients_rates.sql';
drop function if exists public.wh_list_rate_versions();
drop function if exists public.wh_decide_rates(uuid, text, text);
drop function if exists public.wh_propose_rates(text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text);
drop function if exists public.wh_claim_my_application();
drop function if exists public.wh_decide_application(uuid, text, text);
drop function if exists public.wh_link_application(uuid);
drop function if exists public.wh_review_application(uuid, boolean, boolean, boolean, text);
drop function if exists public.wh_can_manage_clients();
drop function if exists public.wh_submit_application(text, text, text, text, text, text, text, text[], text, boolean, boolean, text);
drop table if exists public.wh_rate_versions;
drop table if exists public.wh_clients;
alter table if exists public.wh_applications drop constraint if exists wh_applications_plan_fk;
drop table if exists public.wh_rate_plans;
drop table if exists public.wh_applications;
drop sequence if exists public.seq_wh_application;
drop policy if exists warehouses_public_read on public.warehouses;
revoke select (code, name, country, province, city, email, phone, hours, timezone, status, is_default) on public.warehouses from anon;
