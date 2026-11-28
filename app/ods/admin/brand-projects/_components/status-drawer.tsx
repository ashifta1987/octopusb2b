'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Button, Drawer } from '@octopus/ui';

/** "Change status" → drawer hosting today's BrandStatusControls (set_brand_project_status, unchanged). */
export function BrandStatusDrawer({ code, paid, children, initialOpen }: { code: string; paid: boolean; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(!!initialOpen);
  return (
    <>
      <Button variant="primary" iconStart={ArrowRightLeft} onClick={() => setOpen(true)} data-testid="brand-status-button">
        Change status
      </Button>
      {open ? (
        <Drawer open onClose={() => setOpen(false)} width={380} title="Change status" description={code} data-testid="brand-status-drawer">
          <div className="grid gap-3">
            {paid ? <p className="m-0 text-ods-small font-semibold text-ods-warning">Payment received on this project.</p> : null}
            {children}
            <p className="m-0 text-ods-small text-ods-slate">The customer sees the status and is told when a project is closed. Internal reasons stay in Admin.</p>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
