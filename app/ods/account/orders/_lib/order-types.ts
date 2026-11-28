/**
 * View models for the ODS order detail (pure types). Everything here is customer-safe: no supplier / factory names or
 * codes, no cost or margin. Money is in minor units exactly as TODAY's tables return it.
 */
import type { PaymentServiceCode } from '@/lib/payments';
import type { OrderService, OrderStatusName, PaymentChoices, StepKey } from './order-logic';

export type OrderDocVM = { id: string; type: string; typeLabel: string; number: string; amountCents: number | null; currency: string; statusName: string; createdAt: string };
export type OrderPaymentVM = { id: string; purpose: string; method: string; amountCents: number; currency: string; statusName: string; at: string; reference: string | null };
export type OrderTicketVM = { id: string; code: string; subject: string; open: boolean; updatedAt: string };
export type OrderTrackVM = { id: string; title: string; location: string | null; at: string };
export type OrderShipmentVM = {
  code: string;
  method: string;
  trackingNo: string | null;
  status: string;
  eta: string | null;
  parcels: number | null;
  weightKg: number | null;
  carrier: string;
  location: string | null;
  updatedAt: string | null;
};
export type OrderHoldVM = {
  id: string;
  heldCents: number;
  currency: string;
  milestone: string;
  statusName: 'Held' | 'Released' | 'Refunded';
  disputed: boolean;
  disputeReason: string | null;
  canDispute: boolean;
};

export type OrderPaymentPanelVM = {
  service: PaymentServiceCode;
  currencyCode: 'USD' | 'CNY' | 'HKD';
  /** what the buttons pay: due now, else the open balance (today's ChooseHowToPay amount) */
  amountCents: number;
  duePurpose: 'deposit' | 'balance' | null;
  choices: PaymentChoices;
  walletBalanceCents: number;
  walletCreditCents: number;
  reference: string;
  bankLines: [string, string][];
  bankNotes: string | null;
  providerName: string | null;
  /** the provider adds a card fee (shown on its page) */
  providerSurcharge: boolean;
  hold: OrderHoldVM | null;
  /** Pay later (credit-eligible companies only; null = not offered — nothing is shown) */
  payLater: { allowed: boolean; netDays: number; availableCents: number; limitCents: number; unpaidCents: number; reservedCents: number; disabledReason: string | null } | null;
  /** an existing reserved credit reservation (today's "Confirmed on Pay later" banner) */
  reservation: { netDays: number; trigger: string; amountCents: number } | null;
};

export type OrderItemVM = { title: string; quantity: number; unit: string; unitCents: number | null; totalCents: number | null };

export type OrderDetailVM = {
  id: string;
  ref: string;
  title: string;
  quantity: number;
  currency: string;
  service: OrderService;
  statusName: OrderStatusName;
  rawStatus: string;
  dispute: boolean;
  createdAt: string;
  incoterm: string | null;
  piNumber: string | null;
  rfqRef: string | null;
  money: { totalCents: number; depositCents: number; depositPct: number; paidCents: number; balanceCents: number; due: { purpose: 'deposit' | 'balance'; amount: number } | null };
  steps: { key: StepKey; label: string; detail?: string }[];
  current: number;
  /** null = the payment panel failed to load */
  payment: OrderPaymentPanelVM | null;
  showPayment: boolean;
  items: OrderItemVM[];
  documents: OrderDocVM[] | null;
  qc: { docId: string; number: string; date: string } | null;
  qcReached: boolean;
  payments: OrderPaymentVM[] | null;
  shipment: OrderShipmentVM | null;
  tracking: OrderTrackVM[];
  shippingFailed: boolean;
  tickets: OrderTicketVM[] | null;
  timeline: { id: string; title: string; body: string | null; at: string }[] | null;
  cancellable: boolean;
  claim: { deliveredAt: string; visibleUntil: string | null; hiddenUntil: string | null } | null;
  justCreated: boolean;
};
