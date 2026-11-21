-- 203 · "Notify me when it launches" sign-ups for features that are not built yet (owner, 20 Nov 2026).
-- First use: Dropshipping (store connection + dropship ordering are "Coming soon" on the home page and /request/dropship).
--  · anyone may sign up through the server action (service role, rate-limited); nobody writes through the public API
--  · only staff can read the list (Admin › Services & charges); customers and the public key see nothing
--  · one open sign-up per feature + e-mail (repeats are treated as success by the app)
-- Down: supabase/migrations/down/20261101000203_launch_signups.down.sql
create table if not exists launch_signups (
  id uuid primary key default gen_random_uuid(),
  feature text not null check (feature in ('dropship')),
  email text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source text check (source is null or char_length(source) <= 40),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists launch_signups_feature_email_open on launch_signups (feature, lower(email)) where notified_at is null;
create index if not exists launch_signups_feature_created_idx on launch_signups (feature, created_at desc);
alter table launch_signups enable row level security;
drop policy if exists launch_signups_staff_read on launch_signups;
create policy launch_signups_staff_read on launch_signups for select to authenticated using (can('services', 'view'));
revoke all on launch_signups from public, anon, authenticated;
grant select on launch_signups to authenticated;
grant all on launch_signups to service_role;
