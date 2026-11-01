-- Defence in depth for migration 143: credit limits are written only through admin_set_wallet_credit()
-- (RLS already refuses direct writes; remove the table privileges too).
revoke insert, update, delete, truncate on wallet_credit_limits from anon, authenticated;
revoke all on wallet_credit_limits from anon;
