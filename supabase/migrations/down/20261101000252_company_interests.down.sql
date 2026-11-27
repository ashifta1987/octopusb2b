-- Down for the DRAFT ODS T3 company interests (252). Only within the first hour and only if 252 itself failed
-- (PROJECT-MEMORY §2.5). Drops the RPC and the table (interests are a preference, not a financial record).
drop function if exists public.save_company_interests(text[]);
drop table if exists public.company_interests;
