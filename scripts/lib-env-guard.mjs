// ADDON-24: shared guard — seed scripts refuse to touch a database marked as production.
export async function assertNotProduction(client, what) {
  const { rows } = await client.query(
    `select coalesce(current_setting('app.environment', true), '') = 'production'
         or exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'site_settings')
            and exists (select 1 from public.site_settings where key = 'app_environment' and value = '"production"'::jsonb) as prod`);
  if (rows[0]?.prod) {
    console.error(`✘ ${what} refused: this database is marked as production (site_settings.app_environment). Seed only staging / local projects.`);
    process.exit(1);
  }
}
export async function environmentOf(client) {
  const { rows } = await client.query(`select value #>> '{}' as env from public.site_settings where key = 'app_environment'`);
  return rows[0]?.env ?? 'unset';
}
