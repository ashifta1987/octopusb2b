-- Staff are identified by role; only the real company domain blocks customer sign-up.
update site_settings set value = jsonb_set(value, '{staff_email_domains}', '["octopusb2b.com"]') where key = 'staff_security';
