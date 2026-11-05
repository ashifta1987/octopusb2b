-- Owner decision 5 Nov 2026: "Continue with Google" is back for CUSTOMERS only (staff stay email + password + 2FA).
-- The button shows on /login and /signup when this list contains 'google' AND Google is enabled in Supabase Auth.
update site_settings
   set value = '["google"]'::jsonb,
       description = 'Social sign-in providers for CUSTOMERS on /login and /signup (shown only if also enabled in Supabase Auth → Providers). Staff never get social sign-in. [] = email only.',
       updated_at = now()
 where key = 'auth.social_providers';
