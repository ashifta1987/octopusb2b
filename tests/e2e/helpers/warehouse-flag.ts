import { adminClient } from './customer';

/** Runs fn with site_settings.warehouse_os_ui = false (the Live gate), then restores the previous row (or no row). */
export async function withWarehouseOsOff(fn: () => Promise<void>) {
  const { data } = await adminClient().from('site_settings').select('value').eq('key', 'warehouse_os_ui');
  await adminClient().from('site_settings').upsert({ key: 'warehouse_os_ui', value: false, description: 'Warehouse OS gate test' });
  try {
    await fn();
  } finally {
    if (!data?.length) await adminClient().from('site_settings').delete().eq('key', 'warehouse_os_ui');
    else await adminClient().from('site_settings').upsert({ key: 'warehouse_os_ui', value: data[0].value });
  }
}
