-- CONN S5 · Connector + carrier health — DOWN (schema back exactly as after 263). Only functions were added.
drop function if exists public.c5_carrier_error_record(uuid, text);
drop function if exists public.c5_notify_merchant(uuid);
drop function if exists public.c5_connection_retry_check(uuid);
drop function if exists public.c5_health_connectors();
