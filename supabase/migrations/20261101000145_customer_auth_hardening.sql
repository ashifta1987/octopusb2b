-- ADDON-22 (no Google for customers; owner extended it to staff too, 1 Nov 2026): customer sign-in hardening.
-- * auth.social_providers = []  (no social / OAuth sign-in anywhere)
-- * per-IP rate limit for the customer login endpoint (10 attempts / IP / minute)
-- * lockout copy: admin notification says "Customer account locked" for customers (was always "Staff account locked")

insert into site_settings(key, value, description) values
  ('auth.social_providers', '[]'::jsonb, 'Social / OAuth sign-in providers shown on /login, /signup and /staff/login. Empty = email + password only (ADDON-22).')
on conflict (key) do update set value = '[]'::jsonb, description = excluded.description, updated_at = now();

-- ───────── Rate limit buckets (fixed window) ─────────
create table if not exists auth_rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);
alter table auth_rate_limits enable row level security;   -- no policies: service role only
revoke all on auth_rate_limits from anon, authenticated;

-- one hit in `p_bucket`; returns {allowed, hits, limit, retry_after_s}
create or replace function auth_rate_hit(p_bucket text, p_limit int default 10, p_window_s int default 60) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r auth_rate_limits;
begin
  insert into auth_rate_limits(bucket, window_start, hits) values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when auth_rate_limits.window_start < now() - make_interval(secs => p_window_s) then 1 else auth_rate_limits.hits + 1 end,
    window_start = case when auth_rate_limits.window_start < now() - make_interval(secs => p_window_s) then now() else auth_rate_limits.window_start end
  returning * into r;
  -- housekeeping: drop buckets idle for a day
  delete from auth_rate_limits where window_start < now() - interval '1 day' and bucket <> p_bucket;
  return jsonb_build_object('allowed', r.hits <= p_limit, 'hits', r.hits, 'limit', p_limit,
    'retry_after_s', greatest(0, ceil(extract(epoch from (r.window_start + make_interval(secs => p_window_s) - now()))))::int);
end $$;
revoke execute on function auth_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function auth_rate_hit(text, int, int) to service_role;

-- ───────── Lockout notification wording for customers ─────────
do $$
declare def text; patched text;
  old_txt text := 'select ur.user_id, ''Staff account locked'', lower(p_email) || '' was locked for '' || v_min || '' minutes after '' || v_max || '' failed attempts.'', ''/admin/staff''';
  new_txt text := 'select ur.user_id,
        case when exists (select 1 from user_roles s where s.user_id = v_uid and s.role_code <> ''customer'') then ''Staff account locked'' else ''Customer account locked'' end,
        lower(p_email) || '' was locked for '' || v_min || '' minutes after '' || v_max || '' failed attempts'' || coalesce('' (IP '' || p_ip || '')'', '''') || ''.'',
        case when exists (select 1 from user_roles s where s.user_id = v_uid and s.role_code <> ''customer'') then ''/admin/staff'' else ''/admin/customers'' end';
begin
  def := pg_get_functiondef('auth_record_failure(text,text,text,text)'::regprocedure);
  if position('Customer account locked' in def) > 0 then return; end if;
  patched := replace(def, old_txt, new_txt);
  if patched = def then raise exception 'ADDON-22 patch: lockout notification text not found'; end if;
  execute patched;
end $$;

