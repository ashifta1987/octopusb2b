-- Down for ODS T5a cart (253, DRAFT). Only within the first hour and only if 253 itself failed (PROJECT-MEMORY §2.5).
-- Restores quote_list_submit to the 251 body EXACTLY (sends the whole list, no target price / customisation), then drops the
-- cart RPCs, helpers, tables, the three quote_list_items columns and the enum. Cart lines are not orders: nothing financial
-- is touched (253 never writes ledger / wallet / payment / order rows). RFQs already sent stay as they are.
-- "Send all as one request": ONE RFQ (code RFQ-<n>) with one line per product; the sourcing fee is charged once (settings).
create or replace function public.quote_list_submit(
  p_destination_country text, p_destination_city text default null, p_notes text default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.shop_guard();
  v_key text; v_rfq uuid; v_country text := upper(btrim(coalesce(p_destination_country, '')));
  v_city text := public.shop_clean(p_destination_city, 80); v_notes text := public.shop_clean(p_notes, 2000);
  v_n integer; v_bad record; v_first record; v_title text; v_list text;
begin
  if p_idem is not null and p_idem !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'INVALID_INPUT: request key'; end if;
  v_key := case when p_idem is null then null else v_org::text || ':' || p_idem end;
  if v_key is not null then
    select l.rfq_id into v_rfq from public.rfq_lines l where l.idem_key = v_key;
    if v_rfq is not null then
      return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq),
                                'lines', (select count(*) from public.rfq_lines where rfq_id = v_rfq), 'duplicate', true);
    end if;
  end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'SHIP_TO_REQUIRED'; end if;
  perform 1 from public.quote_list_items where org_id = v_org for update;
  select count(*) into v_n from public.quote_list_items where org_id = v_org;
  if v_n = 0 then raise exception 'QUOTE_LIST_EMPTY'; end if;
  -- every product must still be live and at or above its MOQ (the message names the product)
  select p.title, p.status::text st, p.archived_at, coalesce(p.moq, 1) moq, q.quantity into v_bad
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org and (p.status <> 'live' or p.archived_at is not null or q.quantity < coalesce(p.moq, 1))
   order by q.seq limit 1;
  if v_bad.title is not null then
    if v_bad.st <> 'live' or v_bad.archived_at is not null then raise exception 'PRODUCT_UNAVAILABLE: %', v_bad.title; end if;
    raise exception 'BELOW_MOQ: % | %', v_bad.moq, v_bad.title;
  end if;
  select q.product_id, q.quantity, p.title into v_first
    from public.quote_list_items q join public.products p on p.id = q.product_id
   where q.org_id = v_org order by q.seq limit 1;
  select string_agg(t, ', ') into v_list from (
    select p.title t from public.quote_list_items q join public.products p on p.id = q.product_id
     where q.org_id = v_org order by q.seq limit 3) s;
  v_title := left(case when v_n = 1 then v_first.title else v_n || ' products: ' || v_list || case when v_n > 3 then ', …' else '' end end, 300);
  v_rfq := public.core_submit_rfq(v_org, auth.uid(), v_title, v_first.quantity,
             concat_ws(E'\n\n', v_notes, (select string_agg(rn || '. ' || t || ' — ' || qty || ' ' || u || coalesce(' (' || n || ')', ''), E'\n' order by rn)
               from (select row_number() over (order by q.seq) rn, p.title t, q.quantity qty, coalesce(p.unit, 'pcs') u, q.notes n
                       from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org) s)),
             v_first.product_id, v_country, v_city, null, null, case when v_key is null then null else 'rfq:' || v_key end, 'shop_quote_list');
  insert into public.rfq_lines (rfq_id, line_no, product_id, title, quantity, unit, notes, idem_key)
    select v_rfq, s.rn, s.product_id, s.title, s.quantity, s.unit, s.notes, case when s.rn = 1 then v_key end
      from (select row_number() over (order by q.seq)::integer rn, q.product_id, p.title, q.quantity, coalesce(p.unit, 'pcs') unit, q.notes
              from public.quote_list_items q join public.products p on p.id = q.product_id where q.org_id = v_org) s;
  delete from public.quote_list_items where org_id = v_org;
  perform public.write_audit('shop.quote_list_submitted', 'rfq', v_rfq::text, jsonb_build_object('lines', v_n, 'source', 'shop_quote_list'));
  return jsonb_build_object('id', v_rfq, 'code', (select code from public.rfqs where id = v_rfq), 'lines', v_n, 'duplicate', false);
end $$;

drop function if exists public.shop_cart_recheck();
drop function if exists public.shop_cart_set_ship_to(text, text);
drop function if exists public.quote_list_update_details(uuid, integer, bigint, text);
drop function if exists public.shop_cart_save_for_later(text, uuid, boolean);
drop function if exists public.shop_cart_remove(uuid);
drop function if exists public.shop_cart_update(uuid, integer);
drop function if exists public.shop_cart_add(text, text, integer);
drop function if exists public.shop_cart_lines();
drop function if exists public.shop_cart_count(uuid);
drop function if exists public.shop_cart_to_quote(uuid, uuid, integer);
drop function if exists public.shop_cart_raise(text, text);
drop function if exists public.shop_cart_assert_qty(public.shop_cart_kind, integer, integer, integer, integer, text);
drop function if exists public.shop_cart_source(public.shop_cart_kind, text, integer);
drop function if exists public.shop_cart_tier_price(uuid, integer, text);
drop function if exists public.shop_cart_stock(uuid);
drop table if exists public.shop_cart_items;
drop table if exists public.shop_carts;
alter table public.quote_list_items
  drop column if exists saved_for_later,
  drop column if exists customisation,
  drop column if exists target_price_minor;
drop type if exists public.shop_cart_kind;
