-- DOWN for 20261101000187_notifications_read_dedupe.sql (restores the previous policies and grants).
-- Then: delete from _migrations where name = '20261101000187_notifications_read_dedupe.sql';
drop function if exists my_notifications();
drop trigger if exists trg_notifications_read_once on notifications;
drop function if exists notifications_read_once();
grant insert, update, delete, truncate, trigger, references on notifications to anon, authenticated;
drop policy if exists notif_own on notifications;
create policy notif_own on notifications for select to authenticated using (user_id = auth.uid() or org_id in (select my_org_ids()));
drop policy if exists notif_upd on notifications;
create policy notif_upd on notifications for update to authenticated using (user_id = auth.uid() or org_id in (select my_org_ids()));
drop index if exists notifications_dedupe_key_uq;
alter table notifications drop column if exists dedupe_key;

