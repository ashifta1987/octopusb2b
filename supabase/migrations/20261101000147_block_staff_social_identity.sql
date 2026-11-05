-- Google sign-in audit (5 Nov 2026): block social identities for staff AT THE DATABASE.
-- Supabase links a Google identity to an existing account with the same verified email automatically, so without
-- this a staff member could get an (aal1) session for their staff account via the customer Google button / the raw
-- OAuth endpoint, skipping the password factor. The trigger refuses any non-email identity when the user is staff
-- or the email is on a staff domain; the whole sign-in/sign-up transaction is rolled back (no user is created).

create or replace function guard_social_identity() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(coalesce(new.identity_data->>'email', new.email, ''));
begin
  if new.provider = 'email' or new.provider = 'phone' then return new; end if;
  if user_is_staff(new.user_id) or (v_email <> '' and email_is_staff(v_email)) then
    raise exception 'STAFF_SOCIAL_SIGNIN_BLOCKED: staff accounts sign in with work email + password'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function guard_social_identity() from public, anon, authenticated;
grant execute on function guard_social_identity() to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

drop trigger if exists guard_social_identity on auth.identities;
create trigger guard_social_identity
  before insert on auth.identities
  for each row execute function guard_social_identity();
