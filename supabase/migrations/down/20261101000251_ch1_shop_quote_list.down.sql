-- Down for CH-1 (251). Only within the first hour and only if 251 itself failed (PROJECT-MEMORY §2.5).
-- RFQs created from the shop stay (they are normal RFQs, line 1 = rfqs.product_id/quantity); only their extra lines go.
-- No financial rows are touched (the sourcing fee lives in the ledger via core_submit_rfq / wallet_charge).
drop function if exists public.wh_link_my_application(text);
drop function if exists public.shop_personal_picks(integer);
drop function if exists public.shop_record_view(uuid);
drop function if exists public.quote_list_submit(text, text, text, text);
drop function if exists public.quote_list_remove(uuid);
drop function if exists public.quote_list_update(uuid, integer, text);
drop function if exists public.quote_list_add(uuid, integer, text);
drop function if exists public.shop_submit_rfq(uuid, integer, text, text, bigint, text[], text, text);
drop function if exists public.shop_clean(text, integer);
drop function if exists public.shop_guard();
drop function if exists public.shop_member_can();
drop table if exists public.product_views;
drop table if exists public.quote_list_items;
drop table if exists public.rfq_lines;
delete from public.tags where slug in ('customisable', 'samples') and kind = 'service';
