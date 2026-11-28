-- CONN S2 · WooCommerce connection — DOWN (schema back exactly as after 260). Connections made through WooCommerce stay (they are
-- ordinary store_connections rows); only the request column and the remote webhook ids go.
drop function if exists public.c2_connection_set_webhooks(uuid, text[]);
drop function if exists public.c2_connect_claim(text, text);
drop function if exists public.c2_connect_start(text, text, text);
alter table public.store_connections drop column if exists remote_webhook_ids;
alter table public.store_oauth_states drop column if exists store_url;
