-- Down for 20261101000205_dropship_catalogue_functions.sql
drop function if exists dropship_rate_estimate(integer, bigint, text, text);
drop function if exists dropship_whitelabel_hits(text[]);
drop function if exists get_dropship_product(uuid, text);
drop function if exists get_dropship_catalogue(text, text, text, integer);
drop function if exists set_dropship_markets(text[], uuid, boolean);
drop function if exists get_dropship_countries();
drop function if exists dropship_merchant_org();
