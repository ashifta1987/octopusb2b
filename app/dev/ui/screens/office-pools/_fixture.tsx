'use client';

import { PoolsScreen, type PoolsActions } from '@/app/ods/admin/pools/_components/pools-screen';
import type { ComponentProps } from 'react';

const ok = (message: string) => async () => ({ ok: true as const, message: `${message} (sample — nothing was saved)` });
const SAMPLE: PoolsActions = {
  togglePools: ok('Group buying switched'),
  savePoolRules: ok('Pool rules saved'),
  extendPool: ok('Deadline extended'),
  forceSettlePool: ok('Pool settled'),
  cancelPool: ok('Pool cancelled'),
  confirmDeposit: ok('Deposit confirmed'),
  defaultPledge: ok('Pledge marked defaulted'),
};

export function PoolsFixture(props: Omit<ComponentProps<typeof PoolsScreen>, 'actions'>) {
  return <PoolsScreen {...props} actions={SAMPLE} />;
}
