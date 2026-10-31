/**
 * Staff workspaces (SPEC §17.2 step 3). Pure module: used by /staff/workspace, the portal top-bar switcher
 * and the admin agent. A workspace is shown only when the person's roles/permissions allow it.
 */
import type { Session } from '@/lib/auth';

export type WorkspaceKey = 'office' | 'shipping' | 'support' | 'finance' | 'admin' | 'distributor' | 'content';

export type Workspace = {
  key: WorkspaceKey;
  label: string;
  short: string; // 2-letter tile
  description: string;
  href: string;
  /** permission needed (area:action) — admins always pass */
  area?: string;
  action?: string;
  /** role needed instead of a permission (admins always pass) */
  role?: string;
};

export const WORKSPACES: Workspace[] = [
  { key: 'office', label: 'Back office', short: 'BO', description: 'Queues: KYC, product moderation, RFQs, service requests', href: '/office', area: 'dashboard', action: 'view' },
  { key: 'shipping', label: 'Shipping', short: 'SH', description: 'YunExpress shipments, labels and exceptions', href: '/office/shipping', area: 'orders', action: 'view' },
  { key: 'support', label: 'Support desk', short: 'SD', description: 'Customer complaints, feedback and SLAs', href: '/office/support', area: 'support', action: 'view' },
  { key: 'finance', label: 'Finance', short: 'FI', description: 'Payments, approvals, statements and reconciliation', href: '/admin/finance', area: 'finance', action: 'view' },
  { key: 'admin', label: 'Admin', short: 'AD', description: 'Master switches, staff & roles, integrations, backups', href: '/admin', role: 'admin' },
  { key: 'distributor', label: 'Distributor panel', short: 'DP', description: 'Suppliers, products, bulk upload, categories', href: '/distributor', role: 'distributor' },
  { key: 'content', label: 'Site content', short: 'SC', description: 'Pages, templates, Terms drafts and branches', href: '/admin/content', area: 'content', action: 'view' },
];

type SessionLike = Pick<Session, 'isAdmin' | 'roles' | 'permissions'> | null | undefined;

/** Workspaces the person may open, in display order. */
export function workspacesFor(session: SessionLike): Workspace[] {
  if (!session) return [];
  return WORKSPACES.filter((w) => {
    if (session.isAdmin) return true;
    if (w.role) return session.roles.includes(w.role);
    return session.permissions.has(`${w.area}:${w.action ?? 'view'}`);
  });
}

export function workspaceByKey(key: string | null | undefined): Workspace | undefined {
  return WORKSPACES.find((w) => w.key === key);
}

/** The workspace a path belongs to (longest href prefix wins), for the top-bar switcher. */
export function workspaceForPath(path: string, list: Workspace[] = WORKSPACES): Workspace | undefined {
  return [...list]
    .sort((a, b) => b.href.length - a.href.length)
    .find((w) => path === w.href || path.startsWith(`${w.href}/`));
}
