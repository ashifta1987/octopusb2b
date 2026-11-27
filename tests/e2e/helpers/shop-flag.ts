import { pgClient } from './customer';
import { assertStagingDatabase } from '../../../scripts/lib-staging-guard.mjs';

/** site_settings.shop_enabled (lib/shop/flag.ts). `undefined` = no row (the environment default: ON on staging). */
export type ShopFlag = boolean | undefined;

export async function getShopFlag(): Promise<ShopFlag> {
  const db = pgClient(); await db.connect();
  try {
    await assertStagingDatabase(db);
    const v = (await db.query(`select value from site_settings where key = 'shop_enabled'`)).rows[0]?.value;
    return typeof v === 'boolean' ? v : undefined;
  } finally { await db.end(); }
}

/** Set (true / false, public so the proxy's anon read sees it) or remove (undefined) the switch. Staging only. */
export async function setShopFlag(v: ShopFlag) {
  const db = pgClient(); await db.connect();
  try {
    await assertStagingDatabase(db);
    if (v === undefined) await db.query(`delete from site_settings where key = 'shop_enabled'`);
    else await db.query(`insert into site_settings (key, value, is_public, description) values ('shop_enabled', $1::jsonb, true, 'CH-1 Shop after login (on/off)')
      on conflict (key) do update set value = excluded.value, is_public = true`, [JSON.stringify(v)]);
  } finally { await db.end(); }
}
