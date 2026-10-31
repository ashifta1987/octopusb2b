-- SPEC §17 — staff account page: "active sessions" count for the signed-in user (auth.sessions is not exposed via REST).
create or replace function my_active_sessions() returns int
language sql stable security definer set search_path = public, auth as $$
  select count(*)::int from auth.sessions s
  where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now());
$$;
revoke execute on function public.my_active_sessions() from public, anon;
grant execute on function public.my_active_sessions() to authenticated, service_role;
