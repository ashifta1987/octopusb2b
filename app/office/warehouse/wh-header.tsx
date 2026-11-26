import type { ReactNode } from 'react';
import { DsPageHeader, type DsIconName } from '@/components/dropship-ui';
import type { WarehouseAccess } from '@/lib/warehouse';
import { setWarehouseScope } from './scope-actions';

/** Page header + warehouse switcher (multi-warehouse). Every number on the page follows the chosen warehouse. */
export function WhHeader({ access, title, subtitle, icon, actions }: {
  access: WarehouseAccess; title: string; subtitle?: string; icon: DsIconName; actions?: ReactNode;
}) {
  return (
    <DsPageHeader
      title={title}
      subtitle={subtitle}
      icon={icon}
      actions={
        <>
          {access.warehouses.length > 1 ? (
            <form action={setWarehouseScope} className="flex items-end gap-2" data-testid="wh-switcher">
              <label className="flex flex-col text-[12px] text-muted">
                <span>Warehouse</span>
                <select name="warehouse" defaultValue={access.current?.code ?? 'all'} className="ds-input min-h-[44px]" aria-label="Warehouse">
                  {access.canSeeAll && <option value="all">All warehouses</option>}
                  {access.warehouses.map((w) => (
                    <option key={w.code} value={w.code}>{w.name}{w.status !== 'active' ? ` (${w.status})` : ''}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="ds-btn ds-btn-secondary">Switch</button>
            </form>
          ) : (
            <span className="text-[13px] text-muted" data-testid="wh-single">{access.current?.name ?? access.warehouses[0]?.name}</span>
          )}
          {actions}
        </>
      }
    />
  );
}
