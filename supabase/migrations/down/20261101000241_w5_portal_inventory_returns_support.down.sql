-- 20261101000241_w5_portal_inventory_returns_support.down.sql
-- Reverses 20261101000241_w5_portal_inventory_returns_support.sql exactly: drops the four storage policies, every W5 function,
-- the W5 tables (wh_support_links, wh_return_photos, wh_return_lines, wh_returns), the sequence and the 'returns' rows of
-- wh_role_capabilities. No existing function was replaced by W5 (wipe_demo_data included), so nothing has to be restored.
-- Data in the W5 tables (returns, their lines / photos / decisions / charges, and which tickets are warehouse requests) is lost.
-- Rows W5 wrote into existing tables stay: tickets + ticket_messages of warehouse requests (ordinary tickets, category
-- 'warehouse'), stock-ledger movements of completed returns (append-only), restock lots, send-back warehouse orders, and
-- wh_client_skus.image_path values. The private 'wh-returns' and 'wh-products' buckets and their files are storage data, not
-- schema; they stay (remove them with the Storage API if wanted), like W3a's 'wh-evidence' and W4's 'wh-labels'.
-- (_migrations bookkeeping: delete from public._migrations where name = '20261101000241_w5_portal_inventory_returns_support.sql';)

drop policy if exists "wh returns upload" on storage.objects;
drop policy if exists "wh returns read" on storage.objects;
drop policy if exists "wh products upload" on storage.objects;
drop policy if exists "wh products read" on storage.objects;

-- support
drop function if exists public.wh_ticket_context(uuid);
drop function if exists public.wh_portal_support(uuid);
drop function if exists public.wh_create_support_request(uuid, text, text, text, text, jsonb);

-- inventory
drop function if exists public.wh_set_sku_image(uuid, text);
drop function if exists public.wh_portal_inventory(uuid);

-- returns
drop function if exists public.wh_portal_returns(uuid);
drop function if exists public.wh_returns_board(text, text);
drop function if exists public.wh_return_complete(uuid, text);
drop function if exists public.wh_return_apply_default(uuid);
drop function if exists public.wh_return_decide(uuid, text, jsonb);
drop function if exists public.wh_return_inspect(uuid, jsonb, text);
drop function if exists public.wh_return_add_photo(uuid, text);
drop function if exists public.wh_return_register(uuid, text, text, text, text, jsonb);
drop function if exists public.wh_return_json(public.wh_returns, boolean);
drop function if exists public.wh_return_rate(uuid, text);

-- storage policy helpers
drop function if exists public.wh_product_photo_can_read(text);
drop function if exists public.wh_product_photo_can_upload(text);
drop function if exists public.wh_return_photo_can_read(text);
drop function if exists public.wh_return_photo_can_upload(text);

-- tables (children first)
drop table if exists public.wh_support_links;
drop table if exists public.wh_return_photos;
drop table if exists public.wh_return_lines;
drop table if exists public.wh_returns;

drop sequence if exists public.seq_wh_return;

delete from public.wh_role_capabilities where action = 'returns';
