import type { WaitingActionType } from '@/lib/core/waiting-items';
import type { AccountServiceId } from './nav';
import type { KycState } from './status';
import type { DropshipNavChild } from './dropship-nav';

/**
 * ODS T6 · view models of the My account frame and Home / Action needed (pure types; the loaders fill them, the
 * presentational components and the staging fixtures take them as props).
 */

/** Everything the frame (sidebar, topbar, bottom bar) needs. Serializable (server → client). */
export type AccountFrameData = {
  user: { name: string; email: string | null };
  company: { id: string; name: string };
  /** The person's companies. Today one login = one company, so this has one entry and no switcher is shown. */
  companies: { id: string; name: string }[];
  counts: { action: number; requests: number; orders: number };
  unread: number;
  started: Record<AccountServiceId, boolean>;
  /**
   * T7 · the Dropshipping group's sub-items (Part 6.6), built by buildDropshipChildren() with today's merchant-menu rules
   * (dropship_v2_ui, ever enabled, early-access features). Empty/missing = no sub-items (Dropshipping is a plain item).
   */
  dropshipChildren?: DropshipNavChild[];
};

/** One "Waiting for you" / Action needed row. */
export type WaitingRowView = {
  id: string;
  type: WaitingActionType;
  service: string;
  /** Bold reference inside `what` (optional). */
  ref: string | null;
  what: string;
  detail: string;
  due: { text: string; urgent: boolean };
  action: string;
  href: string;
};

export type WalletView = {
  /** major units (US$) */
  available: number;
  held: number;
  /** Sum of what can be paid now on orders (today's dueNow()); null = could not be worked out. */
  invoicesDue: number | null;
  pendingTransfers: number;
};

export type ServiceTileStatus = 'on' | 'paused' | 'not-started' | 'soon';
export type ServiceTileView = { id: AccountServiceId; name: string; status: ServiceTileStatus; summary: string; href: string };

export type InProgressRow = { id: string; ref: string; title: string | null; href: string; service: string; status: string; nextStep: string };

export type ManagerView = { name: string | null; title: string | null; replyTime: string | null };

export type VerificationView = { state: KycState; message: string | null };

export type NewCustomerView = { companyDone: boolean; kyc: KycState };
