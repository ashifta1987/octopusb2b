-- DOWN for 20261101000229_w2b_putaway_labels_transfers.sql
-- Then: delete from _migrations where name = '20261101000229_w2b_putaway_labels_transfers.sql';
-- W2b replaced no existing function. Stock movements already posted by transfers (adjust_out / adjust_in) are append-only
-- data and stay, as do the lots created at a destination (wh_lots belongs to W2a).
-- triggers on W2a/legacy tables first, then W2b tables (their policies use wh_sees()), sequences, functions
drop trigger if exists wh_stock_covers_placement on public.warehouse_stock;
drop table if exists public.wh_label_prints;
drop table if exists public.wh_transfer_picks;
drop table if exists public.wh_transfer_lines;
drop table if exists public.wh_transfers;
drop table if exists public.wh_location_moves;
drop table if exists public.wh_bin_stock;
drop table if exists public.wh_pallets;
drop table if exists public.wh_bins;
drop sequence if exists public.seq_wh_transfer;
drop sequence if exists public.seq_wh_pallet;
drop function if exists public.wh_label_board(text);
drop function if exists public.wh_transfers_board(text);
drop function if exists public.wh_putaway_board(text);
drop function if exists public.wh_log_label_print(text, text, text[], integer);
drop function if exists public.wh_receive_transfer(uuid);
drop function if exists public.wh_dispatch_transfer(uuid);
drop function if exists public.wh_cancel_transfer(uuid, text);
drop function if exists public.wh_create_transfer(text, text, jsonb, text);
drop function if exists public.wh_move_pallet(uuid, uuid, text);
drop function if exists public.wh_move_bin_stock(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.wh_putaway(uuid, uuid, integer, uuid);
drop function if exists public.wh_create_pallet(text, uuid, uuid, text);
drop function if exists public.wh_set_bin_status(uuid, text, text);
drop function if exists public.wh_create_bin_range(text, text, integer, integer, integer, integer, text);
drop function if exists public.wh_create_bin(text, text, text);
drop function if exists public.wh_add_to_bin(text, uuid, uuid, uuid, uuid, integer);
drop function if exists public.wh_take_from_bin(uuid, uuid, uuid, integer);
drop function if exists public.wh_lot_free(uuid);
drop function if exists public.wh_post_movement(uuid, text, integer, text, text);
drop function if exists public.wh_check_placement();
