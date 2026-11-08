-- Bug 1 (8 Nov 2026): notification count / read state / duplicates.
--  · One definition of "my notifications" (my_notifications()) used by the list AND the count bubble: rows addressed to
--    me (user_id) or to my company without a named recipient (user_id null). Staff alerts that also carry the customer's
--    org_id (create_brand_project: user_id = admin, org_id = customer) are no longer shown to — or counted for — the customer.
--  · Customers may change ONLY read_at, only on their own rows, and only from empty to a time (never back, never re-stamped).
--  · dedupe_key: one notification per event (unique); writers insert with ON CONFLICT DO NOTHING.
-- Read state stays per company (decision 8 Nov 2026). Existing rows are not changed.
-- Down: supabase/migrations/down/20261101000187_notifications_read_dedupe.down.sql

alter table notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_uq on notifications (dedupe_key);

-- ── visibility: own rows, or company rows without a named recipient ──
drop policy if exists notif_own on notifications;
create policy notif_own on notifications for select to authenticated
  using (user_id = auth.uid() or (user_id is null and org_id in (select my_org_ids())));
drop policy if exists notif_upd on notifications;
create policy notif_upd on notifications for update to authenticated
  using (user_id = auth.uid() or (user_id is null and org_id in (select my_org_ids())))
  with check (user_id = auth.uid() or (user_id is null and org_id in (select my_org_ids())));

-- ── only read_at is writable by signed-in users; nobody anonymous writes ──
revoke insert, update, delete, truncate, trigger, references on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;

-- read_at goes from empty to a time once; a second "mark read" keeps the first time, nothing can clear it
create or replace function notifications_read_once() returns trigger language plpgsql set search_path = public as $$
begin
  if old.read_at is not null then new.read_at := old.read_at; end if;
  return new;
end $$;
drop trigger if exists trg_notifications_read_once on notifications;
create trigger trg_notifications_read_once before update of read_at on notifications for each row execute function notifications_read_once();

-- ── the single source for list + bubble (security invoker: RLS above applies) ──
create or replace function my_notifications() returns setof notifications
language sql stable security invoker set search_path = public as $$
  select * from notifications where user_id = auth.uid() or (user_id is null and org_id in (select my_org_ids()));
$$;
revoke execute on function my_notifications() from public, anon;
grant execute on function my_notifications() to authenticated;
