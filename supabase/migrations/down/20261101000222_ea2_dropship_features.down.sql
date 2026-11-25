-- DOWN for 20261101000222_ea2_dropship_features.sql
-- Then: delete from _migrations where name = '20261101000222_ea2_dropship_features.sql';
drop function if exists public.public_dropship_processing_fee();
drop function if exists public.set_dropship_features(jsonb);
drop function if exists public.dropship_feature_on(text);
delete from public.site_settings where key in ('dropship_features', 'dropship_launch_countries');
