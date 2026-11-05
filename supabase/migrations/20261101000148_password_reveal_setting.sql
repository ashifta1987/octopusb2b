-- ADDON-25: seconds a revealed password stays visible before it hides again (0 = never auto-hide).
insert into site_settings(key, value, description) values
  ('auth.password_reveal_timeout_s', '15'::jsonb, 'Password fields: seconds a revealed password stays visible before hiding again (0 = never). Default 15.')
on conflict (key) do nothing;
