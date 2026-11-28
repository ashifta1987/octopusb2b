'use client';

import { createContext, useContext } from 'react';
import type { OfficePerms } from '../_lib/nav';

/**
 * ODS T8 · what the Back Office frame shares with pages (client context).
 *
 * `useOfficeWorkspace()` — a page (or a form inside it) marks the CURRENT workspace tab as having unsaved changes:
 *   const ws = useOfficeWorkspace(); ws.markDirty(true) on first edit, ws.markDirty(false) after saving.
 * The tab then shows the amber dot, closing it asks Save and close / Discard / Cancel, the browser warns on unload,
 * and an in-page link opens in a NEW tab instead of replacing the dirty one (nothing is lost). Today's re-exported pages
 * don't call it yet (T9 screens will); outside the frame it is a harmless no-op.
 */
export type OfficeWorkspaceApi = {
  markDirty: (dirty: boolean) => void;
  /** Open an internal route in a workspace tab (new = activate it, background = open behind). */
  openTab: (href: string, opts?: { title?: string; background?: boolean }) => void;
  /** Inside the ODS Back Office frame? */
  inFrame: boolean;
};

const noop: OfficeWorkspaceApi = { markDirty: () => {}, openTab: () => {}, inFrame: false };

export const OfficeWorkspaceContext = createContext<OfficeWorkspaceApi>(noop);
export const useOfficeWorkspace = () => useContext(OfficeWorkspaceContext);

/** Frame data for nested client pieces (section menus): permissions + the public pathname. */
export const OfficePermsContext = createContext<{ perms: OfficePerms | null; pathname: string }>({ perms: null, pathname: '/' });
export const useOfficePerms = () => useContext(OfficePermsContext);
